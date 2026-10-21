// Q4 — AN EXCLUSION IS NEVER A REQUIREMENT; A PREFERENCE NEVER REJECTS.
//
// The acceptance matrix (q4AcceptanceMatrix.test.ts) found two compiler
// defects, both older than the Q1–Q3 stack:
//
//   Q4-EXCLUSION-INVERTED  "…, excluding recruiting agencies" compiled a HARD
//                          `industry: recruiting agencies` and dropped the
//                          stated "B2B software".
//   Q4-PREFERENCE-HARD     "…, ideally in the US" compiled a HARD geography.
//
// A cue governs its own clause. The words an exclusion cue governs compile as
// an exclusion — a hard rule that can only rule a company OUT — and the words
// a hedge governs as a target, which ranks and never rejects. The controls pin
// what must not move: an unhedged location and "only US companies" stay hard,
// and an agency ICP that asks FOR recruiting agencies still requires them.
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { type MissionCriterion, deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { type LeadMissionV1, parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import type { EvidenceItem } from "../../../supabase/functions/_shared/candidateObservation.ts";
import type { CriterionVerdict } from "../../../supabase/functions/_shared/missionEvaluation.ts";

type Constraint = { operator?: string; value?: unknown } | undefined;
/** A hard constraint the mission carries, by field. */
const hc = (m: LeadMissionV1, field: string) => m.hard_constraints[field] as Constraint;

function compile(request: string, proposal: Record<string, unknown> = {}): { mission: LeadMissionV1; criteria: MissionCriterion[] } {
  const mission = compileLeadMission({ originalUserQuery: request, proposal: {
    requested_opportunity_count: 1, company_types: ["B2B software"], geographies: [],
    employee_range: { min: null, max: null }, output_intent: "qualified_companies",
    preferred_signals: ["hiring Account Executives"], required_signal_terms: ["hiring Account Executives"],
    required_capabilities: ["general_company_discovery", "embedded_hiring_evidence", "company_semantic_evaluation"],
    strategies: ["hiring"], confidence: 0.95, ...proposal,
  } as never }).final_mission;
  return { mission, criteria: deriveMissionCriteria(mission) };
}
const byDim = (cs: MissionCriterion[], d: string) => cs.filter((c) => c.dimension === d);
const requiresRecruiting = (cs: MissionCriterion[]) =>
  cs.some((c) => c.kind === "hard" && c.dimension !== "exclusion" && /recruit/i.test(JSON.stringify(c.value)));

// ═══════════════════════════════════════════ Q4-EXCLUSION-INVERTED ══

const EXCLUDING = "Find 1 B2B software company hiring Account Executives within the last 30 days, excluding recruiting agencies.";

Deno.test("exclusion: 'excluding recruiting agencies' compiles an exclusion and keeps the stated industry", () => {
  const { mission, criteria } = compile(EXCLUDING);
  assertFalse(requiresRecruiting(criteria), "an exclusion is never a requirement");
  assertEquals(mission.company_profile.verticals, ["B2B software"]);
  assertEquals(byDim(criteria, "industry").map((c) => [c.kind, c.value]), [["hard", "B2B software"]]);
  const [ex] = byDim(criteria, "exclusion");
  assertEquals([ex.kind, ex.source, ex.elevated_by], ["hard", "user_explicit", "excluding"]);
  assertEquals(ex.value, { field: "excluded_company_types", value: ["recruiting agencies"] });
  assertEquals(hc(mission, "excluded_company_types")?.operator, "not_in");
});

Deno.test("exclusion: every exclusion cue governs its phrase", () => {
  for (const cue of ["excluding", "except", "except for", "other than", "but not", "not", "no", "without"]) {
    const { mission, criteria } = compile(`Find 1 B2B software company hiring Account Executives, ${cue} recruiting agencies.`);
    assertFalse(requiresRecruiting(criteria), `${cue}: never a requirement`);
    assertEquals(mission.company_profile.verticals, ["B2B software"], cue);
    assertEquals(byDim(criteria, "exclusion").length, 1, `${cue}: compiled as an exclusion`);
  }
});

Deno.test("exclusion: a proposal that lists the excluded type as a company type is corrected", () => {
  const { mission, criteria } = compile(EXCLUDING, { company_types: ["B2B software", "Recruiting agencies"] });
  assertFalse(requiresRecruiting(criteria));
  assertEquals(mission.company_profile.verticals, ["B2B software"]);
  assertEquals(byDim(criteria, "exclusion").length, 1);
});

Deno.test("exclusion: the deterministic reading excludes too — it never reads the phrase as a vertical", () => {
  const m = parseLeadMissionDeterministic(EXCLUDING);
  assertEquals(m.company_profile.verticals, []);
  assertEquals(hc(m, "excluded_company_types")?.value, ["recruiting agencies"]);
});

Deno.test("exclusion control: an agency ICP that asks FOR recruiting agencies still requires them", () => {
  const { criteria } = compile("Find 1 recruiting agency hiring its own Account Executives within the last 30 days.",
    { company_types: ["recruiting agency"] });
  assertEquals(byDim(criteria, "exclusion"), []);
  assert(byDim(criteria, "industry").some((c) => c.kind === "hard" && /recruit/i.test(String(c.value))));
  const m = parseLeadMissionDeterministic("Find 1 recruiting agency hiring Account Executives in the last 30 days.");
  assertEquals(m.company_profile.verticals, ["recruiting agencies"]);
  assertEquals(m.hard_constraints, {});
});

Deno.test("exclusion control: a type stated as wanted AND excluded elsewhere stays wanted", () => {
  const { criteria } = compile("Find 1 SaaS company hiring Account Executives, not fintech.", { company_types: ["SaaS"] });
  assertEquals(byDim(criteria, "industry").map((c) => c.value), ["saas"]);
  assertEquals((byDim(criteria, "exclusion")[0].value as Constraint)?.value, ["fintech"]);
});

// ── the decision: an exclusion rules a company out, and is never passed by silence ──

const NOW = new Date();
let seq = 0;
const item = (dimension: EvidenceItem["dimension"], value: unknown): EvidenceItem => ({
  evidence_id: `q4x_${++seq}`, company_key: "co", dimension, value, status: "proven",
  source: { provider: "fixture", actor: "fixture", provider_call_id: null, url: null, excerpt: null },
  method: "provider_field", observed_at: NOW.toISOString(), valid_until: null, confidence: "high",
  derived_from: [], mission_id: null, origin: "lead_mission",
});
const EXCLUDE = (values: string[]): MissionCriterion => ({
  id: `exclusion:${values.join("_")}`, dimension: "exclusion", kind: "hard",
  value: { field: "excluded_company_types", value: values }, label: `Excluding: ${values.join(", ")}`,
  source: "user_explicit", user_phrase: values[0], rationale: "stated in the request", status: "ok", elevated_by: "excluding",
});
const verdict = (c: MissionCriterion, result: CriterionVerdict["result"], evidence = [{ evidence_id: "reg_desc", excerpt: "We recruit staff" }]): CriterionVerdict =>
  ({ criterion_id: c.id, result, reason: `the company's own words: ${result}`, evidence });

Deno.test("exclusion decision: a type the vocabulary reads is answered by the evidence, inverted", () => {
  const saas = EXCLUDE(["saas"]);
  const graph = (model: string) => buildCompanyEvidenceGraph("co", [item("business_model", model)], { now: NOW });
  assertEquals(evaluateEligibility([saas], graph("b2b_saas")).eligibility, "ineligible", "a SaaS company is excluded");
  assertEquals(evaluateEligibility([saas], graph("b2b_service")).eligibility, "eligible", "a service company is shown not to be SaaS");
  assertEquals(evaluateEligibility([saas], buildCompanyEvidenceGraph("co", [], { now: NOW })).eligibility, "pending",
    "never passed by silence");
});

Deno.test("exclusion decision: a type outside the vocabulary is answered only by the company's own cited words", () => {
  const agencies = EXCLUDE(["recruiting agencies"]);
  const g = buildCompanyEvidenceGraph("co", [], { now: NOW });
  assertEquals(evaluateEligibility([agencies], g).eligibility, "pending");
  assertEquals(evaluateEligibility([agencies], g, [verdict(agencies, "fail")]).eligibility, "ineligible", "it IS an agency");
  assertEquals(evaluateEligibility([agencies], g, [verdict(agencies, "pass", [{ evidence_id: "reg_desc", excerpt: "We build sales software" }])]).eligibility,
    "eligible");
  assertEquals(evaluateEligibility([agencies], g, [verdict(agencies, "pass", [])]).eligibility, "pending", "no receipt, no answer");
});

// ═══════════════════════════════════════════════ Q4-PREFERENCE-HARD ══

const US_HEDGED = { geographies: ["United States"], geography_is_hard: false };

Deno.test("preference: 'ideally in the US' compiles a target and no hard geography", () => {
  const { mission, criteria } = compile("Find 1 B2B software company hiring Account Executives within the last 30 days, ideally in the US.", US_HEDGED);
  assertEquals(byDim(criteria, "geography").map((c) => [c.kind, c.value]), [["target", "United States"]]);
  assertEquals(hc(mission, "company_profile.locations"), undefined);
  assertFalse(mission.geography_is_hard === true);
});

Deno.test("preference: every hedge governs its location, before or after it", () => {
  for (const tail of ["preferably in the US", "ideally US-based", "bonus if they are in the US", "US preferred", "in the US if possible", "US-based is a plus"]) {
    const { mission, criteria } = compile(`Find 1 B2B software company hiring Account Executives, ${tail}.`, US_HEDGED);
    assertEquals(byDim(criteria, "geography").map((c) => c.kind), ["target"], tail);
    assertEquals(hc(mission, "company_profile.locations"), undefined, tail);
  }
});

Deno.test("preference: the model's geography_is_hard cannot harden a hedged location", () => {
  const { criteria } = compile("Find 1 B2B software company hiring Account Executives, ideally in the US.",
    { geographies: ["United States"], geography_is_hard: true });
  assertEquals(byDim(criteria, "geography").map((c) => c.kind), ["target"]);
});

Deno.test("preference control: an unhedged 'in the US' stays hard, whatever geography_is_hard says", () => {
  const { mission, criteria } = compile("Find 1 B2B software company in the US hiring Account Executives within the last 30 days.", US_HEDGED);
  assertEquals(byDim(criteria, "geography").map((c) => [c.kind, c.value]), [["hard", "United States"]]);
  assertEquals(hc(mission, "company_profile.locations")?.value, ["United States"]);
});

Deno.test("preference control: 'only US companies' stays hard", () => {
  const { criteria } = compile("Find 1 B2B software company hiring Account Executives, only US companies.", { geographies: ["United States"], geography_is_hard: true });
  assertEquals(byDim(criteria, "geography").map((c) => c.kind), ["hard"]);
});

Deno.test("preference control: a stated location stays hard beside a hedged one", () => {
  const { mission, criteria } = compile("Find 1 B2B software company in Canada hiring Account Executives, ideally in the US.",
    { geographies: ["Canada", "United States"], geography_is_hard: false });
  assertEquals(byDim(criteria, "geography").map((c) => [c.kind, c.value]).sort(), [["hard", "Canada"], ["target", "United States"]]);
  assertEquals(hc(mission, "company_profile.locations")?.value, ["Canada"]);
});

// ═════════════════════════════════ A CUE GOVERNS ONLY THE TYPE IT INTRODUCES ══
//
// The first cut let each exclusion cue govern everything up to the next
// punctuation mark, so a requested industry later in the clause became an
// exclusion. A cue now governs only the company-type phrase it directly
// introduces, and "no more than", "not yet", "not necessarily", "without a
// <thing>" and "doesn't use" never exclude a company type.

const excludedOf = (m: LeadMissionV1) => (hc(m, "excluded_company_types")?.value ?? []) as string[];

Deno.test("scope: 'no more than 50 employees in fintech' requires fintech and excludes nothing", () => {
  const request = "Find 1 company with no more than 50 employees in fintech hiring Account Executives.";
  const { mission, criteria } = compile(request, { company_types: ["fintech"] });
  assertEquals(byDim(criteria, "industry").map((c) => [c.kind, c.value]), [["hard", "fintech"]]);
  assertEquals(byDim(criteria, "exclusion"), []);
  assertEquals(excludedOf(mission), []);
  assertEquals(parseLeadMissionDeterministic(request).company_profile.verticals, ["fintech"]);
});

Deno.test("scope: 'without a sales team in fintech' requires fintech and excludes nothing", () => {
  const request = "Find 1 B2B software company without a sales team in fintech.";
  const { criteria } = compile(request, { company_types: ["B2B software", "fintech"] });
  assert(byDim(criteria, "industry").some((c) => c.kind === "hard" && c.value === "fintech"));
  assertEquals(byDim(criteria, "exclusion"), []);
  const m = parseLeadMissionDeterministic(request);
  assertEquals([m.company_profile.verticals, m.hard_constraints], [["fintech"], {}]);
});

Deno.test("scope: 'not a recruiting agency but a B2B software company' excludes only the agency", () => {
  const { mission, criteria } = compile("Find 1 company hiring Account Executives that is not a recruiting agency but a B2B software company.");
  assertEquals(mission.company_profile.verticals, ["B2B software"]);
  assertEquals(byDim(criteria, "industry").map((c) => [c.kind, c.value]), [["hard", "B2B software"]]);
  assertEquals(excludedOf(mission), ["recruiting agencies"]);
  assertFalse(requiresRecruiting(criteria));
});

Deno.test("scope: a connective ends the excluded phrase — what follows it stays required", () => {
  for (const tail of ["and fintech", "with a fintech focus", "in fintech", "that sells to fintech", "who serve fintech", "which is fintech"]) {
    const request = `Find 1 company hiring Account Executives, not a recruiting agency ${tail}.`;
    const { mission, criteria } = compile(request, { company_types: ["fintech"] });
    assertEquals(excludedOf(mission), ["recruiting agencies"], tail);
    assertFalse(excludedOf(mission).includes("fintech"), tail);
    assertFalse(requiresRecruiting(criteria), tail);
  }
});

Deno.test("scope: quantifiers, adverbs and verbs after a negation never exclude a company type", () => {
  for (const request of [
    "Find 1 fintech company with no more than 50 employees hiring Account Executives.",
    "Find 1 fintech company with no fewer than 10 employees hiring Account Executives.",
    "Find 1 fintech company not yet profitable hiring Account Executives.",
    "Find 1 company, not necessarily fintech, hiring Account Executives.",
    "Find 1 fintech company that doesn't use Salesforce hiring Account Executives.",
    "Find 1 fintech company that does not use Salesforce, hiring Account Executives.",
    "Find 1 fintech startup without a fintech partner hiring Account Executives.",
    "Find 1 fintech company without a SaaS product hiring Account Executives.",
  ]) {
    const { mission, criteria } = compile(request, { company_types: ["fintech"] });
    assertEquals(byDim(criteria, "exclusion"), [], request);
    assertEquals(excludedOf(mission), [], request);
    assertEquals(parseLeadMissionDeterministic(request).hard_constraints, {}, request);
  }
});

Deno.test("scope: every direct form still excludes the type it introduces", () => {
  for (const [phrase, type] of [
    ["excluding recruiting agencies", "recruiting agencies"],
    ["except fintech companies", "fintech"],
    ["other than fintech", "fintech"],
    ["not a recruiting agency", "recruiting agencies"],
    ["not an ecommerce company", "ecommerce"],
    ["no fintech", "fintech"],
    ["no recruiting agencies", "recruiting agencies"],
    ["without recruiting agencies", "recruiting agencies"],
    ["but not healthtech startups", "healthtech"],
  ]) {
    const { mission, criteria } = compile(`Find 1 B2B software company hiring Account Executives, ${phrase}.`);
    assertEquals(excludedOf(mission), [type], phrase);
    assertEquals(mission.company_profile.verticals, ["B2B software"], phrase);
    assertEquals(byDim(criteria, "exclusion").length, 1, phrase);
  }
});

Deno.test("scope: 'no agencies or consultancies' excludes both", () => {
  const request = "Find 1 B2B software company hiring Account Executives, no agencies or consultancies.";
  const { mission, criteria } = compile(request);
  assertEquals(excludedOf(mission), ["agencies", "consultancies"]);
  assertEquals(mission.company_profile.verticals, ["B2B software"]);
  assertEquals(byDim(criteria, "exclusion").length, 1);
  assertEquals(hc(parseLeadMissionDeterministic(request), "excluded_company_types")?.value, ["agencies", "consultancies"]);
});

Deno.test("scope control: an exclusion-only type is never a requirement when stated plainly", () => {
  const m = parseLeadMissionDeterministic("Find 1 marketing agency hiring Account Executives.");
  assertEquals([m.company_profile.verticals, m.hard_constraints], [[], {}]);
});

// ── a location named only to exclude it ──

Deno.test("geography: 'not based in the US' compiles no US requirement and records the gap", () => {
  for (const tail of ["not based in the US", "not located in the US", "not yet in the US", "outside the US", "excluding the US", "no US companies"]) {
    const request = `Find 1 B2B software company hiring Account Executives, ${tail}.`;
    const { mission, criteria } = compile(request, { geographies: ["United States"], geography_is_hard: true });
    assertEquals(byDim(criteria, "geography"), [], tail);
    assertEquals(hc(mission, "company_profile.locations"), undefined, tail);
    assertFalse(mission.geography_is_hard === true, tail);
    assert(byDim(criteria, "unrepresentable_evidence").some((c) => /excluded location \(United States\)/.test(String(c.value))), tail);
    assertEquals(parseLeadMissionDeterministic(request).company_profile.locations, [], tail);
  }
});

Deno.test("geography: 'not necessarily in the US' is a preference, never a hard geography", () => {
  const { mission, criteria } = compile("Find 1 B2B software company hiring Account Executives, not necessarily in the US.", US_HEDGED);
  assertEquals(byDim(criteria, "geography").map((c) => [c.kind, c.value]), [["target", "United States"]]);
  assertEquals(hc(mission, "company_profile.locations"), undefined);
});

Deno.test("geography control: a stated location beside an excluded one stays hard", () => {
  const { mission, criteria } = compile("Find 1 B2B software company in Canada hiring Account Executives, not based in the US.",
    { geographies: ["Canada", "United States"], geography_is_hard: true });
  assertEquals(byDim(criteria, "geography").map((c) => [c.kind, c.value]), [["hard", "Canada"]]);
  assertEquals(hc(mission, "company_profile.locations")?.value, ["Canada"]);
});

Deno.test("geography control: a negation that governs no place leaves the stated location hard", () => {
  for (const request of [
    "Find 1 company in the US that is not a recruiting agency, hiring Account Executives.",
    "Find 1 company with no more than 50 employees in the US hiring Account Executives.",
  ]) {
    const { criteria } = compile(request, { geographies: ["United States"] });
    assertEquals(byDim(criteria, "geography").map((c) => [c.kind, c.value]), [["hard", "United States"]], request);
  }
});
