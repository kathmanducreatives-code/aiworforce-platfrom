// P5 EVIDENCE TRUTH — A BUSINESS-MODEL QUOTE MUST STATE WHAT THE CODE ASSERTS.
//
// Canary 9b1b70a2 (commit 383633cd), verbatim:
//
//   Feathery   b2b_saas  "Feathery is an agentic data intake platform for financial firms."
//              → accepted → hard PASS on "b2b saas" AND "saas"
//   Outsmart   consumer  "Rebuilding higher education for the AI era"
//              → accepted → verified hard FAIL
//
// The first quote establishes business customers and a platform; it says
// nothing about SaaS delivery. The second names no audience at all. The
// contradiction check let both stand because neither argued against the code:
// silence was read as support, and a model's inference became a hard verdict.
// The plan (§10) decomposes the claim — business customer, software product,
// SaaS delivery, service-primary — and every facet a code asserts must be
// STATED by the company's own quoted words, or the claim stays PENDING.
//
// PURE.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { statedFacets, unstatedFacets } from "../../../supabase/functions/_shared/businessModelMatch.ts";
import { businessModelDecision } from "../../../supabase/functions/_shared/groundedClaims.ts";
import { companyEvidenceItems } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import type { EvidenceItem } from "../../../supabase/functions/_shared/candidateObservation.ts";

const FEATHERY = "Feathery is an agentic data intake platform for financial firms.";
const OUTSMART = "Rebuilding higher education for the AI era";
const NOW = new Date("2026-09-19T12:00:00.000Z");
const DESC = "company_description:linkedin:c1";

const CRITERIA = deriveMissionCriteria(compileLeadMission({
  originalUserQuery: "Find 1 seed-stage B2B SaaS startup in the US hiring its first growth marketer.",
  proposal: {
    requested_opportunity_count: 1, requested_contact_ready_count: null, company_types: ["B2B SaaS"],
    geographies: ["United States"], geography_is_hard: true, employee_range: { min: null, max: null },
    decision_maker_roles: [], hard_constraints: [], soft_preferences: [], preferred_signals: [], required_signal_terms: [],
    adjacent_signals: [], excluded_signals: [],
    allowed_broadening: { role_families: [], company_types: [], geographies: [], employee_range: { min: null, max: null } },
    disallowed_broadening: [], required_evidence: [], required_capabilities: [], preferred_source_strategy: [],
    evaluation_instructions: "", founder_unlock_recommended: false, confidence: 0.85, unknowns: [],
  } as never,
}).final_mission);

/** The grounder's validated answer: one business-model claim quoting the company. */
function verification(value: string, excerpts: string[], extra: Array<{ type: string; excerpt: string }> = []) {
  const claim = (claim_type: string, excerpt: string) => ({
    claim: "self-description", claim_type, evidence_ids: [DESC], evidence_excerpts: [{ evidence_id: DESC, excerpt }],
  });
  return {
    version: "grounded-claims-v1",
    classifier_result: { business_model: { value, confidence: 0.9, claims: [] } },
    validated_claims: [...excerpts.map((e) => claim("business_model", e)), ...extra.map((x) => claim(x.type, x.excerpt))],
    rejected_claims: [], grounding_score: 1, final_grounded_decision: "review", downgrade_reasons: [], unacknowledged_conflicts: [],
  } as never;
}

/** The hard industry checks the Workbench shows, from the grounded answer through the engine's own item builder. */
function industry(value: string, excerpts: string[], extra: Array<{ type: string; excerpt: string }> = []) {
  const company = {
    key: "c1", company: { company_name: "x", linkedin_company_url: null, canonical_domain: null, website: null, geography: null, external_source_id: "x" },
    observations: [], evidence_registry: { items: [{ evidence_id: DESC, source_url: "https://www.linkedin.com/company/x/about" }] },
    hiring_jobs: [], hiring_assessment: null, first_in_function: null, enriched: null, identity: null, found_by: [],
    grounded: verification(value, excerpts, extra),
  } as never;
  const us: EvidenceItem = {
    evidence_id: "geo", company_key: "c1", dimension: "geography", value: "San Francisco, CA, United States", status: "proven",
    source: { provider: "apify", actor: "linkedin", provider_call_id: "pc", url: null, excerpt: null },
    method: "provider_field", observed_at: NOW.toISOString(), valid_until: null, confidence: "high", derived_from: [],
    mission_id: "t", origin: "lead_mission",
  };
  const items = [us, ...companyEvidenceItems(company)];
  const e = evaluateEligibility(CRITERIA, buildCompanyEvidenceGraph("c1", items, { now: NOW }));
  const checks = e.checks.filter((c) => c.dimension === "industry" && c.kind === "hard");
  return { results: checks.map((c) => c.result), reasons: checks.map((c) => c.reason), item: items.find((i) => i.dimension === "business_model")! };
}

Deno.test("Feathery, verbatim: a quote that establishes B2B but not SaaS cannot prove SaaS", () => {
  assertEquals(unstatedFacets("b2b_saas", [FEATHERY]), ["saas_delivery"]);
  assert(statedFacets([FEATHERY]).has("business_customer"), "\"for financial firms\" does state business customers");
  const d = businessModelDecision(verification("b2b_saas", [FEATHERY]));
  assertEquals([d.decision, d.reasons], ["review", ["quote_does_not_state_saas_delivery"]]);
  const r = industry("b2b_saas", [FEATHERY]);
  assertEquals(r.results, ["unknown", "unknown"], "b2b saas AND saas both PENDING — not the canary's two PASSes");
  assertEquals(r.item.status, "plausible");
  assert(r.reasons.every((x) => x.includes("the quote does not state saas delivery")), r.reasons.join(" | "));
});

Deno.test("Outsmart, verbatim: a quote that does not establish consumers cannot prove consumer — PENDING, not FAIL", () => {
  assertEquals(unstatedFacets("consumer", [OUTSMART]), ["consumer_customer"]);
  const d = businessModelDecision(verification("consumer", [OUTSMART]));
  assertEquals(d.decision, "review");
  assertEquals(industry("consumer", [OUTSMART]).results, ["unknown", "unknown"], "the canary's verified FAIL was an inference");
});

Deno.test("a quote that states every facet proves — and a stated contradiction still fails", () => {
  const b2bSaas = industry("b2b_saas", ["Acme is a cloud-based SaaS platform for mid-market finance teams."]);
  assertEquals(b2bSaas.results, ["pass", "pass"]);
  assertEquals(b2bSaas.item.source.url, "https://www.linkedin.com/company/x/about", "the check cites the page the quote came from");
  assertEquals(industry("b2b_saas", ["Plans from $49 per seat. Built for sales teams."]).results, ["pass", "pass"],
    "seat pricing is SaaS delivery");
  assertEquals(industry("consumer", ["The meal kit subscription for busy families."]).results[0], "fail",
    "a stated consumer audience is a verified contradiction of B2B");
});

Deno.test("the facets may be stated by a separate customer-type / product-type claim — each quoted and verified", () => {
  const split = industry("b2b_saas", [FEATHERY], [{ type: "product_type", excerpt: "delivered as a SaaS subscription" }]);
  assertEquals(split.results, ["pass", "pass"]);
});

Deno.test("review stays pending; missing stays pending; nothing is inferred", () => {
  // Software is not SaaS; AI is not an audience; a platform is not software.
  assertEquals(unstatedFacets("b2b_saas", ["an ERP for manufacturers"]), ["saas_delivery"]);
  assertEquals(unstatedFacets("ai_saas", ["DualEntry is the first ERP built AI-native from the ground up."]), ["saas_delivery"]);
  assertEquals(unstatedFacets("b2b_software", ["a platform for banks"]), ["software_product"]);
  // A subscription box is not SaaS: subscription language counts only beside software.
  assertEquals(unstatedFacets("b2b_saas", ["a snack subscription for offices and companies"]), ["saas_delivery"]);
  // A negated quote states nothing.
  assertEquals(unstatedFacets("b2b_saas", ["We are not a consumer app — B2B SaaS only"]), ["business_customer", "saas_delivery"]);
  // Review and missing never become a verdict.
  const review = industry("b2b_saas", ["a collaborative platform"]);
  assertEquals(review.results, ["unknown", "unknown"]);
});
