// RC14 — A COMPANY THAT PROVES EVERY HARD REQUIREMENT IS NOT CAPPED BY AN ANCHOR NOBODY ASKED FOR.
//
// A mission entered through company discovery carries the `company_profile`
// anchor, which no evidence dimension answers, so `anchor_proven` was always
// false. Hard criteria never count as opportunity signals, so a company proving
// every hard requirement (US, 11–50, Series A in window, a sales role in window)
// fell through every rung of the ladder to `low_priority`.
//
// The rule: when the candidate is eligible, every hard criterion the mission
// states is enforceable and PASSES, and the anchor is not something the mission
// itself asked for as a target or signal, the anchor rung is met. Everything else
// stays as it was — a failed or pending hard criterion still has no label, and an
// anchor the mission asked for still has to be proven.
//
// Built on the real golden QUALIFIED mission and the evidence graph the engine
// produced for it; variants alter that graph one way each.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { GOLDEN, li } from "../../replay/golden/scenarios.ts";
import { runGoldenMission } from "../../replay/lib/mission.ts";
import { deriveMissionCriteria, type MissionCriterion } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { computeCeiling } from "../../../supabase/functions/_shared/opportunityLabel.ts";
import { anchorForCapability } from "../../../supabase/functions/_shared/retrievalPlan.ts";
import { missionCandidatesFrom } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import type { CompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import type { EvidenceDimension } from "../../../supabase/functions/_shared/candidateObservation.ts";

const golden = GOLDEN.qualified();
// Hard: geography US, company_size 11–50, funding ≤730d, a sales role ≤30d. No targets.
const CRITERIA = deriveMissionCriteria(golden.mission, golden.readiness);
const COMPANY_PROFILE = anchorForCapability("general_company_discovery");

let cached: CompanyEvidenceGraph | null = null;
async function acmeGraph(): Promise<CompanyEvidenceGraph> {
  if (!cached) {
    const r = await runGoldenMission(GOLDEN.qualified());
    const c = missionCandidatesFrom({ companies: r.companies }, { missionId: `golden-${golden.name}` })
      .find((x) => x.company_key === li("acme"));
    assert(c, "the golden run produced Acme");
    cached = c.graph;
  }
  return structuredClone(cached);
}
const without = (g: CompanyEvidenceGraph, dim: EvidenceDimension): CompanyEvidenceGraph =>
  ({ ...g, claims: g.claims.filter((c) => c.dimension !== dim) });
const disproven = (g: CompanyEvidenceGraph, dim: EvidenceDimension): CompanyEvidenceGraph => ({
  ...g, claims: g.claims.map((c) => c.dimension === dim && c.current ? { ...c, current: { ...c.current, status: "disproven" } } : c),
});
const ceilingOf = (criteria: readonly MissionCriterion[], graph: CompanyEvidenceGraph, anchor: string | null) => {
  const eligibility = evaluateEligibility(criteria, graph);
  return { eligibility: eligibility.eligibility, ...computeCeiling({ criteria, graph, eligibility, anchor }) };
};

Deno.test("RC14: the mission is all-hard and company discovery anchors it on company_profile", () => {
  assertEquals(COMPANY_PROFILE, "company_profile");
  assertEquals(CRITERIA.map((c) => [c.kind, c.dimension, c.status]), [
    ["hard", "geography", "ok"], ["hard", "company_size", "ok"], ["hard", "funding", "ok"], ["hard", "hiring", "ok"],
  ]);
});

Deno.test("RC14 ALL-HARD-PASS: every hard requirement proven ⇒ above low_priority", async () => {
  const c = ceilingOf(CRITERIA, await acmeGraph(), COMPANY_PROFILE);
  assertEquals(c.eligibility, "eligible");
  assertFalse(c.anchor_proven, "company_profile is still never proven — it is just no longer the reason for the cap");
  assertEquals(c.ceiling, "strong_opportunity");
});

Deno.test("RC14 NO-ANCHOR-ALL-PROVEN: no anchor at all is not a reason to cap a fully proven company", async () => {
  assertEquals(ceilingOf(CRITERIA, await acmeGraph(), null).ceiling, "strong_opportunity");
});

Deno.test("RC14 HARD-FAIL: one disproven hard requirement ⇒ ineligible, no label", async () => {
  const c = ceilingOf(CRITERIA, disproven(await acmeGraph(), "geography"), COMPANY_PROFILE);
  assertEquals([c.eligibility, c.ceiling], ["ineligible", null]);
});

Deno.test("RC14 HARD-PENDING: one unanswered hard requirement ⇒ pending, no label", async () => {
  for (const dim of ["hiring", "funding", "company_size_band"] as const) {
    const c = ceilingOf(CRITERIA, without(await acmeGraph(), dim), COMPANY_PROFILE);
    assertEquals([c.eligibility, c.ceiling], ["pending", null], dim);
  }
});

Deno.test("RC14 ANCHOR-PROVEN-BUT-FAIL: a proven anchor cannot override a failed hard requirement", async () => {
  const g = disproven(await acmeGraph(), "company_size_band");
  const c = ceilingOf(CRITERIA, g, anchorForCapability("job_discovery"));
  assert(c.anchor_proven, "the hiring anchor is proven");
  assertEquals([c.eligibility, c.ceiling], ["ineligible", null]);
});

Deno.test("RC14 PREFERENCE-ONLY: a mission with no hard criteria keeps its ladder", async () => {
  // The same four requirements stated as preferences: nothing hard to prove, so
  // the RC14 rung never applies. funding and hiring are proven signal targets ⇒
  // worth_considering, exactly as before.
  const prefs = CRITERIA.map((c) => ({ ...c, kind: "target" as const }));
  const c = ceilingOf(prefs, await acmeGraph(), COMPANY_PROFILE);
  assertEquals([c.eligibility, c.ceiling, c.targets_unproven.length], ["eligible", "worth_considering", 0]);
});

Deno.test("RC14 guard: an anchor the mission asked for as a target still has to be proven", async () => {
  // hiring demoted to a target and made the anchor (job discovery): the other
  // three hard requirements pass, but the anchor the mission wanted is missing.
  const criteria = CRITERIA.map((c) => c.dimension === "hiring" ? { ...c, kind: "target" as const } : c);
  const c = ceilingOf(criteria, without(await acmeGraph(), "hiring"), anchorForCapability("job_discovery"));
  assertEquals([c.eligibility, c.anchor_proven, c.ceiling], ["eligible", false, "low_priority"]);
});

Deno.test("RC14 guard: a hard requirement no source can prove blocks the lift", async () => {
  // Disclosed, not enforced (P5.2): it cannot strand the candidate, but it was
  // not proven either, so the company has not proven EVERY hard requirement.
  const unprovable: MissionCriterion = { ...CRITERIA[0], id: "company_stage:startup", dimension: "company_stage",
    value: "startup", label: "Company kind: startup", status: "unprovable_today" };
  const c = ceilingOf([...CRITERIA, unprovable], await acmeGraph(), COMPANY_PROFILE);
  assertEquals([c.eligibility, c.ceiling], ["eligible", "low_priority"]);
});

Deno.test("RC14 guard: targets still decide between strong and exact, and two gaps stay worth_considering", async () => {
  const g = await acmeGraph();
  const target = (dimension: MissionCriterion["dimension"], id: string): MissionCriterion =>
    ({ ...CRITERIA[0], id, kind: "target", dimension, value: true, label: id, status: "ok" });
  // One target, proven ⇒ exact_match.
  const proven = ceilingOf([...CRITERIA, { ...CRITERIA[0], id: "t:geo", kind: "target" }], g, COMPANY_PROFILE);
  assertEquals([proven.targets_unproven.length, proven.ceiling], [0, "exact_match"]);
  // Two unanswered targets ⇒ the incomplete evidence keeps it at worth_considering.
  const gaps = ceilingOf([...CRITERIA, target("expansion", "t:exp"), target("product_launch", "t:pl")], g, COMPANY_PROFILE);
  assertEquals([gaps.targets_unproven.length, gaps.ceiling], [2, "worth_considering"]);
});
