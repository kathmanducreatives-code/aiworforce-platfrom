// "NOTHING QUALIFIED IN MY SLICE" IS NOT "THIS REQUEST IS OVER".
//
// ── THE RUN THIS EXISTS FOR ────────────────────────────────────────────────
//
// Run 7e71d8bc, 2026-08-31. Generation 1 checkpointed `continuation_required`
// with 21 candidates left and dispatched its successor cleanly:
//
//     10:28:36  continuation_dispatched  handed_off: true
//     10:28:37  terminal_guard_decision  status: partial      ← gen 1, correct
//     10:28:46  terminal_guard_decision  status: partial      ← gen 2, correct
//     10:28:46  terminal_guard_skip_task current: "complete"  ← already stamped
//
// Both guards said `partial`. Between them, the successor fell through to the
// legacy "no results" terminal — which had never been asked whether the run was
// finished — and stamped `tasks.status = "complete"` plus
// `task_plans.status = "failed"` over a live checkpoint.
//
// `resume-stalled-leads` selects `status = "ready"`. So the run was stranded:
// the same ending as fd4ed70a, reached by a writer that bypasses the finalizer
// entirely, which is why fixing the finalizer alone did not stop it.
//
// ZERO network, ZERO DB.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  holdsResumableWork, isContinuable,
} from "../../supabase/functions/_shared/taskStatusContract.ts";
import {
  eligibleForAutoResume,
} from "../../supabase/functions/_shared/stalledLeadResume.ts";

// deno-lint-ignore no-explicit-any
const any = (o: unknown): any => o;

/** The exact result generation 1 of 7e71d8bc left behind. */
const GEN1_RESULT = {
  task_status: "partial",
  terminal_status: "continuation_required",
  resumable: true,
  auto_continuation: {
    continuing: true,
    decision: "quota_unmet_frontier_remains",
    detail: "0 of 5 qualified, 21 candidates still to investigate",
  },
};

// ═══ 1. THE GUARD ══════════════════════════════════════════════════════════

Deno.test("1. a checkpointed run owes a continuation and must not be finalized", () => {
  assert(holdsResumableWork(GEN1_RESULT));
});

Deno.test("1b. either signal alone is enough", () => {
  // The claim gate's own vocabulary.
  assert(holdsResumableWork({ terminal_status: "continuation_required" }));
  // A slice that decided to continue but had not yet written a terminal status
  // still represents paid, restorable work.
  assert(holdsResumableWork({ auto_continuation: { continuing: true } }));
});

Deno.test("1c. a genuinely finished run is still finalizable", () => {
  for (const result of [
    {},
    null,
    undefined,
    { terminal_status: "round_limit_reached" },
    { terminal_status: "search_exhausted" },
    { terminal_status: "completed" },
    { terminal_status: "provider_failure" },
    // Decided NOT to continue — the frontier is exhausted or a ceiling hit.
    { terminal_status: "round_limit_reached", auto_continuation: { continuing: false } },
  ]) {
    assertEquals(holdsResumableWork(result as never), false,
      `${JSON.stringify(result)} must remain finalizable`);
  }
});

Deno.test("1d. `continuing` must be exactly true — no truthy coercion", () => {
  // A stray string or number in that slot must not block a legitimate terminal.
  for (const v of ["true", 1, {}, [], "yes"]) {
    assertEquals(holdsResumableWork({ auto_continuation: { continuing: v } }), false);
  }
  assertEquals(holdsResumableWork({ auto_continuation: { continuing: false } }), false);
});

Deno.test("1e. it agrees with the claim gate, not a second opinion", () => {
  // `isContinuable` is what `claim_sourcing_continuation` enforces; the guard
  // reads it rather than re-deciding what "resumable" means.
  assert(isContinuable("continuation_required"));
  assert(!isContinuable("round_limit_reached"));
  assert(holdsResumableWork({ terminal_status: "continuation_required" }));
  assert(!holdsResumableWork({ terminal_status: "round_limit_reached" }));
});

// ═══ 2. THE OUTCOME THE GUARD PROTECTS ═════════════════════════════════════

const sweeperRow = (status: string, result: Record<string, unknown>) => any({
  id: "t1",
  status,
  updated_at: new Date(Date.now() - 20 * 60_000).toISOString(),
  created_at: new Date(Date.now() - 25 * 60_000).toISOString(),
  continuation_claim_expires_at: null,
  result: {
    ...result,
    company_first_state: { qualified_company_keys: [], completed_capabilities: [] },
  },
});

Deno.test("2. stamped `complete`, the row is invisible to the sweeper forever", () => {
  const verdict = eligibleForAutoResume(sweeperRow("complete", GEN1_RESULT), Date.now());
  assertEquals(verdict.reason, "not_ready");
  assertEquals(verdict.disposition, "skip");
});

Deno.test("2b. left alone, the row is still reachable", () => {
  const verdict = eligibleForAutoResume(sweeperRow("ready", GEN1_RESULT), Date.now());
  assert(verdict.reason !== "not_ready",
    `the sweeper must still see this row (got ${verdict.reason})`);
  assert(verdict.reason !== "already_terminal",
    "continuation_required is the one claimable terminal status");
});

// ═══ 3. THE BRANCH IS WIRED TO THE GUARD ═══════════════════════════════════

const RUN = Deno.readTextFileSync(
  new URL("../../supabase/functions/run-agent/index.ts", import.meta.url),
);

Deno.test("3. the no-results terminal is gated, and so is the plan write", () => {
  assert(RUN.includes("const continuationOutstanding = holdsResumableWork(noResPrior);"),
    "the branch must ask whether a continuation is outstanding");
  assert(RUN.includes('continuationOutstanding ? {} : { status: "complete" }'),
    "the task status stamp must be withheld when it is");
  assert(/if \(!continuationOutstanding\) \{\s*await supabase\.from\("task_plans"\)\.update\(\{ status: "failed"/.test(RUN),
    "and the plan must not be failed either — one stamp without the other is still a lie");
});

Deno.test("3b. the run's own account of what it found is still written", () => {
  // Only the terminal stamps are withheld. `writeTaskResult` still merges the
  // result patch, because "nothing qualified" is a verdict worth recording even
  // when the request continues.
  const i = RUN.indexOf("const continuationOutstanding = holdsResumableWork(noResPrior);");
  assert(i > 0);
  const after = RUN.slice(i, i + 2500);
  assert(after.includes("await writeTaskResult("),
    "the result patch is written on both paths");
  assert(after.includes("no_qualified_matches: true"),
    "including the no-results verdict itself");
});
