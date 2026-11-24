// Q3 — A MANDATORY REQUIREMENT NO SOURCE CAN ESTABLISH IS ENFORCED (audit G08, G08b).
//
// "Exactly 23 employees", "must be a startup", a round stage with no funding
// verifier: the customer required it, and no structured source proves it. It
// used to be dropped from the decision, so a company qualified without it. Now:
//
//   evidence in the graph rules it out          → ineligible
//   the company's OWN cited words answer it     → that answer (receipts checked)
//   otherwise                                   → pending, BLOCKED: never bought,
//                                                 never counted
//
// A preference with the same status still never decides anything, and the
// customer is told at approval which requirement no current source establishes.
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import type { EvidenceItem } from "../../../supabase/functions/_shared/candidateObservation.ts";
import type { MissionCriterion } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { type CriterionVerdict, parseMissionEvaluationStrict } from "../../../supabase/functions/_shared/missionEvaluation.ts";
import { buildEvidenceRegistry } from "../../../supabase/functions/_shared/leadEvidenceRegistry.ts";
import { buildCompanyEvidence } from "../../../supabase/functions/_shared/leadCompanyEvidence.ts";
import { normalizeLinkedInCompanyEnriched } from "../../../supabase/functions/_shared/hiringActorNormalizers.ts";
import { parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { assessRequestFeasibility } from "../../../supabase/functions/_shared/requestFeasibility.ts";

const NOW = new Date();
const crit = (dimension: MissionCriterion["dimension"], value: unknown, over: Partial<MissionCriterion> = {}): MissionCriterion => ({
  id: `${dimension}:${JSON.stringify(value).replace(/\W+/g, "_")}`, dimension, kind: "hard", value, label: String(value),
  source: "user_explicit", user_phrase: String(value), rationale: "customer requirement", status: "ok", ...over,
});
const STARTUP = crit("company_stage", "startup", { label: "Company kind: startup", status: "unprovable_today" });
const EXACT_23 = crit("company_size", { min: 23, max: 23 }, { label: "Company size: exactly 23 employees", status: "unprovable_today" });
const GEO = crit("geography", "United States", { geography_scope: "presence" });
const RANGE = crit("company_size", { min: 20, max: 100 }, { label: "Company size: 20–100 employees", status: "unprovable_today" });

let seq = 0;
const item = (dimension: EvidenceItem["dimension"], value: unknown): EvidenceItem => ({
  evidence_id: `um_${++seq}`, company_key: "co", dimension, value, status: "proven",
  source: { provider: "fixture", actor: "fixture", provider_call_id: null, url: null, excerpt: null },
  method: "provider_field", observed_at: NOW.toISOString(), valid_until: null, confidence: "high",
  derived_from: [], mission_id: null, origin: "lead_mission",
});
const US = () => item("geography", "Boston, United States");
const verdict = (c: MissionCriterion, result: CriterionVerdict["result"], evidence = [{ evidence_id: "reg_desc", excerpt: "a startup" }]): CriterionVerdict =>
  ({ criterion_id: c.id, result, reason: `the company's own words: ${result}`, evidence });
/** The evaluator answers every criterion; a supported one it cannot cite stays at the graph's answer. */
const withGeo = (v: CriterionVerdict): CriterionVerdict[] => [verdict(GEO, "pass", [{ evidence_id: "reg_loc", excerpt: "Boston" }]), v];

// ════════════════════════════════════════════════════ the decision layer ══

Deno.test("G08: with everything else proven, an unestablished mandatory requirement keeps the company pending — blocked", () => {
  const e = evaluateEligibility([GEO, STARTUP], buildCompanyEvidenceGraph("co", [US()], { now: NOW }));
  assertEquals(e.eligibility, "pending");
  const check = e.checks.find((c) => c.criterion_id === STARTUP.id)!;
  assertEquals([check.result, check.blocked], ["unknown", "unsupported:company_stage"]);
  assert(/no current source can establish Company kind: startup/.test(check.reason), check.reason);
  assertEquals(e.gaps, [], "no purchase is routed for it");
});

Deno.test("G08: the company's own cited words answer it; no receipt, no answer", () => {
  const g = buildCompanyEvidenceGraph("co", [US()], { now: NOW });
  const pass = evaluateEligibility([GEO, STARTUP], g, withGeo(verdict(STARTUP, "pass")));
  assertEquals(pass.eligibility, "eligible");
  assertEquals(pass.checks.find((c) => c.criterion_id === STARTUP.id)!.evidence_ids, ["reg_desc"]);
  assertEquals(evaluateEligibility([GEO, STARTUP], g, withGeo(verdict(STARTUP, "fail"))).eligibility, "ineligible");
  assertEquals(evaluateEligibility([GEO, STARTUP], g, withGeo(verdict(STARTUP, "pass", []))).eligibility, "pending", "confidence alone");
  const unknown = evaluateEligibility([GEO, STARTUP], g, withGeo(verdict(STARTUP, "unknown")));
  assertEquals(unknown.eligibility, "pending");
  assertEquals(unknown.checks.find((c) => c.criterion_id === STARTUP.id)!.blocked, "unsupported:company_stage",
    "an unknown verdict keeps it blocked, with its own reason");
});

Deno.test("G08b: a stated size no band settles is enforced — a disjoint band rules it out, no band passes it", () => {
  const band = (min: number, max: number) => item("company_size_band", { min, max, source: "linkedin_declared" });
  const graph = (min: number, max: number) => buildCompanyEvidenceGraph("co", [US(), band(min, max)], { now: NOW });
  // "20–100" cuts across bands: 201–500 lies outside it, 51–200 only overlaps it.
  assertEquals(evaluateEligibility([GEO, RANGE], graph(201, 500)).eligibility, "ineligible", "201–500 rules out 20–100");
  const overlap = evaluateEligibility([GEO, RANGE], graph(51, 200));
  assertEquals([overlap.eligibility, overlap.checks.find((c) => c.criterion_id === RANGE.id)!.blocked],
    ["pending", "unsupported:company_size"]);
  // An exact count: a declared band is a range, never a headcount, so no band
  // settles it either way (`bandSatisfies`). It stays pending, and nothing is bought.
  for (const [min, max] of [[11, 50], [51, 200]]) {
    const e = evaluateEligibility([GEO, EXACT_23], graph(min, max));
    assertEquals([e.eligibility, e.gaps], ["pending", []], `${min}–${max}`);
  }
});

Deno.test("G08 control: the same status on a PREFERENCE never decides anything", () => {
  const pref = { ...STARTUP, kind: "target" as const };
  const e = evaluateEligibility([GEO, pref], buildCompanyEvidenceGraph("co", [US()], { now: NOW }));
  assertEquals(e.eligibility, "eligible");
  assertFalse(e.checks.some((c) => c.criterion_id === pref.id));
});

// ══════════════════════════════════════════════════════ the receipt layer ══

const ROW = {
  id: "co", name: "Routing Labs", description: "Routing Labs is a seed-stage startup building B2B software for logistics teams.",
  linkedinUrl: "https://www.linkedin.com/company/routing-labs", website: "https://routing.example",
  employeeCountRange: { start: 11, end: 50 }, industries: [{ name: "Software Development" }],
  locations: [{ country: "United States", city: "Boston", isHeadquarter: true }],
};
const registry = () => buildEvidenceRegistry({
  evidence: buildCompanyEvidence({ company_key: "co", company: normalizeLinkedInCompanyEnriched(ROW), source_capability: "company_enrichment", identity_state: "resolved" }),
  now: NOW.getTime(),
  jobs: [{ job_id: "j", job_url: "https://jobs.invalid/j", title: "Account Executive", company_name: "Routing Labs",
    company_linkedin_url: ROW.linkedinUrl, company_source_id: "co", location: "US", workplace_mode: null, posted_date: NOW.toISOString(),
    description: "Join a fast-growing startup as our Account Executive.", source: "job_provider",
    retrieved_at: NOW.toISOString(), missing_fields: [] }],
} as never);
const cite = (type: string, word = "startup") => {
  const r = registry();
  const it = r.items.find((x) => x.evidence_type === type && String(x.source_text).includes(word));
  assert(it, `fixture has a ${type} saying "${word}"`);
  const at = String(it!.source_text).indexOf(word);
  const excerpt = String(it!.source_text).slice(Math.max(0, at - 10), at + word.length);
  return parseMissionEvaluationStrict({
    mission_fit: "pass", reasoning: "x", unknown_fields: [], failed_requirements: [],
    matched_requirements: [{ requirement: STARTUP.label, evidence_id: it!.evidence_id, excerpt }],
    criterion_verdicts: [{ criterion_id: STARTUP.id, result: "pass", reason: "x", evidence: [{ evidence_id: it!.evidence_id, excerpt }] }],
  }, r, [STARTUP]).evaluation;
};

Deno.test("receipts: an unsupported requirement is answered from the company's own record — never from a job posting", () => {
  const own = cite("company_description");
  assertEquals(own.criterion_verdicts![0].result, "pass", "the company's own description");
  const posting = cite("job_posting", "Account Executive");
  assertEquals(posting.criterion_verdicts![0].result, "unknown", "a posting's pitch is not the company's record");
  assert(posting.decision !== "qualified", "the evaluator cannot qualify past an unestablished mandatory requirement");
});

// ═══════════════════════════════════════════════════════ at approval ══

const feasibility = (query: string) => {
  const m = parseLeadMissionDeterministic(query);
  return assessRequestFeasibility(m as never, buildCapabilityGraph(m));
};

Deno.test("feasibility: the customer is told which mandatory requirement no source establishes — disclosed, not refused", () => {
  const stated = feasibility("Find 3 B2B SaaS companies in the US that must be startups, hiring account executives.");
  const c = stated.constraints?.find((x) => x.requirement === "company_stage:startup");
  assert(c, JSON.stringify(stated.constraints));
  assertEquals(c!.status, "unsupported");
  assert(/requirement you stated, and no current source establishes it/.test(c!.message), c!.message);
  assert(stated.declared_gaps.includes("company_stage:startup (unsupported)"));
  assertFalse(stated.refusals.some((r) => r.requirement === "company_stage:startup"), "the company's own words may still answer it");

  const described = feasibility("Find 3 B2B SaaS startups in the US hiring account executives.");
  assertFalse((described.constraints ?? []).some((x) => x.requirement === "company_stage:startup"),
    "a plain 'startups' is a description, not a requirement");
});
