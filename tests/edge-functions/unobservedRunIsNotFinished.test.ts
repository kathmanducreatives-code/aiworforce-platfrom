// AN INVOCATION THAT NEVER LOOKED HAS NOT FOUND NOTHING.
//
// ── THE RUN THIS EXISTS FOR ────────────────────────────────────────────────
//
// Task fd4ed70a, 2026-08-31. Generation 1 checkpointed `continuation_required`
// with 23 companies still to investigate, and dispatched its successor
// correctly — `continuation_dispatched { handed_off: true }`, one lineage, a
// clean lease acquire with `held_by: null`. No race, no split.
//
// The successor booted at 09:31:46, took a path that never reached the
// capability engine, and returned ten seconds later. It had therefore called
// `observe()` exactly zero times, so the guard finalized a NULL state — and
// every branch of `decideTerminalRecord` reads an empty object and falls
// through to the last one:
//
//     completed / no_qualified_companies / resumable: false
//
// which `mapTerminalRecordToRows` writes as `tasks.status = "complete"`. The
// sweeper selects `status = "ready"`. So the row became invisible to the only
// mechanism that could have restarted it, and 23 companies were abandoned by a
// run that reported it had finished and found nothing.
//
// `disarm()` exists for this and its own comment records the same overwrite on
// task 7cd5cfb1. But disarm must be CALLED — it covers the return paths
// somebody remembered, and the DEFAULT stayed fail-open. This pins the default.
//
// ZERO network, ZERO DB.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decideTerminalRecord, type FinalizerState,
} from "../../supabase/functions/_shared/leadExecutionFinalizer.ts";
import {
  mapTerminalRecordToRows,
} from "../../supabase/functions/_shared/leadRunTerminalGuard.ts";
import {
  eligibleForAutoResume,
} from "../../supabase/functions/_shared/stalledLeadResume.ts";

// deno-lint-ignore no-explicit-any
const any = (o: unknown): any => o;

const ctx = (o: Record<string, unknown> = {}) => ({ elapsedMs: 10_000, ...o });

// ═══ 1. THE DEFAULT ════════════════════════════════════════════════════════

Deno.test("1. a never-observed state is partial and resumable, not completed", () => {
  for (const state of [null, undefined]) {
    const rec = decideTerminalRecord(state, ctx());
    assertEquals(rec.status, "partial");
    assertEquals(rec.reason, "no_execution_state_observed");
    assertEquals(rec.resumable, true);
  }
});

Deno.test("1b. it never claims the run found nothing", () => {
  const rec = decideTerminalRecord(null, ctx());
  assert(rec.reason !== "no_qualified_companies",
    "absence of state is not evidence of an empty result");
  assert(rec.status !== "completed", "an unobserved invocation has finished nothing");
});

// ═══ 2. THE ROW IT PRODUCES IS THE ONE THE SWEEPER CAN SEE ═════════════════

Deno.test("2. the row stays ready + continuation_required, so the sweeper can retry", () => {
  const rows = mapTerminalRecordToRows(decideTerminalRecord(null, ctx()));
  // `ready` is what `resume-stalled-leads` selects on; `complete` is what the
  // old default wrote, and it is why fd4ed70a was never scanned again.
  assertEquals(rows.task_status, "ready");
  assertEquals(rows.plan_status, "partial");
  // `claim_sourcing_continuation` refuses any terminal status that is not this
  // exact string, so a resumable partial must carry it.
  assertEquals(
    (rows.result_patch as Record<string, unknown>).terminal_status,
    "continuation_required",
  );
});

Deno.test("2b. end to end: the resulting row is eligible for auto-resume", () => {
  const rows = mapTerminalRecordToRows(decideTerminalRecord(null, ctx()));
  const patch = rows.result_patch as Record<string, unknown>;
  const row = any({
    id: "t1",
    status: rows.task_status,
    // Old enough to be past `too_fresh`, recent enough not to be `abandoned`.
    updated_at: new Date(Date.now() - 20 * 60_000).toISOString(),
    created_at: new Date(Date.now() - 25 * 60_000).toISOString(),
    continuation_claim_expires_at: null,
    result: {
      ...patch,
      company_first_state: { qualified_company_keys: [], completed_capabilities: [] },
      lead_mission: { requested_output: "qualified_companies" },
    },
  });
  const verdict = eligibleForAutoResume(row, Date.now());
  // The precise eligibility still depends on checkpoint shape; what this pins
  // is that it is no longer refused for being the wrong ROW STATUS, which is
  // the refusal that made fd4ed70a permanently invisible.
  assert(verdict.reason !== "not_ready",
    `the sweeper must not skip this row as not_ready (got ${verdict.reason})`);
});

Deno.test("2c. the OLD default is no longer a permanent skip", () => {
  // ── THE DEFECT THIS TEST USED TO PIN AS BEHAVIOUR ───────────────────────
  //
  // `status: complete` + `terminal_status: continuation_required` is the exact
  // contradiction tasks 7e71d8bc and a7a9371d ended in: a valid checkpoint with
  // work outstanding, stamped over by a later writer, and skipped as
  // `not_ready` on every tick for ever.
  //
  // It is now refused on SUBSTANCE — this fixture carries no `company_first_state`,
  // so there is no checkpoint to claim — rather than dismissed for its row
  // status. A row with a real checkpoint is recovered; see
  // `continuationRouteAndLifecycle.test.ts`.
  const row = any({
    id: "t1", status: "complete",
    updated_at: new Date(Date.now() - 20 * 60_000).toISOString(),
    created_at: new Date(Date.now() - 25 * 60_000).toISOString(),
    continuation_claim_expires_at: null,
    result: { terminal_status: "continuation_required" },
  });
  const verdict = eligibleForAutoResume(row, Date.now());
  assert(verdict.reason !== "not_ready",
    `no longer dismissed for its row status (got ${verdict.reason})`);
  assertEquals(verdict.eligible, false, "and still refused: it has no checkpoint");
});

// ═══ 3. WHAT MUST NOT CHANGE ═══════════════════════════════════════════════

Deno.test("3. a crash with no state is still a failure, not a partial", () => {
  const rec = decideTerminalRecord(null, ctx({ error: new Error("boom") }));
  assertEquals(rec.status, "failed");
  assert(rec.reason !== "no_execution_state_observed");
});

Deno.test("3b. a deadline is the more specific reason when both apply", () => {
  const rec = decideTerminalRecord(null, ctx({ deadlineReached: true }));
  assertEquals(rec.reason, "execution_deadline_reached");
  // Same row either way — this only sharpens the explanation.
  assertEquals(rec.status, "partial");
  assertEquals(rec.resumable, true);
});

Deno.test("3c. a run that DID observe state keeps every answer it had", () => {
  const observed: FinalizerState = {
    completed_capabilities: ["general_company_discovery", "persistence"],
    pending_capabilities: [],
    failed_capabilities: [],
    provider_attempts: [],
    pending_runs: [],
    accumulated_cost_units: 3,
    terminal_reason: null,
    qualified_company_keys: [],
  };
  // Genuinely ran everything and genuinely qualified nobody. UNCHANGED.
  const rec = decideTerminalRecord(observed, ctx());
  assertEquals(rec.status, "completed");
  assertEquals(rec.reason, "no_qualified_companies");
  assertEquals(rec.resumable, false);

  // And one that qualified somebody is still a clean completion.
  const ok = decideTerminalRecord(
    { ...observed, qualified_company_keys: ["c1"] }, ctx(),
  );
  assertEquals(ok.reason, "capability_plan_complete");
});

Deno.test("3d. pending capabilities still outrank the empty-result answer", () => {
  const rec = decideTerminalRecord({
    completed_capabilities: ["general_company_discovery"],
    pending_capabilities: ["company_brain_qualification"],
    qualified_company_keys: [],
  }, ctx());
  assertEquals(rec.status, "partial");
  assertEquals(rec.reason, "partial_capability_progress");
  assertEquals(rec.resumable, true);
});

Deno.test("3e. an in-flight paid run still outranks everything", () => {
  const rec = decideTerminalRecord({
    pending_runs: [{ run_id: "r1", dataset_id: null, provider: "apify" }],
    qualified_company_keys: [],
  }, ctx());
  assertEquals(rec.status, "pending_external_run");
  assertEquals(rec.resumable, true);
});

// ═══ 4. THE FINALIZER IS STILL TOTAL ═══════════════════════════════════════

Deno.test("4. every input still yields a status — no unknown outcome", () => {
  const inputs: Array<[FinalizerState | null | undefined, Record<string, unknown>]> = [
    [null, {}], [undefined, {}], [{}, {}],
    [null, { error: new Error("x") }], [null, { deadlineReached: true }],
    [{ terminal_reason: "provider_failure" }, {}],
    [{ terminal_reason: "provider_input_validation_failed" }, {}],
  ];
  for (const [st, c] of inputs) {
    const rec = decideTerminalRecord(st, ctx(c));
    assert(typeof rec.status === "string" && rec.status.length > 0);
    assert(typeof rec.reason === "string" && rec.reason.length > 0);
    assert(typeof rec.resumable === "boolean");
  }
});
