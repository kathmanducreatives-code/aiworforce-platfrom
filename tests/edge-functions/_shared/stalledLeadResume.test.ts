// THE STALL, AND EVERY REASON NOT TO RESUME ONE.
//
// Run fafd9912, verbatim from production:
//
//   tasks.status                             "ready"
//   tasks.updated_at                          16:11:17   (slice 1)
//   lead_execution_calls ub2qunSMAKTNf5AKv    16:12:14   status "started"
//   result.auto_continuation.continuing        true
//   result.terminal_status         "execution_deadline_reached"   ← claim refuses
//
// Slice 2 enriched eleven companies, POSTed a job search and was killed
// mid-poll. Apify finished it — 150 rows, 533s — for nobody. Nothing on the
// machine would ever have looked at that task again.
//
// Pure. No network, no database, no clock.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  eligibleForAutoResume, resumeRequestFor, STALE_AFTER_MS, MAX_RESUMABLE_AGE_MS,
  type StalledTaskRow,
} from "../../../supabase/functions/_shared/stalledLeadResume.ts";
import {
  DEFAULT_MAX_CONTINUATIONS, DEFAULT_MAX_LINEAGE_COST_UNITS, LINEAGE_PROGRESS_KEY,
} from "../../../supabase/functions/_shared/leadAutoContinuation.ts";
import {
  mapTerminalRecordToRows,
} from "../../../supabase/functions/_shared/leadRunTerminalGuard.ts";

const NOW = Date.parse("2026-08-26T16:20:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

/** The live stalled task, with the terminal status the FIXED writer produces. */
const STALLED = (over: Partial<StalledTaskRow> = {}): StalledTaskRow => ({
  id: "fafd9912-7c4e-42c0-8534-dd455137a8b8",
  workspace_id: "ws-1", user_id: "user-1", plan_id: "plan-1",
  agent_slug: "pilot", step_index: 0, status: "ready",
  updated_at: ago(9 * 60_000), created_at: ago(11 * 60_000),
  continuation_claim_expires_at: ago(4 * 60_000),
  result: {
    terminal_status: "continuation_required",
    company_first_state: { next_action: "start_round" },
    lead_mission: { original_user_query:
      "Find 3 companies matching my ICP that are actively hiring sales roles." },
    auto_continuation: { continuing: true, decision: "quota_unmet_frontier_remains" },
    capability_execution_state: { pending_runs: [] },
    [LINEAGE_PROGRESS_KEY]: { continuations_used: 1, cost_units_used: 1 },
  },
  ...over,
});

Deno.test("the live stalled task is resumed on the evidence of its paid run", () => {
  const v = eligibleForAutoResume(STALLED(), NOW, { hasStartedProviderRun: true });
  assertEquals(v.eligible, true);
  assertEquals(v.evidence, "pending_provider_run");
});

Deno.test("a lost handoff is resumed even with no paid work outstanding", () => {
  // Slice 1 decided to continue and the dispatch never landed. The chain is
  // stalled for a reason that has nothing to do with a provider.
  const v = eligibleForAutoResume(STALLED(), NOW, { hasStartedProviderRun: false });
  assertEquals(v.eligible, true);
  assertEquals(v.evidence, "continuation_intended");
});

Deno.test("a checkpointed pending run counts without asking the ledger", () => {
  const row = STALLED();
  (row.result!.capability_execution_state as Record<string, unknown>).pending_runs =
    [{ run_id: "ub2qunSMAKTNf5AKv" }];
  assertEquals(eligibleForAutoResume(row, NOW, {}).evidence, "pending_provider_run");
});

// ── EVERY REFUSAL ─────────────────────────────────────────────────────────

Deno.test("a TERMINAL task is never restarted", () => {
  // The requirement, and the claim's own rule: anything that is not
  // `continuation_required` is `already_terminal` to the RPC, so nudging it
  // would 409 on every tick for ever.
  for (const t of ["completed", "search_exhausted", "budget_exhausted",
    "round_limit_reached", "provider_failure", "invalid_request",
    "execution_deadline_reached"]) {
    const row = STALLED();
    row.result!.terminal_status = t;
    assertEquals(eligibleForAutoResume(row, NOW, { hasStartedProviderRun: true }),
      { eligible: false, reason: "already_terminal" }, t);
  }
});

Deno.test("a task that is not `ready` is left alone", () => {
  // `running` belongs to `tasks_sweep_stuck_runs`, which moves it to `ready`
  // first. Two sweepers, one subject at a time.
  for (const s of ["running", "complete", "failed", "skipped", "partial"]) {
    assertEquals(eligibleForAutoResume(STALLED({ status: s }), NOW, {}).reason,
      "not_ready", s);
  }
});

Deno.test("a task another worker is holding is not touched", () => {
  // CONCURRENCY, first line. The claim is the real lock; this stops us
  // generating a pointless claim attempt against a live lease every tick.
  const held = STALLED({ continuation_claim_expires_at: new Date(NOW + 60_000).toISOString() });
  assertEquals(eligibleForAutoResume(held, NOW, { hasStartedProviderRun: true }).reason,
    "claim_held");
});

Deno.test("a task touched moments ago may still have a live successor", () => {
  // The in-process handoff resolves in 2s and a slice runs ~125s. Racing it
  // costs a duplicate claim on every tick; waiting costs nothing.
  const fresh = STALLED({ updated_at: ago(STALE_AFTER_MS - 1_000) });
  assertEquals(eligibleForAutoResume(fresh, NOW, { hasStartedProviderRun: true }).reason,
    "too_fresh");
  const justStale = STALLED({ updated_at: ago(STALE_AFTER_MS + 1_000) });
  assertEquals(eligibleForAutoResume(justStale, NOW, { hasStartedProviderRun: true }).eligible,
    true);
});

Deno.test("an old stalled task is abandoned, not resumed", () => {
  // Nobody is watching a Workbench for a request made three hours ago, and
  // spending their credits on it unasked is worse than leaving it. It also
  // hard-bounds the resume loop independently of any counter.
  const old = STALLED({ created_at: ago(MAX_RESUMABLE_AGE_MS + 60_000) });
  assertEquals(eligibleForAutoResume(old, NOW, { hasStartedProviderRun: true }).reason,
    "abandoned");
});

Deno.test("the EXISTING ceilings bound the resume loop", () => {
  // No new spend authority and no new counter — the same two numbers
  // `decideAutoContinuation` stops on.
  const conts = STALLED();
  (conts.result![LINEAGE_PROGRESS_KEY] as Record<string, unknown>).continuations_used =
    DEFAULT_MAX_CONTINUATIONS;
  assertEquals(eligibleForAutoResume(conts, NOW, { hasStartedProviderRun: true }).reason,
    "continuation_ceiling");

  const cost = STALLED();
  (cost.result![LINEAGE_PROGRESS_KEY] as Record<string, unknown>).cost_units_used =
    DEFAULT_MAX_LINEAGE_COST_UNITS;
  assertEquals(eligibleForAutoResume(cost, NOW, { hasStartedProviderRun: true }).reason,
    "cost_ceiling");
});

Deno.test("a run that simply finished short is not retried", () => {
  // `continuing: false` and no paid work outstanding. The sweeper is a stall
  // recovery, not a second opinion on an honest shortfall.
  const done = STALLED();
  done.result!.auto_continuation = { continuing: false, decision: "frontier_exhausted" };
  assertEquals(eligibleForAutoResume(done, NOW, { hasStartedProviderRun: false }).reason,
    "nothing_to_resume");
});

Deno.test("a task with no checkpoint or no mission is refused", () => {
  // The claim answers `no_checkpoint`; `run-agent` answers 400 without a
  // mission. Asking anyway would be a guaranteed refusal every three minutes.
  const noCp = STALLED(); delete noCp.result!.company_first_state;
  assertEquals(eligibleForAutoResume(noCp, NOW, {}).reason, "no_checkpoint");
  const noMission = STALLED(); delete noMission.result!.lead_mission;
  assertEquals(eligibleForAutoResume(noMission, NOW, {}).reason, "no_mission");
});

// ── THE REQUEST IT BUILDS ─────────────────────────────────────────────────

Deno.test("the resume is attributed to the person who asked", () => {
  const r = resumeRequestFor(STALLED())!;
  assert(r);
  assertEquals(r.resumeTaskId, "fafd9912-7c4e-42c0-8534-dd455137a8b8");
  assertEquals(r.userId, "user-1", "never the service identity");
  assertEquals(r.workspaceId, "ws-1");
  assertEquals(r.continuationIndex, 2, "the next slice, from the lineage counter");
  assertEquals(
    r.instruction,
    "Find 3 companies matching my ICP that are actively hiring sales roles.",
    "the MISSION's own words, not a planner instruction",
  );
  assert(r.leadMission, "run-agent reads the mission from the request, not the checkpoint");
});

Deno.test("a row that cannot be attributed produces no request", () => {
  assertEquals(resumeRequestFor(STALLED({ user_id: null })), null);
  assertEquals(resumeRequestFor(STALLED({ workspace_id: null })), null);
});

// ══ THE WRITER THAT LOCKED THE CLAIM OUT ══════════════════════════════════

Deno.test("a RESUMABLE partial now speaks the claim's vocabulary", () => {
  // THE LAST GAP. `mapTerminalRecordToRows` wrote `terminal_status:
  // record.reason` for a partial run, and "execution_deadline_reached" is not
  // in TERMINAL_STATUSES — so `claim_sourcing_continuation` refused the task
  // as `already_terminal`. A run that checkpointed, declared itself resumable
  // and asked to continue wrote the one value guaranteed to lock its own
  // successor out.
  const rows = mapTerminalRecordToRows({
    version: "lead-execution-finalizer-v1",
    status: "partial", reason: "execution_deadline_reached", resumable: true,
    detail: "stopped after 103581ms with 5 capability(ies) pending",
    blocked_by: null, pending_runs: [], provider_attempts: 2,
    pending_capabilities: [], failed_capabilities: [], completed_capabilities: [],
    last_completed_capability: "persistence", accumulated_cost_units: 1,
    elapsed_ms: 103581,
  } as never);
  assertEquals(rows.task_status, "ready");
  assertEquals(rows.result_patch.terminal_status, "continuation_required");
  assertEquals(rows.result_patch.terminal_record, undefined === undefined
    ? rows.result_patch.terminal_record : null, "the record itself is still carried");
  assert(rows.result_patch.terminal_record, "the untranslated reason survives on the record");
});

Deno.test("a NON-resumable partial keeps its reason verbatim", () => {
  // There is nothing to continue, and dressing it as `continuation_required`
  // would invite a claim that must then be refused deeper in.
  const rows = mapTerminalRecordToRows({
    version: "lead-execution-finalizer-v1",
    status: "partial", reason: "execution_deadline_reached", resumable: false,
    detail: "", blocked_by: null, pending_runs: [], provider_attempts: 0,
    pending_capabilities: [], failed_capabilities: [], completed_capabilities: [],
    last_completed_capability: null, accumulated_cost_units: 0, elapsed_ms: 1,
  } as never);
  assertEquals(rows.result_patch.terminal_status, "execution_deadline_reached");
});

Deno.test("a pending external run is unchanged", () => {
  // It already spoke the vocabulary; this must not have moved.
  const rows = mapTerminalRecordToRows({
    version: "lead-execution-finalizer-v1",
    status: "pending_external_run", reason: "provider_run_pending", resumable: true,
    detail: "", blocked_by: null,
    pending_runs: [{ run_id: "r", dataset_id: null, provider: "p" }],
    provider_attempts: 1, pending_capabilities: [], failed_capabilities: [],
    completed_capabilities: [], last_completed_capability: null,
    accumulated_cost_units: 1, elapsed_ms: 1,
  } as never);
  assertEquals(rows.task_status, "ready");
  assertEquals(rows.result_patch.terminal_status, "continuation_required");
});

// ── THE SWEEPER OWNS NO EXECUTOR AND NO LOCK ──────────────────────────────

Deno.test("the sweeper dispatches through run-agent, and claims nothing itself", () => {
  const FN = Deno.readTextFileSync(
    new URL("../../../supabase/functions/resume-stalled-leads/index.ts", import.meta.url),
  );
  assert(FN.includes("dispatchContinuation("), "the existing continuation path");
  // The RPC is NAMED in the header comment, which is the point — it explains
  // whose lock this relies on. What must not exist is a CALL to it.
  assertEquals(/\.rpc\(\s*["']claim_sourcing_continuation/.test(FN), false,
    "mutual exclusion is run-agent's claim, not a second lock");
  assertEquals(/\bupdate\(\s*\{[^}]*continuation_claim/.test(FN), false,
    "and not a hand-rolled compare-and-swap either");
  assertEquals(/runCapabilityPlan|callProvider|apify/i.test(FN), false,
    "a scheduler entry point owns no engine and no provider");
  assert(FN.includes("token !== SERVICE_KEY"), "the scheduler is the only caller");
});
