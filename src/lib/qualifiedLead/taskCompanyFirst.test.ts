// READING THE PERSISTED RUN, NOT THE LIVE HTTP REPLY.
//
// After a reload or a realtime update the only copy of the run is
// `tasks.result`. These tests use the ACTUAL persisted payload from production
// task 6ffc14c8-e72e-4406-88c8-576788cf5651 (plan
// 3d54e4fe-b6b6-47a6-9dca-ee032785ea59, 2026-07-29) so the fixture cannot drift
// from what the backend really writes.
//
// ZERO network, ZERO model calls.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { companyFirstResponseFromTask, companyFirstCandidatesFromTask } from "./taskCompanyFirst.ts";
import { buildContinuationView } from "./continuation.ts";

/** Verbatim shape of the production row, trimmed to the fields read here. */
const PRODUCTION_TASK = {
  id: "6ffc14c8-e72e-4406-88c8-576788cf5651",
  // PR #115: `ready` = checkpointed and resumable. NOT complete.
  status: "ready",
  result: {
    task_status: "partial",
    terminal_status: "continuation_required",
    output: "Company-first sourcing (continuation_required): 0/5 eligible leads across 2 round(s)",
    company_first: {
      status: "continuation_required",
      rounds_attempted: 2,
      provider_calls: 2,
      budget_consumed: 0.5,
      items: [],
      counts: { rawJobs: 50, verifiedCompanies: 0, contact: 0, persisted: 0 },
      quota: {
        quota_policy: "contact_only",
        requested_leads: 5,
        eligible_leads: 0,
        remaining_leads: 5,
      },
      continuation: {
        required: true,
        next_round: 3,
        next_action: "start_round",
        checkpoint_at: "2026-07-29T00:10:36.304Z",
        continuation_token: "6ffc14c8-e72e-4406-88c8-576788cf5651",
      },
    },
  },
};

// --------------------------------------------- companyFirstResponseFromTask ---

Deno.test("the persisted row maps onto the continuation contract", () => {
  const res = companyFirstResponseFromTask(PRODUCTION_TASK)!;
  assertEquals(res.terminal_status, "continuation_required");
  assertEquals(res.task_status, "partial");
  assertEquals(res.row_status, "ready");
  assertEquals(res.task_id, "6ffc14c8-e72e-4406-88c8-576788cf5651");
  assertEquals(res.continuation_token, "6ffc14c8-e72e-4406-88c8-576788cf5651");
  assertEquals(res.next_round, 3);
  assertEquals(res.rounds_completed, 2);
});

Deno.test("a task with no company-first block yields nothing to render", () => {
  assertEquals(companyFirstResponseFromTask({ id: "t", status: "running", result: {} }), null);
  assertEquals(companyFirstResponseFromTask({ id: "t", status: "pending", result: null }), null);
  assertEquals(companyFirstResponseFromTask(null), null);
});

Deno.test("pre-split rows fall back to the company-first block", () => {
  const legacy = {
    id: "t",
    status: "partial",
    result: { company_first: { status: "continuation_required", quota: {}, continuation: {} } },
  };
  const res = companyFirstResponseFromTask(legacy)!;
  assertEquals(res.terminal_status, "continuation_required");
  assertEquals(res.task_status, "partial");
});

Deno.test("candidate rows are read, and an empty run is tolerated", () => {
  assertEquals(companyFirstCandidatesFromTask(PRODUCTION_TASK), []);
  assertEquals(companyFirstCandidatesFromTask(null), []);
});

// ------------------------------------------------ 8./9./10. what is rendered ---

Deno.test("8. Continue sourcing is offered — continuation is safe", () => {
  const view = buildContinuationView(companyFirstResponseFromTask(PRODUCTION_TASK));
  assertEquals(view.status, "continuation_required");
  assert(view.canContinue, "a checkpointed run with a token is continuable");
  assertEquals(view.actionLabel, "Continue sourcing");
  // Resumes the SAME task at round 3 — rounds 1 and 2 are not paid for twice.
  assertEquals(view.continuationToken, "6ffc14c8-e72e-4406-88c8-576788cf5651");
  assertEquals(view.nextRound, 3);
});

Deno.test("8b. Continue is withheld when the ROW is no longer resumable", () => {
  const view = buildContinuationView(
    companyFirstResponseFromTask({ ...PRODUCTION_TASK, status: "failed" }),
  );
  assertFalse(view.canContinue);
  assertEquals(view.actionLabel, null);
});

Deno.test("8c. Continue is withheld without a continuation token", () => {
  const noToken = {
    ...PRODUCTION_TASK,
    result: {
      ...PRODUCTION_TASK.result,
      company_first: { ...PRODUCTION_TASK.result.company_first, continuation: { required: true } },
    },
  };
  const view = buildContinuationView(companyFirstResponseFromTask(noToken));
  assertFalse(view.canContinue);
  assertEquals(view.actionLabel, null);
});

Deno.test("9. zero eligible leads reads truthfully as 0 of 5", () => {
  const view = buildContinuationView(companyFirstResponseFromTask(PRODUCTION_TASK));
  assert(view.lines.includes("0 of 5 CONTACT-ready leads"), view.lines.join(" | "));
  assert(view.lines.includes("5 remaining"), view.lines.join(" | "));
  assert(view.lines.includes("More sourcing is required"), view.lines.join(" | "));
  // The failure this contract exists to prevent: a run that delivered nothing
  // reporting itself as finished.
  assertFalse(view.lines.includes("Completed"));
  assertFalse(view.lines.join(" ").includes("5 of 5"));
});

Deno.test("9b. a genuinely completed run still reports completed", () => {
  const done = {
    id: "t",
    status: "complete",
    result: {
      task_status: "completed",
      terminal_status: "completed",
      company_first: {
        status: "completed",
        rounds_attempted: 3,
        items: [],
        quota: { requested_leads: 5, eligible_leads: 5, remaining_leads: 0 },
        continuation: {},
      },
    },
  };
  const view = buildContinuationView(companyFirstResponseFromTask(done));
  assertEquals(view.status, "completed");
  assertFalse(view.canContinue);
  assert(view.lines.includes("5 of 5 CONTACT-ready leads"));
});

Deno.test("10. this module only READS — the persisted result is never mutated", () => {
  const before = JSON.stringify(PRODUCTION_TASK);
  companyFirstResponseFromTask(PRODUCTION_TASK);
  companyFirstCandidatesFromTask(PRODUCTION_TASK);
  buildContinuationView(companyFirstResponseFromTask(PRODUCTION_TASK));
  assertEquals(JSON.stringify(PRODUCTION_TASK), before);
});
