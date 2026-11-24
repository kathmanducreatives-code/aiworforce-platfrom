// A COMPANY WHOSE ONLY EVALUATOR CALL FAILED (canary session 2, Oscilar).
//
// Reviewed behaviour, kept: a resume evaluates nothing (Q4.9), so by default
// such a company is never evaluated again. `LEAD_REEVALUATE_FAILED_EVALUATION=on`
// opts in to ONE re-evaluation of a call that was made and failed — never of
// "no evaluator", "budget spent" or a timeout. Real engine, Q4 harness.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runAcceptanceCase } from "./q4/acceptanceHarness.ts";
import { failedEvaluationMarks, retryFailedEvaluation } from "../../../supabase/functions/_shared/missionEvaluation.ts";

const AE = "Find 1 B2B software company hiring Account Executives within the last 30 days.";
const ON = { LEAD_REEVALUATE_FAILED_EVALUATION: "on" };
const run = (id: string, evaluator: "http_error" | "http_error_once" | "timeout", env?: Record<string, string>) =>
  runAcceptanceCase({ id, request: AE, signal: ["hiring Account Executives"], evaluator, ...(env ? { env } : {}) });

Deno.test("retry OFF (default): a failed evaluation is never re-asked — Q4.9's rule, unchanged", async () => {
  const f = await run("retry-off", "http_error_once");
  assertEquals(f.qualifiedKeys.length, 0, "the evaluator never answered, so nothing qualifies");
  assertEquals(f.resume!.evaluatorCallsAdded, 0);
  const marks = Object.values(f.mission_evaluations).map((e) => failedEvaluationMarks(e as never));
  assert(marks.every((m) => m.failed && !m.retried), JSON.stringify(marks));
});

Deno.test("retry ON: the failed call is re-asked once on the next slice, and its answer decides", async () => {
  const f = await run("retry-on", "http_error_once", ON);
  assertEquals(f.qualifiedKeys.length, 1, "the second, answered evaluation qualifies the company");
  assertEquals(f.resume!.evaluatorCallsAdded, 0, "once answered, a resume evaluates nothing (Q4.9 holds)");
});

Deno.test("retry ON, the retry fails too: exactly one retry, then the decision is restored like any other", async () => {
  const f = await run("retry-twice", "http_error", ON);
  assertEquals(f.qualifiedKeys.length, 0);
  assertEquals(f.resume!.evaluatorCallsAdded, 0, "no third call on a later resume");
  const marks = Object.values(f.mission_evaluations).map((e) => failedEvaluationMarks(e as never));
  assert(marks.every((m) => m.failed && m.retried), JSON.stringify(marks));
});

Deno.test("retry ON never touches a timeout or an absent evaluator: Q4.9 holds with the flag on", async () => {
  const f = await run("retry-timeout", "timeout", ON);
  assertEquals(f.qualifiedKeys.length, 0);
  assertEquals(f.resume!.evaluatorCallsAdded, 0);
  assert(Object.values(f.mission_evaluations).every((e) => !failedEvaluationMarks(e as never).failed));
});

Deno.test("the flag is read from the process environment when the engine is given no reader (run-agent's case)", () => {
  const failed = { unknown_fields: ["not_evaluated", "evaluation_failed"] };
  assertEquals(retryFailedEvaluation(failed, (k) => (k === "LEAD_REEVALUATE_FAILED_EVALUATION" ? "on" : undefined)), true);
  assertEquals(retryFailedEvaluation(failed, () => undefined), false, "off by default");
  assertEquals(retryFailedEvaluation({ unknown_fields: ["not_evaluated", "evaluation_failed", "evaluation_retried"] }, () => "on"), false);
  assertEquals(retryFailedEvaluation({ unknown_fields: ["not_evaluated"] }, () => "on"), false, "never a placeholder for no call");
  // No reader: the process environment (unset here) decides — still off.
  assertEquals(retryFailedEvaluation(failed), false);
});
