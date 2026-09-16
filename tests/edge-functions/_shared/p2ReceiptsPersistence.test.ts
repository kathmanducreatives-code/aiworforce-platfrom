// LEAD V2 P2 — SETTLEMENT FROM LIVE RECEIPTS, AND THE SPINE WRITTEN DOWN.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  markExecuted, newSpendLedger, reserve, resolveCeilings, attachProviderRun, receiptUsd,
} from "../../../supabase/functions/_shared/budgetPolicy.ts";
import {
  apifyReceiptFromRun, fetchApifyRunReceipt, settlementAttempts, settleUntilStable,
} from "../../../supabase/functions/_shared/providerReceipts.ts";
import {
  persistP2Spine, settleAndPersistP2Spine, settlementPatches, type SpineDb,
} from "../../../supabase/functions/_shared/p2SpinePersistence.ts";
import { appendTrace, newMissionTrace } from "../../../supabase/functions/_shared/missionTrace.ts";
import { buildStartedRow, specIdentityColumns } from "../../../supabase/functions/_shared/executionLedger.ts";
import { buildInvoker } from "../../../supabase/functions/_shared/capabilityExecution.ts";

const WS = "e8af257d-4c42-4fc2-9d62-037cdfac27c4";
const LIN = "11111111-2222-4333-8444-555555555555";
const T0 = Date.parse("2026-09-16T10:00:00Z");

function ledgerWith(runs: Array<[key: string, runId: string | null, provisional: number]>) {
  const l = newSpendLedger(resolveCeilings(null, false));
  for (const [key, runId, provisional] of runs) {
    reserve(l, { idempotency_key: key, provider_call_id: `pc_${key}`, purpose: "discovery", route_id: null, estimate_usd: 0.02 });
    markExecuted(l, key, provisional);
    attachProviderRun(l, key, runId);
  }
  return l;
}

// ── receipts ────────────────────────────────────────────────────────────────

Deno.test("a receipt's charge is the larger of the usage total and the priced events, never the sum", () => {
  const r = apifyReceiptFromRun({
    status: "SUCCEEDED", finishedAt: "2026-09-16T09:58:00Z", usageTotalUsd: 0.001,
    chargedEventCounts: { "actor-start": 1, "company": 10 },
    pricingInfo: { pricingPerEvent: { actorChargeEvents: { "actor-start": { eventPriceUsd: 0.008 }, company: { eventPriceUsd: 0.001 } } } },
  });
  assertEquals(r?.status, "SUCCEEDED");
  assertEquals(Number(r?.chargedUsd?.toFixed(4)), 0.018);
  assertEquals(receiptUsd(r), r!.chargedUsd);
  assertEquals(receiptUsd({ usageTotalUsd: 0.05, chargedUsd: 0.018 }), 0.05);
  assertEquals(receiptUsd({}), null);
});

Deno.test("the Apify token travels in the Authorization header, never the URL", async () => {
  let url = "", auth = "";
  const fake = (u: string, init?: RequestInit) => {
    url = u; auth = String((init?.headers as Record<string, string>).Authorization);
    return Promise.resolve(new Response(JSON.stringify({ data: { status: "SUCCEEDED", usageTotalUsd: 0.02, finishedAt: "x" } })));
  };
  const r = await fetchApifyRunReceipt("abcRun", "apify_api_SECRET", fake);
  assertEquals(url, "https://api.apify.com/v2/actor-runs/abcRun");
  assertFalse(url.includes("SECRET"));
  assertEquals(auth, "Bearer apify_api_SECRET");
  assertEquals(r?.usageTotalUsd, 0.02);
  const denied = await fetchApifyRunReceipt("abcRun", "t", () => Promise.resolve(new Response("no", { status: 401 })));
  assertEquals(denied, null);
});

Deno.test("settlement follows late Apify charges and is final only once a later read repeats it, a minute after the run", async () => {
  const l = ledgerWith([["k1", "run1", 0.009]]);
  // 4250f181's shape: SUCCEEDED carries the start fee; per-result charges land after.
  const reads = [0.008, 0.018, 0.018];
  let now = T0, i = 0;
  const out = await settleUntilStable(l, () => Promise.resolve({
    status: "SUCCEEDED", usageTotalUsd: reads[Math.min(i++, reads.length - 1)], finishedAt: "2026-09-16T09:59:30Z",
  }), { attempts: 5, waitMs: 15_000, minFinishedAgeMs: 60_000, now: () => now, sleep: (ms) => { now += ms; return Promise.resolve(); } });
  const r = l.reservations[0];
  assertEquals(r.status, "settled");
  assertEquals(r.settled_usd, 0.018);
  assertEquals(r.settlement_source, "provider_receipt");
  assertEquals(r.variance_usd, 0.009);
  assert(r.settlement_stable);
  assertEquals(out.reads, 3);
  assertEquals(out.stable, 1);
});

Deno.test("a receipt read too soon after the run finished is never final, however often it repeats", async () => {
  const l = ledgerWith([["k1", "run1", 0.009]]);
  const out = await settleUntilStable(l, () => Promise.resolve({
    status: "SUCCEEDED", usageTotalUsd: 0.012, finishedAt: new Date(T0).toISOString(),
  }), { attempts: 3, waitMs: 1_000, minFinishedAgeMs: 60_000, now: () => T0 + 5_000, sleep: () => Promise.resolve() });
  assertEquals(l.reservations[0].status, "settled");
  assertFalse(l.reservations[0].settlement_stable === true);
  assertEquals(out.stable, 0);
  assertEquals(out.reads, 3);
});

Deno.test("a running run and a call without a run keep their provisional floor — never a guess", async () => {
  const l = ledgerWith([["k1", "run1", 0.009], ["k2", null, 0.001]]);
  const out = await settleUntilStable(l, () => Promise.resolve({ status: "RUNNING", usageTotalUsd: 0.004 }),
    { attempts: 2, waitMs: 0, sleep: () => Promise.resolve() });
  assertEquals(l.reservations.map((r) => r.status), ["executed", "executed"]);
  assertEquals(out.unsettled, 1);
  assertEquals(out.without_run, 1);
});

Deno.test("receipt reads scale with the time left instead of collapsing to one (canary 5ee5ee4c)", () => {
  assertEquals(settlementAttempts(138_000), 7);
  assertEquals(settlementAttempts(80_000), 5);
  assertEquals(settlementAttempts(30_000), 1);
  assertEquals(settlementAttempts(5_000), 1);
  assertEquals(settlementAttempts(Infinity), 7);
  const src = Deno.readTextFileSync(new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));
  assert(src.includes("attempts: settlementAttempts(room, { waitMs: 15_000 }),"));
});

// ── the run id reaches the engine ─────────────────────────────────────────────

Deno.test("the invoker tells the call which provider run executed it", async () => {
  const seen: string[] = [];
  const invoke = buildInvoker({
    runTool: () => Promise.resolve({ ok: true, data: { run_id: "RUN42", dataset_id: "DS1", items: [], normalized_source_type: "jobs" } }),
    toolCtx: {}, auditOwnership: () => ({}), persistenceAuthority: "capability_engine",
  } as never);
  await invoke({ actorKey: "apify_linkedin_job_search", actorId: "x", input: {}, inputHash: "h",
    onProviderRun: (r) => seen.push(`${r.run_id}:${r.dataset_id}`) } as never);
  assertEquals(seen, ["RUN42:DS1"]);
});

// ── ledger columns ───────────────────────────────────────────────────────────

Deno.test("a call carrying a spec writes its identity columns; every other row keeps its shape", () => {
  const spec = { provider_call_id: "pc_abc", idempotency_key: "abc123", plan_version: 2, route_id: "r1" };
  assertEquals(specIdentityColumns({ input: {}, provider_call_spec: spec }), spec);
  const base = { workspace_id: WS, stage: "discovery", reason: "unspecified", provider_id: "apify", logical_call_key: "lk" } as never;
  const withSpec = buildStartedRow({ ...(base as object), request_input: { provider_call_spec: spec } } as never);
  assertEquals([withSpec.provider_call_id, withSpec.idempotency_key, withSpec.plan_version, withSpec.route_id], ["pc_abc", "abc123", 2, "r1"]);
  const plain = buildStartedRow({ ...(base as object), request_input: { input: {} } } as never);
  for (const k of ["provider_call_id", "idempotency_key", "plan_version", "route_id"]) assertFalse(k in plain, k);
});

// ── persistence ──────────────────────────────────────────────────────────────

function fakeDb() {
  const calls: Array<{ table: string; op: string; rows?: unknown; opts?: unknown; patch?: unknown; filters: string[] }> = [];
  const db: SpineDb = {
    from(table: string) {
      return {
        upsert(rows: unknown, opts: unknown) {
          calls.push({ table, op: "upsert", rows, opts, filters: [] });
          return Promise.resolve({ error: null });
        },
        update(patch: unknown) {
          const c = { table, op: "update", patch, filters: [] as string[] };
          calls.push(c);
          const f = {
            eq(col: string, v: string) { c.filters.push(`${col}=${v}`); return f; },
            neq(col: string, v: string) { c.filters.push(`${col}!=${v}`); return f; },
            then(res: (v: { error: unknown }) => unknown) { return Promise.resolve({ error: null }).then(res); },
          };
          return f as never;
        },
      } as never;
    },
  };
  return { db, calls };
}

const PLAN = {
  plan_id: "rp_1", version: 1, mission_hash: "mh", content_hash: "ch", created_by: "retrieval_planner", amendment: null,
} as never;

Deno.test("the spine is written with keyed, duplicate-ignoring writes, and settlement skips re-read rows", async () => {
  const { db, calls } = fakeDb();
  const l = ledgerWith([["k1", "run1", 0.009]]);
  const trace = newMissionTrace();
  appendTrace(trace, "retrieval_plan_created", { a: 1 }, { plan_version: 1 });
  appendTrace(trace, "call_executed", {}, { provider_call_id: "pc_k1", idempotency_key: "k1" });
  const rep = await persistP2Spine(db, { workspace_id: WS, lineage_id: LIN }, { retrieval_plans: [PLAN], mission_trace: trace, spend_ledger: l });
  assertEquals(rep, { plan_versions: 1, events: 2, settlements: 1, errors: [] });
  const plans = calls.find((c) => c.table === "lead_plan_versions")!;
  assertEquals(plans.opts, { onConflict: "workspace_id,lineage_id,plan_id,version", ignoreDuplicates: true });
  const events = calls.find((c) => c.table === "lead_mission_events")!;
  assertEquals((events.rows as Array<{ seq: number }>).map((r) => r.seq), [1, 2]);
  assertEquals(events.opts, { onConflict: "workspace_id,lineage_id,seq", ignoreDuplicates: true });
  const upd = calls.find((c) => c.table === "lead_execution_calls")!;
  assertEquals(upd.filters, [`workspace_id=${WS}`, "idempotency_key=k1", "status!=reused", "provider_run_id=run1"]);
  assertEquals(upd.patch, { settled_usd: 0.009, settlement_source: "derived_floor", variance_usd: null });
});

Deno.test("a non-uuid scope writes nothing; a failing write is reported, never thrown", async () => {
  const { db, calls } = fakeDb();
  const r = await persistP2Spine(db, { workspace_id: "ws", lineage_id: LIN }, { retrieval_plans: [PLAN] });
  assertEquals(r.errors, ["scope_not_uuid"]);
  assertEquals(calls.length, 0);
  const broken = { from: () => ({ upsert: () => Promise.resolve({ error: { code: "42P01", message: "relation does not exist" } }) }) } as never;
  const r2 = await persistP2Spine(broken, { workspace_id: WS, lineage_id: LIN }, { retrieval_plans: [PLAN] });
  assertEquals(r2.plan_versions, 0);
  assert(r2.errors[0].startsWith("plan_versions:42P01"));
});

Deno.test("settle-and-persist traces each settlement that changed, once, and writes the receipt figure", async () => {
  const { db, calls } = fakeDb();
  const l = ledgerWith([["k1", "run1", 0.009]]);
  const trace = newMissionTrace();
  const state = { spend_ledger: l, mission_trace: trace };
  const receipt = () => Promise.resolve({ status: "SUCCEEDED", usageTotalUsd: 0.018, finishedAt: "2026-09-16T09:00:00Z" });
  const out = await settleAndPersistP2Spine({ state, receiptFor: receipt, db, scope: { workspace_id: WS, lineage_id: LIN },
    attempts: 3, waitMs: 0, sleep: () => Promise.resolve(), now: () => T0 });
  assertEquals(out.settlement?.stable, 1);
  const settled = trace.events.filter((e) => e.type === "call_settled");
  assertEquals(settled.length, 1);
  assertEquals(settled[0].detail.settled_usd, 0.018);
  assertEquals(settled[0].detail.stable, true);
  const upd = calls.filter((c) => c.table === "lead_execution_calls").at(-1)!;
  assertEquals(upd.patch, { settled_usd: 0.018, settlement_source: "provider_receipt", variance_usd: 0.009 });
  // A second pass over a stable ledger reads nothing and traces nothing.
  const again = await settleAndPersistP2Spine({ state, receiptFor: () => { throw new Error("must not read"); }, db,
    scope: { workspace_id: WS, lineage_id: LIN }, sleep: () => Promise.resolve() });
  assertEquals(again.settlement?.reads, 0);
  assertEquals(trace.events.filter((e) => e.type === "call_settled").length, 1);
  assertEquals(settlementPatches(l).length, 1);
});

Deno.test("a call with no provider run (a Firecrawl page) is settled on its idempotency key alone", async () => {
  const { db, calls } = fakeDb();
  const l = ledgerWith([["page1", null, 0.0064]]);
  await persistP2Spine(db, { workspace_id: WS, lineage_id: LIN }, { spend_ledger: l });
  const upd = calls.find((c) => c.table === "lead_execution_calls")!;
  assertEquals(upd.filters, [`workspace_id=${WS}`, "idempotency_key=page1", "status!=reused"]);
  assertEquals(upd.patch, { settled_usd: 0.0064, settlement_source: "derived_floor", variance_usd: null });
});

// ── wiring ───────────────────────────────────────────────────────────────────

Deno.test("run-agent settles from Apify receipts, persists at checkpoint and end, and skips multi-round under specs", () => {
  const src = Deno.readTextFileSync(new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));
  assert(src.includes("if (multiRoundBinding.enabled && capabilityRun && !p2Specs) {"));
  assert(/settleAndPersistP2Spine\(\{[\s\S]{0,200}fetchApifyRunReceipt\(runId, apifyToken\)/.test(src));
  assert(/if \(p2Specs\) \{\s*const spine = await persistP2Spine\(/.test(src));
  assertFalse(/console\.log\([^)]*apifyToken/.test(src));
});

Deno.test("the P2 migration is applied from migrations/, idempotent, and its idempotency index is not unique", () => {
  const sql = Deno.readTextFileSync(new URL("../../../supabase/migrations/20260916120000_lead_v2_p2_execution_spine.sql", import.meta.url));
  assert(sql.includes("create table if not exists public.lead_plan_versions"));
  assert(sql.includes("create table if not exists public.lead_mission_events"));
  assert(sql.includes("create index if not exists lead_execution_calls_idempotency_idx"));
  assertFalse(/create unique index/i.test(sql));
  assert(/revoke all on public\.lead_plan_versions from anon, authenticated/.test(sql));
  assert(/revoke all on public\.lead_mission_events from anon, authenticated/.test(sql));
});
