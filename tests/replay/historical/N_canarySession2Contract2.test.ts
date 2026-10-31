// HISTORICAL N — CANARY SESSION 2 / CONTRACT 2 (TEST project, 2026-10-30,
// GitHub Actions run 41051862651): THREE AE-HIRING COMPANIES, ZERO QUALIFIED,
// AND THE FUNDING VERIFIER NEVER RAN.
//
// The fixture is the run's own end-of-slice checkpoint (LangChain, Baseten,
// Oscilar) and the mission from its public kickoff artifact. Replayed offline
// through the production eligibility, gap router, verifier targeting and
// canonical view. Nothing is bought: the replay answers what the slice
// would decide, not what Atomus or company details would return.
//
// Four defects held every candidate:
//   1. a restated hiring requirement compiled to a HARD `constraint` no evidence
//      dimension answers (status "ok", so D7 passed it);
//   2. a job row's LinkedIn location marked the company-details route
//      "already answered" for Baseten and Oscilar, never enriched;
//   3. the evaluator's evidence-free abstention lowered LangChain's
//      authority-proven headquarters (company record, one flagged HQ);
//   4. Oscilar's failed fifth model call (the spend gate's attempt limit,
//      reported as an HTTP error) was recorded as `model_evaluated`, and its
//      fabricated rows lowered every check.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadFixture } from "../lib/fixture.ts";
import { companiesAt } from "../lib/state.ts";
import { canonicalView, replayReadiness } from "../lib/verification.ts";
import { verifiableCandidatesFrom } from "../lib/prod.ts";
import type { LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";
import { deriveMissionCriteria, type MissionCriterion } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { canStillQualify, evidenceGapsFor } from "../../../supabase/functions/_shared/evidenceGapRouter.ts";
import { verificationDecisions, verificationTargets } from "../../../supabase/functions/_shared/claimVerifier.ts";
import { evaluatorAnswered } from "../../../supabase/functions/_shared/missionEvaluation.ts";

const fx = loadFixture("canarySession2.contract2");
const mission = fx.mission as unknown as LeadMissionV1;
const MISSION_ID = fx.provenance.task_id;
const LANGCHAIN = "https://www.linkedin.com/company/langchain";
const BASETEN = "https://www.linkedin.com/company/baseten";
const OSCILAR = "https://www.linkedin.com/company/oscilar-inc";
const ATOMUS = { route_actor: "apify_funding_atomus", max_targets: 3 };
const DETAILS = "apify_linkedin_company_details";

const today = () => deriveMissionCriteria(mission, replayReadiness());
const asItRan = () => (mission as unknown as { criteria: MissionCriterion[] }).criteria;
const candidates = (criteria: readonly MissionCriterion[]) =>
  verifiableCandidatesFrom({ companies: companiesAt(fx, "end_of_slice") }, criteria, MISSION_ID);
const byKey = (cs: ReturnType<typeof candidates>, k: string) => cs.find((c) => c.company_key === k)!;
const gapsOf = (c: ReturnType<typeof candidates>[number]) =>
  evidenceGapsFor(c.hard_checks, c.graph, undefined, new Set(c.attempted_routes), replayReadiness());

Deno.test("[historical] N anchors: under the criteria as they ran, all three are pending and none can reach the funding verifier", () => {
  const cs = candidates(asItRan());
  assertEquals(cs.map((c) => c.eligibility), ["pending", "pending", "pending"]);
  assertEquals(cs.filter((c) => canStillQualify(gapsOf(c))).length, 0, "the hard `constraint` gap has no route");
  assertEquals(verificationTargets(ATOMUS, cs, () => null, undefined, replayReadiness()).length, 0, "Atomus was never targeted");
});

Deno.test("[historical] N criteria today: geography (HQ), hiring and funding are the hard requirements — no `constraint`", () => {
  const hard = today().filter((c) => c.kind === "hard");
  assertEquals(hard.map((c) => c.dimension).sort(), ["funding", "geography", "hiring"]);
  assertEquals(hard.find((c) => c.dimension === "geography")!.geography_scope, "headquarters", "the user's US requirement is unchanged");
  assert(!today().some((c) => c.dimension === "constraint"), "both restatements (role, 180-day window) are recognised");
});

Deno.test("[historical] N LangChain: the company record's one flagged HQ (San Francisco, US) passes; funding is the only gap and routes to Atomus", () => {
  const lc = byKey(candidates(today()), LANGCHAIN);
  const geo = lc.hard_checks.find((h) => h.dimension === "geography")!;
  assertEquals(geo.result, "pass", "an evidence-free abstention no longer lowers an authority-proven headquarters");
  assertEquals(lc.hard_checks.find((h) => h.dimension === "hiring")!.result, "pass");
  assertEquals(lc.hard_checks.find((h) => h.dimension === "funding")!.result, "unknown", "funding is NOT assumed");
  const gaps = gapsOf(lc);
  assertEquals(gaps.map((g) => [g.dimension, g.next, g.route?.actor ?? null]), [["funding", "verify", "apify_funding_atomus"]]);
  assertEquals(lc.eligibility, "pending", "pending until a funding round is proven — never qualified on missing evidence");
});

Deno.test("[historical] N Baseten: a job row's US location is NOT headquarters; the company-details route is open, not 'already answered'", () => {
  const b = byKey(candidates(today()), BASETEN);
  const geo = b.hard_checks.find((h) => h.dimension === "geography")!;
  assertEquals(geo.result, "unknown", "the evaluator's 'pass' from a job-row location cannot upgrade a plausible field");
  assert(!b.attempted_routes.includes(DETAILS), "details were never fetched for Baseten");
  const g = gapsOf(b).find((x) => x.dimension === "geography")!;
  assertEquals([g.next, g.route?.actor], ["verify", DETAILS]);
  assert(canStillQualify(gapsOf(b)), "Baseten is viable: every open hard claim has an executable route");
});

Deno.test("[historical] N Oscilar: the failed fifth call is recognised as NO evaluation (never `model_evaluated`)", () => {
  const o = companiesAt(fx, "end_of_slice").find((c) => c.key === OSCILAR)!;
  assert(o.mission_evaluation, "the checkpoint carries the placeholder");
  assert(o.mission_evaluation!.criterion_verdicts!.every((v) => v.origin === "unparsed"));
  assertEquals(evaluatorAnswered(o.mission_evaluation), false);
  for (const k of [LANGCHAIN, BASETEN]) {
    assertEquals(evaluatorAnswered(companiesAt(fx, "end_of_slice").find((c) => c.key === k)!.mission_evaluation), true);
  }
});

Deno.test("[historical] N targeting: Atomus targets LangChain now; Baseten waits for its cheap company-details read first", () => {
  const t = verificationTargets(ATOMUS, candidates(today()), () => null, undefined, replayReadiness());
  assertEquals(t.map((x) => x.company_key), [LANGCHAIN]);
});

Deno.test("[historical] N continuation: verification routes remain, so the run is NOT frontier-exhausted", () => {
  const view = canonicalView({ companies: companiesAt(fx, "end_of_slice") }, mission, MISSION_ID, "job_discovery", true);
  assert(view.evidence_gaps.with_executable_route >= 2,
    `LangChain (funding) and Baseten (details) remain verifiable; got ${view.evidence_gaps.with_executable_route}`);
  assertEquals(view.leads.filter((l) => l.label !== null).length, 0, "nothing qualifies without a proven funding round");
});

Deno.test("[historical] N controls: a FAIL with receipts, or an unparsed row, still lowers LangChain's proven HQ", () => {
  const criteria = today();
  for (const [result, origin, expected] of [["fail", "answered", "fail"], ["unknown", "unparsed", "unknown"], ["unknown", "downgraded", "unknown"]] as const) {
    const companies = companiesAt(fx, "end_of_slice");
    const lc = companies.find((c) => c.key === LANGCHAIN)!;
    lc.mission_evaluation!.criterion_verdicts = lc.mission_evaluation!.criterion_verdicts!.map((v) =>
      v.criterion_id === "geography:united_states" ? { ...v, result, origin } : v);
    const geo = verifiableCandidatesFrom({ companies }, criteria, MISSION_ID)
      .find((c) => c.company_key === LANGCHAIN)!.hard_checks.find((h) => h.dimension === "geography")!;
    assertEquals(geo.result, expected, `${result}/${origin}`);
  }
});

Deno.test("[historical] N decision trace: the persisted reason per company — as it ran, and today", () => {
  const reasons = (criteria: readonly MissionCriterion[]) => Object.fromEntries(
    verificationDecisions(ATOMUS, candidates(criteria), () => null, undefined, replayReadiness()).decisions
      .map((d) => [d.company_key.split("/").at(-1), d.reason]));
  assertEquals(reasons(asItRan()), { langchain: "cannot_still_qualify", baseten: "cannot_still_qualify", "oscilar-inc": "cannot_still_qualify" });
  assertEquals(reasons(today()), { langchain: "targeted", baseten: "cheap_stage_first", "oscilar-inc": "cannot_still_qualify" },
    "Oscilar: its only evaluation failed, so every check stays unknown — see the report's open decision on re-evaluation");
  const ran = verificationDecisions(ATOMUS, candidates(asItRan()), () => null, undefined, replayReadiness()).decisions;
  assert(ran.every((d) => d.gaps.some((g) => g.dimension === "constraint" && g.next === "blocked" && g.route === null)),
    "the trace names the blocker: the hard `constraint` with no route");
});
