// LEAD V2 RUN 4250f181 — WHEN MAY THE UI OFFER "CONTINUE"?
//
// The audited mission ended with the queue failed and the task still reading
// `ready / continuation_required`, so every surface kept offering Continue on a
// mission nothing would run again. And while it WAS running, Continue was on
// offer beside a queue that re-claims the mission by itself — one click would
// have started a second executor. Neither may happen.
//
// PURE. Reads the view model the Workbench card renders from.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildContinuationView } from "../../src/lib/qualifiedLead/continuation.ts";

const paused = {
  terminal_status: "continuation_required", row_status: "ready", task_id: "t1",
  continuation_token: "tok", requested_leads: 1, eligible_leads: 0, remaining_leads: 1,
  rounds_completed: 1,
};

Deno.test("an ordinary checkpoint still offers Continue", () => {
  const v = buildContinuationView(paused);
  assert(v.canContinue);
  assertEquals(v.actionLabel, "Continue sourcing");
});

Deno.test("a V2 queue-owned checkpoint offers no Continue — the worker continues it", () => {
  const v = buildContinuationView({ ...paused, continuation_owner: "v2_queue" });
  assertFalse(v.canContinue);
  assertEquals(v.actionLabel, null);
  assert(v.lines.includes("Continuing automatically"));
});

Deno.test("a mission the queue ended offers no Continue", () => {
  // The reconciled terminal state: task failed, terminal status no longer continuation_required.
  const v = buildContinuationView({
    ...paused, row_status: "failed", terminal_status: "retry_budget_exhausted", continuation_token: "tok",
  });
  assertFalse(v.canContinue);
  assertEquals(v.actionLabel, null);
  // And the audited contradiction itself — a failed row still saying continuation_required.
  const contradictory = buildContinuationView({ ...paused, row_status: "failed" });
  assertFalse(contradictory.canContinue, "a failed row is never continuable");
});

Deno.test("the chat checkpoint card is not rendered for a queue-owned run", () => {
  const src = Deno.readTextFileSync(new URL("../../src/components/chat/workspace/ChatView.tsx", import.meta.url));
  assert(src.includes("meta.continuation_owner !== 'v2_queue'"));
});
