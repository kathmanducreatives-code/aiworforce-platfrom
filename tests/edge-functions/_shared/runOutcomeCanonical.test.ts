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
  renderCanonicalCompletion, renderOutstandingClause, renderQualificationClause, renderRunHeadline, renderRunOutcome,
  hiringInScope, RUN_OUTCOME_RESULT_KEY, type RunOutcomeV1,
} from "../../../supabase/functions/_shared/runOutcome.ts";
import { buildWorkbenchMissionView, decisionSummary } from "../../../supabase/functions/_shared/workbenchMissionView.ts";
import { deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";

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
    // Read from the view's own criteria — this stored view predates the stated
    // `dimension`, so the id prefix answers, as `deriveMissionCriteria` writes it.
    mission_dimensions: ["company_size", "company_stage", "funding", "geography", "industry"],
  });
  // Every legacy field now reads the same decisions.
  assertEquals([q.qualified, q.rejected, q.evaluated, q.eligible, q.not_reached, q.not_reached_reason],
    [0, 1, 2, 0, 0, null]);
});

Deno.test("the Workbench and run_outcome share ONE derivation — decisionSummary over the view's counts", () => {
  const view = RESULT.workbench_mission_view;
  const fromView = decisionSummary(view.counts);
  const q = outcome().qualification.canonical!;
  assertEquals({ ...q, source: undefined, mission_dimensions: undefined }, { ...fromView, source: undefined, mission_dimensions: undefined });
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

// ── HIRING IS SAID ONLY WHEN THE MISSION ASKED ABOUT HIRING ──────────────────

Deno.test("a funding mission's message never mentions hiring — not even 'confirmed hiring at 0'", () => {
  const o = outcome();
  assertEquals(hiringInScope(o), false);
  const text = renderRunOutcome(o);
  assertFalse(/hiring/i.test(text), text);
  assertStringIncludes(text, "I looked at 2 companies and shortlisted 2.");
});

Deno.test("a mission that names hiring keeps its hiring wording (stated dimension, not the id)", () => {
  const withHiring = structuredClone(RESULT);
  withHiring.workbench_mission_view.mission.criteria.push(
    { id: "x", dimension: "hiring", kind: "hard", label: "Hiring", source: "user_explicit", status: "ok", window: null });
  const o = buildRunOutcome({ ...readFactsFromResult(withHiring, 1), spend: SPEND });
  assertEquals(hiringInScope(o), true);
  assertStringIncludes(renderRunOutcome(o), "confirmed hiring at 0");
});

Deno.test("no criteria on the view (older or trimmed record) → unknown, legacy wording unchanged", () => {
  const bare = structuredClone(RESULT);
  delete bare.workbench_mission_view.mission;
  const o = buildRunOutcome({ ...readFactsFromResult(bare, 1), spend: SPEND });
  assertEquals([o.qualification.canonical?.mission_dimensions, hiringInScope(o)], [null, null]);
  assertStringIncludes(renderRunOutcome(o), "confirmed hiring at 0");
});

// ── CANONICAL WINS; OLD RECORDS STILL READ ────────────────────────────────────

Deno.test("canonical counts override CONTRADICTORY legacy counters, field by field", () => {
  const skewed = structuredClone(RESULT);
  skewed.evaluation_paths = { eligible: 7, reached_evaluation: 5 };
  skewed.capability_execution_state.progress = { ...skewed.capability_execution_state.progress, qualified_companies: 4 };
  const q = readFactsFromResult(skewed, 1).qualification;
  assertEquals([q.eligible, q.evaluated, q.qualified, q.rejected, q.not_reached], [0, 2, 0, 1, 0]);
});

Deno.test("null, not undefined: a legacy outcome has canonical null and round-trips as null", () => {
  const legacy = structuredClone(RESULT);
  delete legacy.workbench_mission_view;
  const facts = readFactsFromResult(legacy, 1);
  // A caller that omits the field entirely still gets a null on the record.
  const { canonical: _drop, ...noField } = facts.qualification;
  const built = buildRunOutcome({ ...facts, qualification: noField as typeof facts.qualification, spend: SPEND });
  assertEquals(built.qualification.canonical, null);
  const read = readPersistedRunOutcome({ [RUN_OUTCOME_RESULT_KEY]: JSON.parse(JSON.stringify(built)) })!;
  assertEquals(read.qualification.canonical, null);
  assertEquals(read.qualification, built.qualification);
});

Deno.test("a record persisted BEFORE this contract (no canonical key at all) reads as legacy", () => {
  const old = JSON.parse(JSON.stringify(RESULT.run_outcome_as_recorded));
  delete old.qualification.canonical;
  const read = readPersistedRunOutcome({ [RUN_OUTCOME_RESULT_KEY]: old })!;
  assertEquals(read.qualification.canonical, null);
  assertEquals([read.qualification.eligible, read.qualification.evaluated], [2, 0]);
});

Deno.test("a canonical block persisted before mission_dimensions existed reads it as null (unknown)", () => {
  const o = JSON.parse(JSON.stringify(outcome())) as RunOutcomeV1;
  delete (o.qualification.canonical as Partial<typeof o.qualification.canonical>)!.mission_dimensions;
  const read = readPersistedRunOutcome({ [RUN_OUTCOME_RESULT_KEY]: o })!;
  assertEquals(read.qualification.canonical?.mission_dimensions, null);
  assertEquals(read.qualification.canonical?.pending, 1);
});

// ── THE COMPLETION MESSAGE READS THE SAME DECISIONS ──────────────────────────

Deno.test("the completion message: pending is pending, no open roles, no commercial signals, no 'not qualified'", () => {
  const line = renderCanonicalCompletion(outcome())!;
  assertEquals(line.evidence,
    "I discovered 2 companies. 2 companies were checked against your requirements: 0 qualified, " +
    "1 pending (a requirement is not yet established), 1 ruled out.");
  assertEquals(line.tail, " The pending company is in Workbench with the requirement still to be established.");
  const all = line.evidence + line.tail;
  for (const stale of [/open roles?/i, /commercial/i, /not qualified/i, /hiring/i]) assertFalse(stale.test(all), all);
});

Deno.test("no canonical view → no canonical completion line (the caller keeps its legacy sentence)", () => {
  const legacy = structuredClone(RESULT);
  delete legacy.workbench_mission_view;
  assertEquals(renderCanonicalCompletion(buildRunOutcome({ ...readFactsFromResult(legacy, 1), spend: SPEND })), null);
});

Deno.test("run-agent's panel message uses the canonical completion when the outcome has it", () => {
  const src = Deno.readTextFileSync(new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));
  const at = src.indexOf("const canonicalLine = renderCanonicalCompletion(summaryOutcome)");
  assert(at > 0 && src.indexOf("canonicalLine\n      ? `I opened the results in Workbench", at) > at);
});

Deno.test("the canonical view STATES each criterion's dimension — and run_outcome reads it end to end", () => {
  const criteria = deriveMissionCriteria(parseLeadMissionDeterministic(
    "Find 1 US company with 11-50 employees that raised funding in the last 6 months"));
  const view = buildWorkbenchMissionView({
    mission: { requested_count: 1, execution_limit: 1, anchor: null }, criteria, candidates: [], stage: "complete",
  });
  for (const c of view.mission.criteria) assertEquals(c.dimension, c.id.slice(0, c.id.indexOf(":")), c.id);
  const facts = readFactsFromResult({ workbench_mission_view: JSON.parse(JSON.stringify(view)) }, 1);
  assert(facts.qualification.canonical!.mission_dimensions!.includes("funding"));
  assertFalse(facts.qualification.canonical!.mission_dimensions!.includes("hiring"));
});
