// AN ADOPTED RUN MUST STOP BEING PENDING — AND THE SETTLE MUST BE WRITABLE.
//
// ── THE RUN THIS EXISTS FOR ────────────────────────────────────────────────
//
// Task e01ad74f, 2026-09-01. Apify run sYUy3Er8siHqMDocB succeeded at 07:56
// with 26 job rows. At 08:06 the next slice adopted it correctly — 26 rows
// read, spliced out of `pending_runs` — and then:
//
//   [run-agent][run-adopted] settle failed { error: "[object Object]" }
//
// The settle wrote `cost_source: "reused_no_charge"`, which
// `lead_execution_calls_cost_source_check` does not permit. The UPDATE was
// rejected, the started row stayed `started`, and `recoverPendingRuns`
// resurrected it on every later slice — undoing the removal each time.
// `decideAutoContinuation` reads a non-empty pending list as
// `awaiting_provider_run` and defers, so the lineage burned five continuations
// and three barren slices waiting for a run it had already read.
//
// Every component was individually correct. One invalid enum value undid all
// of them, once per slice, and `String(error)` hid why for three days.
//
// ZERO network, ZERO DB, ZERO provider spend.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  recoverPendingRuns, mergePendingRuns, type LedgerStartedRow,
} from "../../supabase/functions/_shared/pendingRunRecovery.ts";

/**
 * The values `lead_execution_calls_cost_source_check` permits, copied from the
 * live constraint. A settle that writes anything else is rejected outright.
 */
const ALLOWED_COST_SOURCE = [
  "provider_reported", "event_priced", "estimated", "unknown",
] as const;

const started = (runId: string, input: unknown = { company: ["a"] }): LedgerStartedRow => ({
  capability: "apify_linkedin_job_search",
  provider_id: "apify",
  provider_run_id: runId,
  dataset_id: `ds-${runId}`,
  status: "started",
  request_input: { input },
  started_at: "2026-09-01T07:54:55.204+00:00",
  created_at: "2026-09-01T07:54:55.204+00:00",
} as unknown as LedgerStartedRow);

Deno.test("the settle's cost_source is a value the constraint permits", async () => {
  // THE ASSERTION THAT WOULD HAVE CAUGHT THIS BEFORE PRODUCTION DID.
  //
  // Read out of the source rather than restated, so the test fails if the
  // literal drifts back to something the database will not accept.
  const src = await Deno.readTextFile(
    new URL("../../supabase/functions/run-agent/index.ts", import.meta.url),
  );
  const settle = src.slice(src.indexOf("onRunAdopted: async (info)"));
  // Bounded by the UPDATE's own filter chain, which is code and cannot move.
  // An earlier version cut the block at the string "next_decision" and a
  // COMMENT mentioning that field truncated it before the assignment, so the
  // search found nothing and the count assertion below is what caught it.
  const block = settle.slice(0, settle.indexOf('.eq("provider_run_id"'));
  // ── CODE LINES ONLY, NEVER COMMENTS ────────────────────────────────────
  //
  // The first version of this matched the whole block with a regex and read
  // `cost_source: "unknown"` out of the explanatory comment a few lines above
  // the assignment — so it reported the right answer whatever the code said.
  // A test that cannot fail is worse than no test, and this one is guarding a
  // value that already reached production wrong once.
  const assigned = block.split("\n")
    .map((l) => l.trim())
    .filter((l) => !l.startsWith("//") && !l.startsWith("*"))
    .map((l) => l.match(/^cost_source:\s*"([a-z_]+)"\s*,?$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => m[1]);
  assertEquals(assigned.length, 1,
    `the settle path must set cost_source exactly once (found ${assigned.length})`);
  assert(
    (ALLOWED_COST_SOURCE as readonly string[]).includes(assigned[0]),
    `cost_source "${assigned[0]}" is not one of ${ALLOWED_COST_SOURCE.join(", ")} — ` +
    `the UPDATE would be rejected and the started row would never settle`,
  );
});

Deno.test("a run with a terminal row is not resurrected", () => {
  const rows = [started("RUN-A"), started("RUN-B", { company: ["b"] })];
  // RUN-A was adopted; its settle may or may not have landed.
  const out = recoverPendingRuns(rows, new Set(["RUN-A"]));
  assertEquals(out.map((r) => r.run_id), ["RUN-B"],
    "an accounted-for run must not be re-queued as pending");
});

Deno.test("every terminal status counts as accounted for", () => {
  // `reused`, `succeeded`, `failed`, `timed_out` all mean somebody wrote an
  // outcome. None of them should come back as pending.
  for (const runId of ["R1", "R2", "R3", "R4"]) {
    assertEquals(
      recoverPendingRuns([started(runId)], new Set([runId])).length, 0, runId);
  }
});

Deno.test("without the guard, behaviour is exactly what it was", () => {
  // Absent or empty must preserve the previous contract — this is a guard, not
  // a change to what recovery means.
  const rows = [started("RUN-A")];
  assertEquals(recoverPendingRuns(rows).length, 1);
  assertEquals(recoverPendingRuns(rows, new Set()).length, 1);
});

Deno.test("a genuinely pending run is still recovered", () => {
  // The whole point of recovery: a hard-killed slice's paid run must come back
  // so it can be adopted rather than re-bought.
  const out = recoverPendingRuns([started("RUN-LIVE")], new Set(["RUN-OTHER"]));
  assertEquals(out.length, 1);
  assertEquals(out[0].run_id, "RUN-LIVE");
  assertEquals(out[0].provider, "apify_linkedin_job_search");
  assert(out[0].input_fingerprint, "the fingerprint is what makes adoption exact");
});

Deno.test("the settle failure is logged with a readable cause", async () => {
  // `String(error)` on a PostgREST error yields "[object Object]", which is how
  // a CHECK violation ran in production looking like a generic failure.
  const src = await Deno.readTextFile(
    new URL("../../supabase/functions/run-agent/index.ts", import.meta.url),
  );
  const i = src.indexOf('"[run-agent][run-adopted] settle failed"');
  assert(i > 0, "the settle failure must still be logged");
  const block = src.slice(i, i + 400);
  assert(!/error:\s*String\(error\)/.test(block),
    "String(error) erases the message — log the error's own fields");
  for (const field of ["message", "code", "details", "hint"]) {
    assert(block.includes(field), `the log should carry ${field}`);
  }
});

// ══ THE CHECKPOINT SIDE ════════════════════════════════════════════════════
//
// The ledger guard above is only half of it. Task e01ad74f proved the other
// half the hard way: after that guard shipped, its recovery correctly logged
// `skipped already-resolved` — and the lineage stayed parked, because the same
// entry was already sitting in the restored checkpoint.

const cp = (runId: string) => ({ run_id: runId, provider: "apify_linkedin_job_search" });

Deno.test("a settled run is dropped from the checkpoint too", () => {
  const out = mergePendingRuns([cp("RUN-A"), cp("RUN-B")], [], new Set(["RUN-A"]));
  assertEquals(out.map((r) => r.run_id), ["RUN-B"],
    "a checkpointed entry the ledger has settled must not survive the merge");
});

Deno.test("a genuinely pending checkpointed run survives", () => {
  const out = mergePendingRuns([cp("RUN-A")], [], new Set(["RUN-OTHER"]));
  assertEquals(out.map((r) => r.run_id), ["RUN-A"]);
});

Deno.test("both sides are filtered, and the merge still dedupes", () => {
  const out = mergePendingRuns(
    [cp("RUN-A"), cp("RUN-DUP")],
    [
      { run_id: "RUN-DUP" } as never,
      { run_id: "RUN-NEW" } as never,
      { run_id: "RUN-A" } as never,
    ],
    new Set(["RUN-A"]),
  );
  assertEquals(out.map((r) => r.run_id), ["RUN-DUP", "RUN-NEW"],
    "RUN-A dropped from both sides; RUN-DUP counted once");
});

Deno.test("without a resolved set the merge is exactly what it was", () => {
  const checkpointed = [cp("RUN-A")];
  const recovered = [{ run_id: "RUN-A" } as never, { run_id: "RUN-B" } as never];
  assertEquals(
    mergePendingRuns(checkpointed, recovered).map((r) => r.run_id),
    ["RUN-A", "RUN-B"]);
  assertEquals(
    mergePendingRuns(checkpointed, recovered, new Set()).map((r) => r.run_id),
    ["RUN-A", "RUN-B"]);
});

Deno.test("run-agent passes the resolved set to BOTH guards", async () => {
  const src = await Deno.readTextFile(
    new URL("../../supabase/functions/run-agent/index.ts", import.meta.url),
  );
  assert(src.includes("recoverPendingRuns(startedRunRows, resolvedRunIds)"),
    "the ledger side must be filtered");
  const i = src.indexOf("pending_runs: mergePendingRuns(");
  assert(i > 0, "the checkpoint merge must be wired");
  assert(src.slice(i, i + 220).includes("resolvedRunIds"),
    "the checkpoint side must be filtered by the same set");
});

Deno.test("the prune is reached even when nothing is recovered", async () => {
  // ── THE BUG THIS PINS ───────────────────────────────────────────────────
  //
  // The state builder short-circuited on `recoveredPendingRuns.length === 0`,
  // which is exactly what the ledger guard produces when it does its job: the
  // settled run is skipped, the recovered list is empty, and the merge — and
  // with it the prune — is never reached. The guard working was what stopped
  // the stale checkpoint entry being removed.
  const src = await Deno.readTextFile(
    new URL("../../supabase/functions/run-agent/index.ts", import.meta.url),
  );
  const i = src.indexOf("const restored =");
  assert(i > 0, "the state builder must be present");
  const block = src.slice(i, src.indexOf("} as typeof restored;", i));
  assert(
    !/if \(!restored \|\| recoveredPendingRuns\.length === 0\) return restored;/
      .test(block),
    "an empty recovered list must not skip the prune",
  );
  assert(block.includes("resolvedRunIds.size === 0"),
    "the short-circuit must require nothing to add AND nothing to remove");
});

// ══ THE SWEEPER'S WINDOW ═══════════════════════════════════════════════════

Deno.test("the sweeper query excludes finished runs in SQL, not only in code", async () => {
  // ── THE REGRESSION THIS PINS ────────────────────────────────────────────
  //
  // Widening the query to `status in ('ready','complete')` — so a stamped-over
  // checkpoint could be recovered — also admitted every genuinely FINISHED run,
  // because `quota_met` and `search_exhausted` both leave `status: complete`.
  // `eligibleForAutoResume` refuses them as `already_terminal`, correctly, but a
  // refusal changes nothing about the row, so it matches again on every tick.
  //
  // Production, the day it shipped: 72 rows in the window, 54 of them permanent
  // residents. Ordered oldest-first with `limit 50` they held the whole window,
  // and the lineages that needed resuming — which sort newest — were never
  // reached. The same predicate in SQL brings the window to 14.
  const src = await Deno.readTextFile(
    new URL("../../supabase/functions/resume-stalled-leads/index.ts", import.meta.url),
  );
  const i = src.indexOf("let q = admin.from(\"tasks\")");
  assert(i > 0, "the sweeper query must be present");
  const raw = src.slice(i, src.indexOf(".limit(50)", i));
  // CODE ONLY. The comment above the query quotes the predicate it replaced, and
  // a whole-block regex reads that quotation as the live code — the same way an
  // earlier version of the `cost_source` test read its answer out of a comment.
  const block = raw.split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  assert(
    !/\.in\("status",\s*\["ready",\s*"complete"\]\)/.test(block),
    "an unqualified `complete` lets finished runs occupy the window for ever",
  );
  assert(block.includes("status.eq.ready"), "a `ready` row is still swept");
  assert(
    block.includes("result->>terminal_status.eq.continuation_required"),
    "and a `complete` row only when it still claims a continuation",
  );
  // The window must stay ordered oldest-first and bounded — starvation is what
  // the predicate above exists to prevent, not something it may reintroduce.
  assert(block.includes('.order("updated_at", { ascending: true })'));
});
