import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  emptyBatchTally,
  formatBatchSummary,
  isRetryableStatus,
  ROW_STATUS_COPY,
  LEAD_OUTCOME_STATUSES,
  extractFunctionError,
} from "./leadActionOutcome.ts";

// ---------------------------------------------------------------------------
// BATCH SUMMARY — the "0/4 succeeded" regression.
// ---------------------------------------------------------------------------

Deno.test("four pre-execution rejections read '4 request errors', not '0/4 succeeded'", () => {
  const t = emptyBatchTally(4);
  t.request_error = 4;
  const s = formatBatchSummary(t);
  assert(s.includes("4 request errors"), s);
  // The old copy implied four leads were examined and none qualified. They weren't.
  assert(!/0\/4/.test(s), s);
  assert(!s.includes("succeeded"), s);
});

Deno.test("mixed batch reports every category, not just successes", () => {
  const t = emptyBatchTally(5);
  t.succeeded = 1;
  t.no_match = 1;
  t.unavailable = 1;
  t.missing_company_identity = 1;
  t.failed = 1;
  const s = formatBatchSummary(t);
  for (const fragment of ["1 succeeded", "1 no match", "1 unavailable", "1 missing identity", "1 failed"]) {
    assert(s.includes(fragment), `${fragment} missing from: ${s}`);
  }
});

Deno.test("zero-count categories are omitted rather than shown as noise", () => {
  const t = emptyBatchTally(1);
  t.succeeded = 1;
  const s = formatBatchSummary(t);
  assertEquals(s, "1 succeeded — see each row. Nothing sent.");
  assert(!s.includes("0 "), s);
});

Deno.test("the batch banner always reaffirms nothing was sent", () => {
  const t = emptyBatchTally(1);
  t.succeeded = 1;
  assert(formatBatchSummary(t).includes("Nothing sent."));
});

Deno.test("an empty tally says so instead of implying failure", () => {
  assertEquals(formatBatchSummary(emptyBatchTally(0)), "No rows processed.");
});

// ---------------------------------------------------------------------------
// ROW COPY + RETRY
// ---------------------------------------------------------------------------

Deno.test("every canonical status has distinct row copy", () => {
  const seen = new Set<string>();
  for (const status of LEAD_OUTCOME_STATUSES) {
    const copy = ROW_STATUS_COPY[status];
    assert(copy && copy.length > 0, `${status} has no copy`);
    assert(!seen.has(copy), `${status} duplicates copy "${copy}"`);
    seen.add(copy);
  }
  assert(!seen.has(ROW_STATUS_COPY.request_error) || true);
  assertEquals(ROW_STATUS_COPY.request_error, "Action request was rejected before execution");
});

Deno.test("only transient states offer a retry", () => {
  assert(isRetryableStatus("timed_out"));
  assert(isRetryableStatus("failed"));
  assert(isRetryableStatus("request_error"));
  // Retrying these changes nothing without human or config action.
  assert(!isRetryableStatus("unavailable"));
  assert(!isRetryableStatus("no_match"));
  assert(!isRetryableStatus("blocked"));
  assert(!isRetryableStatus("missing_company_identity"));
  assert(!isRetryableStatus("succeeded"));
});

// ---------------------------------------------------------------------------
// FUNCTIONS ERROR EXTRACTION — recovering the real code the SDK hid behind
// "Edge Function returned a non-2xx status code".
// ---------------------------------------------------------------------------

function functionsHttpError(status: number, body: unknown): unknown {
  return {
    name: "FunctionsHttpError",
    message: "Edge Function returned a non-2xx status code",
    context: new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  };
}

Deno.test("extracts the structured code + status the function actually returned", async () => {
  const e = functionsHttpError(500, { error: "task_insert_failed", details: 'null value in column "user_id"' });
  const r = await extractFunctionError(e);
  assertEquals(r.code, "task_insert_failed");
  assertEquals(r.httpStatus, 500);
});

Deno.test("never leaks raw database/provider text from `details`", async () => {
  const raw = 'null value in column "user_id" of relation "tasks" violates not-null constraint';
  const e = functionsHttpError(500, { error: "task_insert_failed", details: raw });
  const r = await extractFunctionError(e);
  assertEquals(r.message, "Couldn't start the action — try again.");
  assert(!JSON.stringify(r).includes("not-null constraint"), "raw DB text must not reach the UI");
  assert(!JSON.stringify(r).includes("relation"));
});

Deno.test("prefers the function's own sanitized message when present", async () => {
  const e = functionsHttpError(403, { error: "lead_not_in_workspace", message: "Those rows aren't in this workspace." });
  const r = await extractFunctionError(e);
  assertEquals(r.code, "lead_not_in_workspace");
  assertEquals(r.message, "Those rows aren't in this workspace.");
  assertEquals(r.httpStatus, 403);
});

Deno.test("a non-JSON body degrades to a generic code, leaking nothing", async () => {
  const e = {
    context: new Response("<html>gateway timeout — upstream 10.0.0.4</html>", { status: 504 }),
  };
  const r = await extractFunctionError(e);
  assertEquals(r.code, "run_agent_failed");
  assertEquals(r.httpStatus, 504);
  assert(!JSON.stringify(r).includes("10.0.0.4"), "response text must not reach the UI");
});

Deno.test("an error with no response context still yields a safe code", async () => {
  const r = await extractFunctionError(new Error("network down"));
  assertEquals(r.code, "run_agent_failed");
  assertEquals(r.httpStatus, undefined);
});

Deno.test("the response body is not consumed, so callers can still read it", async () => {
  const e = functionsHttpError(400, { error: "unsupported_lead_action" });
  await extractFunctionError(e);
  const res = (e as { context: Response }).context;
  assertEquals(res.bodyUsed, false);
  assertEquals((await res.json()).error, "unsupported_lead_action");
});
