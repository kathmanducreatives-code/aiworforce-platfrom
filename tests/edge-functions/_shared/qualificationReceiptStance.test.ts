// E01 — A GENUINE QUOTE MUST ALSO SAY WHAT IT IS CITED FOR.
//
// Where an evaluator PASS can raise a result (an industry outside the
// vocabulary, a mandatory requirement no source establishes, an excluded type),
// the cited sentence must be a current self-description naming the
// requirement. Negations, audiences, past or planned states and unrelated
// sentences are refused — offline, deterministically, with no model call.
// Everywhere else verdicts only lower, so nothing changes there.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { receiptStance, requirementStems, sentenceOf } from "../../../supabase/functions/_shared/receiptStance.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import { parseMissionEvaluationStrict } from "../../../supabase/functions/_shared/missionEvaluation.ts";
import { buildEvidenceRegistry } from "../../../supabase/functions/_shared/leadEvidenceRegistry.ts";
import { buildCompanyEvidence } from "../../../supabase/functions/_shared/leadCompanyEvidence.ts";
import { normalizeLinkedInCompanyEnriched } from "../../../supabase/functions/_shared/hiringActorNormalizers.ts";
import type { MissionCriterion } from "../../../supabase/functions/_shared/missionCriteria.ts";

// ═════════════════════════════════════════════════════════ the reading ══

Deno.test("stance: each kind of sentence is read for what it says", () => {
  const T = ["recruiting agencies"];
  const cases: Array<[string, string, string]> = [
    ["We are a recruiting agency placing sales staff.", "We are a recruiting agency", "affirms"],
    ["Staffing and Recruiting", "Staffing and Recruiting", "affirms"],
    ["We recruit staff for business customers.", "We recruit staff", "affirms"],
    ["We are not a recruiting agency; we build payroll software.", "a recruiting agency", "negated"],
    ["We are no longer a recruiting agency.", "a recruiting agency", "not_current"],
    ["Our software helps recruiting agencies manage candidates.", "recruiting agencies", "other_subject"],
    ["Trusted by recruiting agencies worldwide.", "recruiting agencies", "other_subject"],
    ["Founded as a recruiting agency in 1998, we now build software.", "a recruiting agency", "not_current"],
    ["We build payroll software for finance teams.", "payroll software", "irrelevant"],
  ];
  for (const [source, excerpt, want] of cases) assertEquals(receiptStance(T, source, excerpt), want, source);
});

Deno.test("stance: 'not only' is not a negation; a later clause is not the governing one", () => {
  assertEquals(receiptStance(["startup"], "We are not only a startup but a profitable one.", "a startup"), "affirms");
  assertEquals(receiptStance(["startup"], "Co is a seed-stage startup with no debt.", "a seed-stage startup"), "affirms");
});

Deno.test("stance: exact counts are read as numbers, and the cited sentence is the unit", () => {
  assertEquals(requirementStems(["23"]), ["23"]);
  assertEquals(receiptStance(["23"], "Our team of 23 people builds software. We plan to grow to 40.", "team of 23"), "affirms");
  assertEquals(receiptStance(["23"], "We plan to reach 23 people next year.", "23 people"), "not_current");
  assertEquals(sentenceOf("First. We are a startup! Third.", "a startup"), "We are a startup");
});

// ════════════════════════════════════════ through the parser and decision ══

const NOW = new Date();
const crit = (id: string, dimension: string, value: unknown, over: Partial<MissionCriterion> = {}): MissionCriterion => ({
  id, dimension: dimension as MissionCriterion["dimension"], kind: "hard", value, label: String(value), source: "user_explicit",
  user_phrase: String(value), rationale: "x", status: "ok", ...over,
});
const AGENCY = crit("industry:recruiting_agencies", "industry", "recruiting agencies");
const STARTUP = crit("company_stage:startup", "company_stage", "startup", { label: "Company kind: startup", status: "unprovable_today" });
const EXCLUDE = crit("exclusion:agencies", "exclusion", { field: "excluded_company_types", value: ["recruiting agencies"] },
  { label: "Excluding: recruiting agencies" });
const B2B = crit("industry:b2b_software", "industry", "B2B software");

const registry = (description: string) => buildEvidenceRegistry({ now: NOW.getTime(),
  evidence: buildCompanyEvidence({ company_key: "co", source_capability: "company_enrichment", identity_state: "resolved",
    company: normalizeLinkedInCompanyEnriched({ id: "co", name: "Co", description, linkedinUrl: "https://www.linkedin.com/company/co",
      website: "https://co.example", employeeCountRange: { start: 11, end: 50 }, industries: [{ name: "Software Development" }],
      locations: [{ country: "United States", city: "Boston", isHeadquarter: true }] }) } as never) } as never);
const decide = (c: MissionCriterion, description: string, excerpt: string, result: "pass" | "fail" = "pass") => {
  const r = registry(description);
  const it = r.items.find((x) => x.evidence_type === "company_description")!;
  const v = parseMissionEvaluationStrict({ mission_fit: result, reasoning: "x", unknown_fields: [], failed_requirements: [],
    matched_requirements: [{ requirement: c.label, evidence_id: it.evidence_id, excerpt }],
    criterion_verdicts: [{ criterion_id: c.id, result, reason: "model", evidence: [{ evidence_id: it.evidence_id, excerpt }] }] }, r, [c])
    .evaluation.criterion_verdicts![0];
  return { verdict: v.result, eligibility: evaluateEligibility([c], buildCompanyEvidenceGraph("co", [], { now: NOW }), [v]).eligibility };
};

Deno.test("E01 interpretive industry: only a self-description that says it qualifies", () => {
  assertEquals(decide(AGENCY, "We are a recruiting agency placing sales staff.", "We are a recruiting agency"),
    { verdict: "pass", eligibility: "eligible" });
  for (const [desc, ex] of [
    ["We are not a recruiting agency; we build payroll software.", "a recruiting agency"],
    ["Our software helps recruiting agencies manage candidates.", "recruiting agencies"],
    ["Founded as a recruiting agency in 1998, we now build payroll software.", "a recruiting agency"],
    ["We build payroll software for finance teams.", "payroll software"],
  ]) assertEquals(decide(AGENCY, desc, ex), { verdict: "unknown", eligibility: "pending" }, desc);
});

Deno.test("E01 unsupported mandatory: 'startup' must describe the company now", () => {
  assertEquals(decide(STARTUP, "Co is a seed-stage startup building payroll software.", "a seed-stage startup").eligibility, "eligible");
  assertEquals(decide(STARTUP, "Co sells payroll software to startups and enterprises.", "startups").eligibility, "pending");
  assertEquals(decide(STARTUP, "Co was founded as a startup in 1998 and is now public.", "founded as a startup").eligibility, "pending");
});

Deno.test("E01 exclusion: a sentence affirming the excluded type never passes the exclusion", () => {
  assertEquals(decide(EXCLUDE, "We are a recruiting agency placing sales staff.", "We are a recruiting agency").eligibility, "pending");
  assertEquals(decide(EXCLUDE, "We are not a recruiting agency; we build payroll software.", "we build payroll software").eligibility, "eligible");
  assertEquals(decide(EXCLUDE, "We build payroll software for finance teams.", "We build payroll software").eligibility, "eligible",
    "a self-description of another business is still accepted, as before");
});

Deno.test("E01 controls: verdicts that can only lower are untouched", () => {
  // A FAIL may cite a negation: it lowers, which is always allowed.
  assertEquals(decide(AGENCY, "We are not a recruiting agency; we build payroll software.", "We are not a recruiting agency", "fail").eligibility, "ineligible");
  // A controlled-vocabulary industry never rises on a verdict; the guard does not apply.
  assert(decide(B2B, "Our software helps B2B software vendors.", "B2B software vendors").eligibility !== "eligible");
});
