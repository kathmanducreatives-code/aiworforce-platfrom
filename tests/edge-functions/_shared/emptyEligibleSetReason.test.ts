// THE SENTENCE THAT COUNTED THE WRONG THING.
//
// When nobody reaches the Company Brain, this is the only place a run says WHY.
// It read:
//
//     the eligible set was empty (${companies.length} companies carried no
//     hiring assessment)
//
// `companies.length` is the size of the whole pool, printed whether or not a
// single company carried an assessment.
//
//   run 07e973f1   "29 companies carried no hiring assessment"  — 11 enriched
//   task 9da530ae  "50 companies carried no hiring assessment"  — ELEVEN
//                  carried one, all `hiring_not_verified`
//
// A pool nobody looked at and a pool that was looked at and found not to be
// hiring are different facts. This said the first in both cases, and reading it
// as evidence sent two separate investigations down the wrong path — the count
// looked like proof that the assessment stage had never run.
//
// The call site's own comment already insists on exactly this distinction one
// level up: "'nobody passed' and 'nobody was offered' are different facts."
//
// Pure. No network, no provider, no model call.

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  emptyEligibleSetReason, restoreWorkingSet,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import {
  RUN_02EA3AED_COMPANIES,
} from "../../fixtures/run02ea3aedCheckpoint.ts";
import type {
  CompanyResumeRecord,
} from "../../../supabase/functions/_shared/leadResumeState.ts";

const pool = (n: number) =>
  restoreWorkingSet(
    RUN_02EA3AED_COMPANIES.slice(0, n) as unknown as CompanyResumeRecord[]);

/** Give the first `k` companies a verdict, exactly as the free pass would. */
const assess = (cs: ReturnType<typeof pool>, k: number) => {
  for (let i = 0; i < k; i++) {
    // deno-lint-ignore no-explicit-any
    cs[i].hiring_assessment = { verdict: "hiring_not_verified",
      evidence_source: "free", supporting_signals: [] } as any;
  }
  return cs;
};

Deno.test("1. nobody was assessed — say so, and say how many that was", () => {
  const r = emptyEligibleSetReason(pool(50));
  assertStringIncludes(r, "none of the 50 companies carried a hiring assessment");
  assertStringIncludes(r, "nothing was evaluated, nothing was rejected");
});

Deno.test("2. REGRESSION: eleven WERE assessed — the sentence may not say fifty were not", () => {
  // Task 9da530ae's real state: 50 restored, 11 carrying `hiring_not_verified`.
  const r = emptyEligibleSetReason(assess(pool(50), 11));
  assertEquals(
    r.includes("50 companies carried no hiring assessment"), false,
    "the whole-pool count is what made a real finding look like an absence");
  assertStringIncludes(r, "11 companies were assessed");
  assertStringIncludes(r, "none showed a qualifying opening");
  assertStringIncludes(r, "39 companies were never assessed");
  // The whole sentence, so a future edit cannot quietly change what it claims.
  assertEquals(
    r,
    "no company reached the Company Brain: 11 companies were assessed and none " +
    "showed a qualifying opening, and 39 companies were never assessed — " +
    "nothing was evaluated, nothing was rejected",
  );
});

Deno.test("3. everyone assessed and none hiring — no phantom remainder", () => {
  const r = emptyEligibleSetReason(assess(pool(11), 11));
  assertStringIncludes(r, "11 companies were assessed");
  assertEquals(r.includes("never assessed"), false,
    "there is no unassessed remainder to report");
});

Deno.test("4. one company reads as one company", () => {
  assertStringIncludes(emptyEligibleSetReason(pool(1)),
    "none of the 1 company carried a hiring assessment");
  assertStringIncludes(emptyEligibleSetReason(assess(pool(1), 1)),
    "1 company was assessed");
});

Deno.test("5. an empty pool does not claim anything was looked at", () => {
  assertStringIncludes(emptyEligibleSetReason([]),
    "none of the 0 companies carried a hiring assessment");
});
