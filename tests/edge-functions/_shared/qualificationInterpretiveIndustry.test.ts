// Q3 — AN INDUSTRY THE CONTROLLED VOCABULARY CANNOT READ.
//
// "Recruiting agencies", "manufacturers", "logistics brokers": no structured
// source maps to them, so the evidence graph can never answer such a mandatory
// criterion, and before this every such ICP stayed pending forever (Codex
// routing audit H05). The evaluator's per-criterion verdict may answer it —
// ONLY with receipts from the company's own record or words, checked by the
// strict parser. Controlled values ("B2B SaaS") keep the old rule: a verdict
// can only lower them. No receipt, no answer.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import type { MissionCriterion } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { type CriterionVerdict, parseMissionEvaluationStrict } from "../../../supabase/functions/_shared/missionEvaluation.ts";
import { buildEvidenceRegistry } from "../../../supabase/functions/_shared/leadEvidenceRegistry.ts";
import { buildCompanyEvidence } from "../../../supabase/functions/_shared/leadCompanyEvidence.ts";
import { normalizeLinkedInCompanyEnriched } from "../../../supabase/functions/_shared/hiringActorNormalizers.ts";

const NOW = new Date();
const criterion = (value: string, dimension: MissionCriterion["dimension"] = "industry"): MissionCriterion => ({
  id: `${dimension}:${value.replace(/\W+/g, "_")}`, dimension, kind: "hard", value, label: value, source: "user_explicit",
  user_phrase: value, rationale: "customer requirement", status: "ok",
});
const AGENCY = criterion("recruiting agencies");
const SAAS = criterion("b2b saas");
const EMPTY = buildCompanyEvidenceGraph("co", [], { now: NOW });
const verdict = (c: MissionCriterion, result: CriterionVerdict["result"], evidence = [{ evidence_id: "reg_desc", excerpt: "We recruit staff" }]): CriterionVerdict =>
  ({ criterion_id: c.id, result, reason: `the company's own words: ${result}`, evidence });

// ════════════════════════════════════════════════════ the decision layer ══

Deno.test("interpretive industry: a receipt-backed PASS establishes it; FAIL rules it out", () => {
  const pass = evaluateEligibility([AGENCY], EMPTY, [verdict(AGENCY, "pass")]);
  assertEquals(pass.eligibility, "eligible");
  assertEquals(pass.checks[0].evidence_ids, ["reg_desc"]);
  assert(/outside the controlled vocabulary/.test(pass.checks[0].reason), pass.checks[0].reason);
  assertEquals(evaluateEligibility([AGENCY], EMPTY, [verdict(AGENCY, "fail")]).eligibility, "ineligible");
});

Deno.test("interpretive industry: no receipt, no answer — and no evaluator, no answer", () => {
  assertEquals(evaluateEligibility([AGENCY], EMPTY, [verdict(AGENCY, "pass", [])]).eligibility, "pending", "confidence alone");
  assertEquals(evaluateEligibility([AGENCY], EMPTY, [verdict(AGENCY, "unknown")]).eligibility, "pending");
  assertEquals(evaluateEligibility([AGENCY], EMPTY).eligibility, "pending", "graph-only runs cannot read it either");
});

Deno.test("controlled vocabulary is unchanged: a verdict never upgrades 'B2B SaaS' without graph proof", () => {
  assertEquals(evaluateEligibility([SAAS], EMPTY, [verdict(SAAS, "pass")]).eligibility, "pending");
  const proven = buildCompanyEvidenceGraph("co", [{
    evidence_id: "bm", company_key: "co", dimension: "business_model", value: "b2b saas", status: "proven",
    source: { provider: "fixture", actor: "fixture", provider_call_id: null, url: null, excerpt: null },
    method: "provider_field", observed_at: NOW.toISOString(), valid_until: null, confidence: "high",
    derived_from: [], mission_id: null, origin: "lead_mission",
  }], { now: NOW });
  assertEquals(evaluateEligibility([SAAS], proven, [verdict(SAAS, "pass")]).eligibility, "eligible");
  assertEquals(evaluateEligibility([SAAS], proven, [verdict(SAAS, "fail")]).eligibility, "ineligible", "a verdict may still lower it");
});

// ══════════════════════════════════════════════════════ the receipt layer ══

const ROW = {
  id: "co", name: "Routing Recruiting", description: "We recruit staff for business customers across North America.",
  linkedinUrl: "https://www.linkedin.com/company/routing-recruiting", website: "https://routing.example",
  employeeCountRange: { start: 11, end: 50 }, industries: [{ name: "Staffing and Recruiting" }],
  locations: [{ country: "United States", city: "Boston", isHeadquarter: true }],
};
const registry = () => buildEvidenceRegistry({
  evidence: buildCompanyEvidence({ company_key: "co", company: normalizeLinkedInCompanyEnriched(ROW), source_capability: "company_enrichment", identity_state: "resolved" }),
  now: NOW.getTime(),
  jobs: [{ job_id: "j", job_url: "https://jobs.invalid/j", title: "Account Executive", company_name: "Routing Recruiting",
    company_linkedin_url: ROW.linkedinUrl, company_source_id: "co", location: "US", workplace_mode: null, posted_date: NOW.toISOString(),
    description: "We recruit staff and are hiring our own internal Account Executive.", source: "job_provider",
    retrieved_at: NOW.toISOString(), missing_fields: [] }],
} as never);
const cite = (type: string) => {
  const r = registry();
  const it = r.items.find((x) => x.evidence_type === type)!;
  assert(it, `fixture has a ${type}`);
  const excerpt = String(it.source_text).slice(0, 20);
  return parseMissionEvaluationStrict({
    mission_fit: "pass", reasoning: "x", unknown_fields: [], failed_requirements: [],
    matched_requirements: [{ requirement: AGENCY.label, evidence_id: it.evidence_id, excerpt }],
    criterion_verdicts: [{ criterion_id: AGENCY.id, result: "pass", reason: "x", evidence: [{ evidence_id: it.evidence_id, excerpt }] }],
  }, r, [AGENCY]).evaluation.criterion_verdicts![0];
};

Deno.test("receipts: what a company IS comes from its own record — never from a job posting", () => {
  assertEquals(cite("company_industry").result, "pass", "the company record's industry label");
  assertEquals(cite("job_posting").result, "unknown", "a posting describes a role, not the company's business");
});
