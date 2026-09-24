// ONE SET OF CANDIDATES, ONE INTERPRETATION.
//
// Canary 89adf8fb (local, 2026-09-24) ended with the Workbench saying
//
//     BigRio        pending     (funding not established)
//     Talentify.io  ineligible  (funding disproven: last round 2017)
//     → 0 qualified, 1 pending, 1 ineligible
//
// while the same row's `run_outcome` — built from the legacy evaluation
// counters — said "eligible 2, evaluated 0, not reached 2: the run stopped
// first", and its funnel said both companies "still need a hiring check" on a
// mission that asked for no hiring at all.
//
// `run_outcome` now derives its candidate counts from the canonical view the
// Workbench renders (`workbench_mission_view.counts` → `decisionSummary`), so
// the two cannot disagree. The fixture is that task's real result, trimmed.
//
// Pure. No network, provider, model or database access.

import { assert, assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildRunOutcome, canonicalDecisionFacts, readFactsFromResult, readPersistedRunOutcome,
  renderOutstandingClause, renderQualificationClause, renderRunHeadline, renderRunOutcome,
  RUN_OUTCOME_RESULT_KEY,
} from "../../../supabase/functions/_shared/runOutcome.ts";
import { decisionSummary } from "../../../supabase/functions/_shared/workbenchMissionView.ts";

const RESULT = JSON.parse(Deno.readTextFileSync(new URL(
  "../../fixtures/lead-v2/canary-89adf8fb/result.json", import.meta.url)));
const SPEND = { credits_charged: 3, provider_calls: 3, usd_reported: 0.0242, unsettled_operations: 0, reused_operations: 0 };
const outcome = () => buildRunOutcome({ ...readFactsFromResult(RESULT, 1), spend: SPEND });

Deno.test("THE DEFECT, as recorded: the legacy summary disagreed with the Workbench", () => {
  const was = RESULT.run_outcome_as_recorded.qualification;
  assertEquals([was.eligible, was.evaluated, was.not_reached, was.not_reached_reason], [2, 0, 2, "the run stopped first"]);
  assertEquals(RESULT.run_outcome_as_recorded.funnel.hiring_evidence_unavailable, 2, "a hiring clause on a funding mission");
  const counts = RESULT.workbench_mission_view.counts;
  assertEquals([counts.pending, counts.ineligible], [1, 1]);
});

Deno.test("the canary's buckets: BigRio pending, Talentify.io ineligible", () => {
  const byName = Object.fromEntries(RESULT.workbench_mission_view.leads
    .map((l: { company: { name: string }; bucket: string }) => [l.company.name, l.bucket]));
  assertEquals(byName, { "BigRio": "pending", "Talentify.io": "ineligible" });
});

Deno.test("run_outcome derives its counts from the canonical decisions: 0 qualified, 1 pending, 1 ineligible", () => {
  const q = outcome().qualification;
  assertEquals(q.canonical, {
    source: "workbench_mission_view", discovered: 2, qualified: 0, pending: 1, ineligible: 1, screened_out: 0, undecided: 0,
  });
  // Every legacy field now reads the same decisions.
  assertEquals([q.qualified, q.rejected, q.evaluated, q.eligible, q.not_reached, q.not_reached_reason],
    [0, 1, 2, 0, 0, null]);
});

Deno.test("the Workbench and run_outcome share ONE derivation — decisionSummary over the view's counts", () => {
  const view = RESULT.workbench_mission_view;
  const fromView = decisionSummary(view.counts);
  const q = outcome().qualification.canonical!;
  assertEquals({ ...q, source: undefined }, { ...fromView, source: undefined });
  // …and those counts are the view's own leads, bucket by bucket.
  const buckets = (b: string) => view.leads.filter((l: { bucket: string }) => l.bucket === b).length;
  assertEquals([q.pending, q.ineligible, q.qualified], [buckets("pending"), buckets("ineligible"),
    buckets("exact_match") + buckets("strong_opportunity") + buckets("worth_considering") + buckets("low_priority")]);
});

Deno.test("the message says what the Workbench shows — and no hiring clause on a funding mission", () => {
  const o = outcome();
  assertEquals(renderQualificationClause(o),
    "2 companies were checked against your requirements: 0 qualified, 1 pending (a requirement is not yet established), 1 ruled out.");
  assertEquals(renderOutstandingClause(o), "", "the legacy hiring counter adds no second account");
  const text = renderRunOutcome(o);
  assertFalse(/stopped before/.test(text), text);
  assertFalse(/hiring check/.test(text), text);
  assertStringIncludes(renderRunHeadline(o), "1 pending evidence");
});

Deno.test("the persisted record round-trips the canonical decisions", () => {
  const o = outcome();
  const read = readPersistedRunOutcome({ [RUN_OUTCOME_RESULT_KEY]: JSON.parse(JSON.stringify(o)) })!;
  assertEquals(read.qualification, o.qualification);
});

Deno.test("a run with no canonical view keeps the legacy counters, and says so", () => {
  const legacy = { ...RESULT };
  delete legacy.workbench_mission_view;
  assertEquals(canonicalDecisionFacts(legacy), null);
  const q = readFactsFromResult(legacy, 1).qualification;
  assertEquals([q.canonical, q.eligible, q.evaluated, q.not_reached], [null, 2, 0, 2]);
});

Deno.test("run-agent builds run_outcome from a result that already carries the canonical view", () => {
  const src = Deno.readTextFileSync(new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));
  const view = src.indexOf("workbench_mission_view: p5View");
  const built = src.indexOf("...readFactsFromResult(committedResult, cf.quota.requested_leads)");
  assert(view > 0 && built > view, "the view is on committedResult before run_outcome reads it");
});
