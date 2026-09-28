// A FINISHED MISSION NEVER SHOWS STALE RUNNING STATE.
//
// Production (Fuse two-slice run, 2026-09-27): the mission completed and the
// Workbench read "0 companies reviewed · still running". The last slice ended
// the run without rewriting the mid-run projections — `workbench_progress`
// still said in_progress from slice one, with nothing evaluated yet — while the
// durable `run_outcome` written at completion held the real account. The
// Workbench never read run_outcome.
//
// The shapes below follow the stored fields the Workbench reads. Pure.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildRunSummary, summaryCanonicalInput, summaryCaption, summaryHeadline } from "../../src/lib/workbench/runSummary.ts";
import { readWorkbenchProgress, runActivity } from "../../src/lib/workbench/workbenchProgress.ts";
import { applyRunAuthority, outcomeCounts, resolveRunAuthority } from "../../src/lib/workbench/runAuthority.ts";

const staleSliceOneProgress = {
  stage: "accounts_found", accounts_found: 14, evaluated: 0, eligible_opportunities: 0, exclusion_reasons: {},
  identity_resolved: 0, identity_unresolved: 0, companies_enriched: 0, hiring_verified: 0, qualified_companies: 0,
  decision_makers_verified: 0, open_jobs_evaluated: 0, shortlisted: 0, in_progress: true, awaiting_external_run: false,
};
const outcome = (canonical: Record<string, unknown> | null, q: Record<string, number> = {}) => ({
  version: "run-outcome-v1", state: "SATISFIED", requested: 1,
  qualification: { eligible: 0, evaluated: 0, qualified: 0, rejected: 0, not_reached: 0, not_reached_reason: null, ...q, canonical },
});
const canonical = (o: Record<string, number>) => ({
  source: "workbench_mission_view", discovered: 14, qualified: 0, pending: 0, ineligible: 0, screened_out: 0, undecided: 0, mission_dimensions: null, ...o,
});

function summaryFor(taskStatus: string, result: Record<string, unknown>) {
  const progress = applyRunAuthority(readWorkbenchProgress(result), resolveRunAuthority({ taskStatus, result }));
  const s = buildRunSummary({
    qualifiedLeads: 1, leadsInReview: 0, quota: null, portfolio: null, progress,
    rows: { total: 1, qualified: 0, pending: 0 },
    canonical: summaryCanonicalInput(progress, { canonical: false, inReview: 0 }),
  });
  return { s, progress, caption: summaryCaption(s) };
}

Deno.test("reproduced: the OLD path (projection only) says '0 companies reviewed · still running' for the finished Fuse shape", () => {
  const result = { workbench_progress: staleSliceOneProgress, run_outcome: outcome(canonical({ qualified: 1, ineligible: 2 })) };
  const progress = readWorkbenchProgress(result);
  const s = buildRunSummary({ qualifiedLeads: 1, leadsInReview: 0, quota: null, portfolio: null, progress,
    rows: { total: 1, qualified: 0, pending: 0 }, canonical: summaryCanonicalInput(progress, { canonical: false, inReview: 0 }) });
  assertEquals(summaryCaption(s), "0 companies reviewed · still running");
});

Deno.test("Fuse shape, complete task: not running, counts from run_outcome, no disagreement", () => {
  const { s, progress, caption } = summaryFor("complete", {
    workbench_progress: staleSliceOneProgress,
    run_outcome: outcome(canonical({ qualified: 1, ineligible: 2 })),
  });
  assertEquals(caption, "3 companies reviewed");
  assertEquals([s.inProgress, s.hasDisagreement, s.qualifiedCompanies.value, s.reviewed.value], [false, false, 1, 3]);
  assertEquals(runActivity(progress!), "finished");
  assertEquals(summaryHeadline(s), "1 qualified lead");
});

Deno.test("Salvo shape (one known company, qualified): 1 reviewed, 1 qualified company, canonical source", () => {
  const { s } = summaryFor("complete", { run_outcome: outcome(canonical({ discovered: 1, qualified: 1 })) });
  assertEquals([s.reviewed.value, s.qualifiedCompanies.value, s.reviewed.source], [1, 1, "canonical"]);
  assertEquals(s.inProgress, false);
});

Deno.test("a stale mission view is outranked by the terminal outcome", () => {
  const view = { counts: { discovered: 14, screened_out: 0, investigating: 5, identity_unresolved: 0, pending: 0, exact_match: 0,
    strong_opportunity: 0, worth_considering: 0, low_priority: 0, ineligible: 0 }, leads: [], stage: "retrieving" };
  const { s, caption } = summaryFor("complete", { workbench_mission_view: view, run_outcome: outcome(canonical({ qualified: 2, pending: 1, ineligible: 4 })) });
  assertEquals([s.reviewed.value, s.pending.value, s.qualifiedCompanies.value], [7, 1, 2]);
  assert(!caption.includes("still running"), caption);
});

Deno.test("a failed run is terminal too; a legacy outcome (no canonical view) still supplies counts", () => {
  const { s } = summaryFor("failed", { workbench_progress: staleSliceOneProgress, run_outcome: outcome(null, { evaluated: 5, qualified: 1, rejected: 3 }) });
  assertEquals([s.inProgress, s.reviewed.value, s.pending.value], [false, 5, 1]);
  assertEquals(outcomeCounts({ run_outcome: outcome(null, { evaluated: 5, qualified: 1, rejected: 3 }) })!.source, "run_outcome_legacy");
});

Deno.test("a terminal run with no recorded outcome is still not running — and invents no counts", () => {
  const { s, caption } = summaryFor("complete", { workbench_progress: staleSliceOneProgress });
  assertEquals(s.inProgress, false);
  assert(!caption.includes("still running"));
  assertEquals(summaryCanonicalInput(applyRunAuthority(readWorkbenchProgress({}), resolveRunAuthority({ taskStatus: "complete", result: {} })), { canonical: false, inReview: 0 }), null);
});

Deno.test("while the task row is running or checkpointed, the projection still speaks — unchanged behaviour", () => {
  for (const status of ["running", "ready", "pending"]) {
    const { s } = summaryFor(status, { workbench_progress: staleSliceOneProgress });
    assertEquals(s.inProgress, true, status);
  }
  assertEquals(resolveRunAuthority({ taskStatus: "ready", result: {} }).activity, "checkpointed");
});
