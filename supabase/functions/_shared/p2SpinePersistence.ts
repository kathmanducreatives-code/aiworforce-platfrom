// LEAD V2 P2 — WRITE THE EXECUTION SPINE DOWN.
//
// The engine carries RetrievalPlan versions, the spend ledger and the mission
// trace in its checkpointed state. This mirrors them into the tables the P2
// migration creates, so a plan version, a trace event and a call's settlement
// can be queried without unpacking task results:
//
//   lead_plan_versions   one row per (lineage, plan_id, version) — immutable
//   lead_mission_events  one row per (lineage, seq) — append-only
//   lead_execution_calls settled_usd / settlement_source / variance_usd,
//                        matched on the spec's idempotency key and run id
//
// Idempotent: every write is keyed, so a checkpoint and the final write may
// both run. Never throws — observability must not fail a paid run.

import type { ProviderReceipt, SpendLedger } from "./budgetPolicy.ts";
import { appendTrace, type MissionTrace } from "./missionTrace.ts";
import { settleUntilStable, type SettleOutcome } from "./providerReceipts.ts";
import type { RetrievalPlan } from "./retrievalPlan.ts";

export interface SpineDb {
  from(table: string): {
    upsert(rows: unknown, opts: { onConflict: string; ignoreDuplicates: boolean }): PromiseLike<{ error: unknown }>;
    update(values: unknown): SpineFilter;
  };
}
interface SpineFilter extends PromiseLike<{ error: unknown }> {
  eq(col: string, val: string): SpineFilter;
  neq(col: string, val: string): SpineFilter;
}

export interface SpineScope {
  workspace_id: string;
  lineage_id: string;
}

export interface SpineState {
  retrieval_plans?: RetrievalPlan[];
  mission_trace?: MissionTrace;
  spend_ledger?: SpendLedger;
}

export interface SpineWriteReport {
  plan_versions: number;
  events: number;
  settlements: number;
  errors: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHUNK = 500;

export function planVersionRows(scope: SpineScope, plans: readonly RetrievalPlan[]) {
  return plans.map((p) => ({
    workspace_id: scope.workspace_id,
    lineage_id: scope.lineage_id,
    plan_id: p.plan_id,
    version: p.version,
    mission_hash: p.mission_hash,
    content_hash: p.content_hash,
    created_by: p.created_by,
    amendment_trigger: p.amendment?.trigger ?? null,
    plan: p,
  }));
}

export function missionEventRows(scope: SpineScope, trace: MissionTrace) {
  return trace.events.map((e) => ({
    workspace_id: scope.workspace_id,
    lineage_id: scope.lineage_id,
    seq: e.seq,
    event_type: e.type,
    plan_version: e.plan_version,
    provider_call_id: e.provider_call_id,
    idempotency_key: e.idempotency_key,
    detail: e.detail,
    occurred_at: e.at,
  }));
}

/** Settlement patches for calls that ran a provider run. */
export function settlementPatches(ledger: SpendLedger) {
  return ledger.reservations
    .filter((r) => r.provider_run_id && (r.status === "settled" || r.status === "executed"))
    .map((r) => ({
      idempotency_key: r.idempotency_key,
      provider_run_id: r.provider_run_id as string,
      patch: {
        settled_usd: r.status === "settled" ? r.settled_usd : r.provisional_usd,
        settlement_source: r.status === "settled" ? "provider_receipt" : "derived_floor",
        variance_usd: r.status === "settled" ? r.variance_usd : null,
      },
    }));
}

export async function persistP2Spine(
  db: SpineDb, scope: SpineScope, state: SpineState,
): Promise<SpineWriteReport> {
  const report: SpineWriteReport = { plan_versions: 0, events: 0, settlements: 0, errors: [] };
  if (!UUID.test(scope.workspace_id) || !UUID.test(scope.lineage_id)) {
    report.errors.push("scope_not_uuid");
    return report;
  }
  const note = (where: string, error: unknown) => {
    if (!error) return false;
    const e = error as { message?: string; code?: string };
    report.errors.push(`${where}:${e.code ?? ""}:${String(e.message ?? error).slice(0, 160)}`);
    return true;
  };
  try {
    const plans = planVersionRows(scope, state.retrieval_plans ?? []);
    if (plans.length) {
      const { error } = await db.from("lead_plan_versions")
        .upsert(plans, { onConflict: "workspace_id,lineage_id,plan_id,version", ignoreDuplicates: true });
      if (!note("plan_versions", error)) report.plan_versions = plans.length;
    }
    const events = state.mission_trace ? missionEventRows(scope, state.mission_trace) : [];
    for (let i = 0; i < events.length; i += CHUNK) {
      const chunk = events.slice(i, i + CHUNK);
      const { error } = await db.from("lead_mission_events")
        .upsert(chunk, { onConflict: "workspace_id,lineage_id,seq", ignoreDuplicates: true });
      if (!note("mission_events", error)) report.events += chunk.length;
    }
    for (const s of state.spend_ledger ? settlementPatches(state.spend_ledger) : []) {
      const { error } = await db.from("lead_execution_calls").update(s.patch)
        .eq("workspace_id", scope.workspace_id)
        .eq("idempotency_key", s.idempotency_key)
        .eq("provider_run_id", s.provider_run_id)
        // A resumed run's re-read row names the same run; it bought nothing.
        .neq("status", "reused");
      if (!note("settlement", error)) report.settlements++;
    }
  } catch (e) {
    report.errors.push(`threw:${String(e).slice(0, 160)}`);
  }
  return report;
}

// ── SETTLE, TRACE, PERSIST ──────────────────────────────────────────────────

export interface FinalizeSpendInput {
  state: SpineState;
  receiptFor: ((runId: string) => Promise<ProviderReceipt | null>) | null;
  db: SpineDb | null;
  scope: SpineScope;
  attempts?: number;
  waitMs?: number;
  minFinishedAgeMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Settle every executed call from its provider receipt, trace each settlement
 * that changed, and write the spine down. Returns what happened; never throws.
 */
export async function settleAndPersistP2Spine(i: FinalizeSpendInput): Promise<{
  settlement: SettleOutcome | null; persisted: SpineWriteReport | null; error?: string;
}> {
  const ledger = i.state.spend_ledger;
  let settlement: SettleOutcome | null = null;
  try {
    if (ledger && i.receiptFor) {
      const before = new Map(ledger.reservations.map((r) => [r, `${r.status}|${r.settled_usd}|${r.settlement_stable === true}`]));
      settlement = await settleUntilStable(ledger, i.receiptFor, {
        attempts: i.attempts, waitMs: i.waitMs, minFinishedAgeMs: i.minFinishedAgeMs, sleep: i.sleep, now: i.now,
      });
      for (const r of ledger.reservations) {
        if (r.status !== "settled") continue;
        if (before.get(r) === `${r.status}|${r.settled_usd}|${r.settlement_stable === true}`) continue;
        if (i.state.mission_trace) {
          appendTrace(i.state.mission_trace, "call_settled", {
            provider_run_id: r.provider_run_id ?? null,
            provisional_usd: r.provisional_usd, settled_usd: r.settled_usd,
            variance_usd: r.variance_usd, stable: r.settlement_stable === true, receipt_reads: r.receipt_reads ?? 0,
          }, { provider_call_id: r.provider_call_id, idempotency_key: r.idempotency_key });
        }
      }
    }
  } catch (e) {
    return { settlement, persisted: null, error: `settle_threw:${String(e).slice(0, 160)}` };
  }
  const persisted = i.db ? await persistP2Spine(i.db, i.scope, i.state) : null;
  return { settlement, persisted };
}
