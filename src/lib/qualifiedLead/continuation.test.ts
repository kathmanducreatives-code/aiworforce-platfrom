// PART 6 + PART 7 — continuation UI state and honest terminal copy.
// ZERO network, ZERO model calls.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildContinuationView, initialContinuationState, continuationReducer,
  canDispatchContinue, buildContinuationRequest, isTerminal, TRUE_TERMINAL_STATUSES,
} from "./continuation.ts";

const TASK_ID = "71db3ced-0000-4000-8000-000000000001";

const CONTINUATION_RESPONSE = {
  terminal_status: "continuation_required",
  task_status: "partial",
  task_id: TASK_ID,
  continuation_token: TASK_ID,
  requested_leads: 5,
  eligible_leads: 1,
  remaining_leads: 4,
  rounds_completed: 1,
  next_round: 2,
  checkpoint_at: "2026-07-26T12:00:00.000Z",
};

Deno.test("PART 6: continuation_required renders the required four lines", () => {
  const v = buildContinuationView(CONTINUATION_RESPONSE);
  assertEquals(v.lines, [
    "Round 1 complete",
    "1 of 5 CONTACT-ready leads",
    "4 remaining",
    "More sourcing is required",
  ]);
  assertEquals(v.actionLabel, "Continue sourcing");
  assert(v.canContinue);
  assertEquals(v.nextRound, 2);
});

Deno.test("PART 6: Continue reuses the SAME task and never creates a new one", () => {
  const v = buildContinuationView(CONTINUATION_RESPONSE);
  const s0 = initialContinuationState(v, TASK_ID);
  const s1 = continuationReducer(s0, { type: "continue_clicked" });

  const req = buildContinuationRequest(s1)!;
  assertEquals(req.task_id, TASK_ID, "must resume the original task");
  assertEquals(req.continuation_token, TASK_ID);
  assertEquals(req.resume, true);
  assertEquals(req.create_new_task, false);

  // Resuming does not reset to round 1: the view still points at round 2.
  assertEquals(v.nextRound, 2);
});

Deno.test("PART 6: a double click cannot dispatch a second continuation", () => {
  const v = buildContinuationView(CONTINUATION_RESPONSE);
  let s = initialContinuationState(v, TASK_ID);

  assert(canDispatchContinue(s, v));
  s = continuationReducer(s, { type: "continue_clicked" });
  assertEquals(s.phase, "running");
  assertEquals(s.attempts, 1);

  // Second click while running: refused, and the attempt counter does not move.
  assertFalse(canDispatchContinue(s, v));
  const s2 = continuationReducer(s, { type: "continue_clicked" });
  assertEquals(s2.attempts, 1, "a concurrent continuation was allowed");
  assertEquals(s2, s);
});

Deno.test("PART 6: a failed continuation is recoverable and keeps the checkpoint", () => {
  const v = buildContinuationView(CONTINUATION_RESPONSE);
  let s = initialContinuationState(v, TASK_ID);
  s = continuationReducer(s, { type: "continue_clicked" });
  s = continuationReducer(s, { type: "failed", error: "network_error" });

  assertEquals(s.phase, "error");
  assertEquals(s.error, "network_error");
  assertEquals(s.lastCheckpointAt, "2026-07-26T12:00:00.000Z", "checkpoint must survive the failure");
  assertEquals(s.token, TASK_ID, "token must survive so the user can retry");
  assert(canDispatchContinue(s, v), "the user must be able to retry after an error");
});

Deno.test("PART 6: a successful continuation keeps the same task id", () => {
  const v1 = buildContinuationView(CONTINUATION_RESPONSE);
  let s = initialContinuationState(v1, TASK_ID);
  s = continuationReducer(s, { type: "continue_clicked" });
  const v2 = buildContinuationView({ ...CONTINUATION_RESPONSE, eligible_leads: 3, remaining_leads: 2, rounds_completed: 2, next_round: 3, checkpoint_at: "2026-07-26T12:05:00.000Z" });
  s = continuationReducer(s, { type: "succeeded", view: v2 });

  assertEquals(s.taskId, TASK_ID);
  assertEquals(s.phase, "idle");
  assertEquals(s.lastCheckpointAt, "2026-07-26T12:05:00.000Z");
  assertEquals(v2.lines[1], "3 of 5 CONTACT-ready leads");
});

Deno.test("PART 6: the Continue button is removed for every true terminal status", () => {
  for (const status of TRUE_TERMINAL_STATUSES) {
    const v = buildContinuationView({ ...CONTINUATION_RESPONSE, terminal_status: status });
    assertFalse(v.canContinue, `${status} must not offer Continue`);
    assertEquals(v.actionLabel, null, status);
    assert(isTerminal(status));
  }
  assertFalse(isTerminal("continuation_required"));
});

Deno.test("PART 6: continuation without a token offers no button", () => {
  const v = buildContinuationView({ ...CONTINUATION_RESPONSE, continuation_token: null });
  assertFalse(v.canContinue);
  assertEquals(v.actionLabel, null);
});

// ---- PART 7: terminal status copy -----------------------------------------

Deno.test("PART 7: terminal statuses map to honest copy", () => {
  const cases: Array<[string, number, number, string[]]> = [
    ["completed", 5, 0, ["Completed", "5 of 5 CONTACT-ready leads"]],
    ["round_limit_reached", 2, 3, ["Round limit reached", "2 of 5 CONTACT-ready leads", "3 remaining"]],
    ["budget_exhausted", 1, 4, ["Budget limit reached", "1 of 5 CONTACT-ready leads", "4 remaining"]],
    ["search_exhausted", 0, 5, ["Search exhausted", "0 of 5 CONTACT-ready leads", "5 remaining"]],
  ];
  for (const [status, eligible, remaining, expected] of cases) {
    const v = buildContinuationView({ terminal_status: status, requested_leads: 5, eligible_leads: eligible, remaining_leads: remaining });
    assertEquals(v.lines, expected, status);
  }
});

Deno.test("PART 7: 'Completed / 0 of 5' can never be produced", () => {
  // Every non-completed status keeps its own headline...
  for (const status of ["continuation_required", "round_limit_reached", "budget_exhausted", "search_exhausted", "quota_not_met", "provider_failure"]) {
    const v = buildContinuationView({ terminal_status: status, requested_leads: 5, eligible_leads: 0, remaining_leads: 5 });
    assertFalse(v.lines[0] === "Completed", `${status} collapsed into Completed`);
  }
  // ...and an unknown/absent status is not silently promoted either.
  const unknown = buildContinuationView({ requested_leads: 5, eligible_leads: 0, remaining_leads: 5 });
  assertFalse(unknown.lines[0] === "Completed");
  assertEquals(unknown.status, "invalid_request");
});

Deno.test("PART 7: a completed run states the delivered count, not a bare success", () => {
  const v = buildContinuationView({ terminal_status: "completed", requested_leads: 5, eligible_leads: 5, remaining_leads: 0 });
  assertEquals(v.lines, ["Completed", "5 of 5 CONTACT-ready leads"]);
});
