// A LINKEDIN LABEL IS NOT A BUSINESS MODEL.
//
// `evaluateCompanyFit` hard-rejected any company whose enriched industry names
// did not literally contain an ICP phrase. LinkedIn has no "B2B SaaS" — it has
// "Software Development", "Technology, Information and Internet", "IT Services
// and IT Consulting" — so every company in the audited run would have failed on
// wording alone.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyMissionPrecedence, buildSemanticFitPrompt, decideCompanyBrain,
  failedHardGates, isWeakIndustryLabel, parseSemanticFit,
  type HardGateInput, type SemanticFitAssessment,
} from "../../../supabase/functions/_shared/companyBrainSemanticFit.ts";
import { evaluateCompanyFit } from "../../../supabase/functions/_shared/companyFirstStages.ts";

const POLICY = applyMissionPrecedence({
  original_user_query: "Find founders of SaaS startups hiring Sales Operations in the United States.",
  mission_verticals: ["saas"], mission_geography: "United States",
  workspace_industries: ["B2B SaaS", "AI SaaS", "Recruiting Agencies"],
});

const gates = (o: Partial<HardGateInput> = {}): HardGateInput => ({
  identity_status: "verified_match", active: true,
  geography: "United States", required_geography: "United States",
  employee_count: 40, employee_ceiling: 200, commercial_tier: "A", semantic: null, ...o,
});
const semantic = (o: Partial<SemanticFitAssessment> = {}): SemanticFitAssessment => ({
  business_model: "b2b_saas", company_fit: "pass", confidence: 0.85,
  agentory_use_case: "strong", supporting_evidence: ["sells an API to engineering teams"],
  conflicting_evidence: [], unknown_fields: [], reason: "B2B software sold to businesses", ...o,
});

// ═══════════ 1/2/9. the literal industry gate is gone ══

Deno.test("1. 'Software Development' + strong B2B evidence CAN pass", () => {
  const d = decideCompanyBrain({
    gates: gates(), semantic: semantic({ business_model: "b2b_software" }),
    policy: POLICY, hiring_verified: true,
  });
  assertEquals(d.outcome, "QUALIFIED");
  assertEquals(d.failed_hard_gates.length, 0);
});

Deno.test("2. 'Software Development' ALONE does not pass", () => {
  assert(isWeakIndustryLabel("Software Development"));
  assert(isWeakIndustryLabel("Technology, Information and Internet"));
  assert(isWeakIndustryLabel("IT Services and IT Consulting"));
  assertFalse(isWeakIndustryLabel("Hospitality"));

  // A label with nothing behind it is UNKNOWN, and unknown is REVIEW.
  const d = decideCompanyBrain({
    gates: gates(),
    semantic: semantic({ business_model: "unknown", company_fit: "review",
      unknown_fields: ["customer_type"], agentory_use_case: "plausible", confidence: 0.3 }),
    policy: POLICY, hiring_verified: true,
  });
  assertEquals(d.outcome, "REVIEW", "a bare label may not qualify a company either");
});

Deno.test("9/10. neither exact 'B2B SaaS' nor exact 'Sales Operations' is required", () => {
  // The deterministic stage no longer HARD-FAILS on industry wording.
  const fit = evaluateCompanyFit({
    company_key: "k", company_name: "SnapMagic", identity_status: "verified_match",
    enrichment_complete: true, employee_count: 23, employee_range_advisory: null,
    employee_min: 10, employee_max: 150,
    industry_ids: [{ id: "4", name: "Software Development" }],
    positive_industries: ["b2b saas"], excluded_industries: [],
    geography: "United States", required_geography: "United States",
    description: "AI-assisted electronics design sold to engineering organisations",
    provider_industry: "Software Development", canonical_domain: "snapmagic.com",
    postings: [{ job_id: "1", title: "Head of Sales", description: null }],
  });
  assertFalse(fit.failed_gates.includes("industry_not_in_icp"),
    "wording alone must never be a hard rejection");
  assertEquals(fit.stage, "company_fit_pending", "it becomes a question for the semantic pass");
  assert(fit.missing_evidence.includes("industry_label_not_in_icp_wording"));
});

// ═══════════ 3/4/8. consumer fails, unknown reviews ══

Deno.test("3. clear consumer-only evidence FAILS", () => {
  const d = decideCompanyBrain({
    gates: gates(), semantic: semantic({ business_model: "consumer", company_fit: "fail" }),
    policy: POLICY, hiring_verified: true,
  });
  assertEquals(d.outcome, "REJECT");
  assert(d.failed_hard_gates.includes("consumer_only"));
});

Deno.test("4/8. unknown business model and unknown non-critical fields become REVIEW", () => {
  assertEquals(decideCompanyBrain({
    gates: gates(), semantic: semantic({ business_model: "unknown" }),
    policy: POLICY, hiring_verified: true }).outcome, "REVIEW");

  assertEquals(decideCompanyBrain({
    gates: gates(), semantic: semantic({ unknown_fields: ["headquarters"] }),
    policy: POLICY, hiring_verified: true }).outcome, "REVIEW");

  // No classifier at all is REVIEW, never REJECT.
  const none = decideCompanyBrain({
    gates: gates(), semantic: null, policy: POLICY, hiring_verified: true });
  assertEquals(none.outcome, "REVIEW");
  assert(none.unknown_fields.includes("semantic_assessment_absent"));

  // A lone Tier B (hiring not verified) is REVIEW, not a pass.
  assertEquals(decideCompanyBrain({
    gates: gates({ commercial_tier: "B" }), semantic: semantic(),
    policy: POLICY, hiring_verified: false }).outcome, "REVIEW");
});

// ═══════════ 5/6. mission precedence ══

Deno.test("5/6. a SaaS mission ignores Recruiting Agencies", () => {
  assert(POLICY.workspace_categories_ignored.includes("Recruiting Agencies"),
    "an unrelated workspace category must not broaden this mission");
  assert(POLICY.workspace_context_applied.includes("B2B SaaS"));
  assert(POLICY.workspace_context_applied.includes("AI SaaS"));
  assertEquals(POLICY.precedence[0], "user_query");
  assertEquals(POLICY.precedence[1], "lead_mission");

  // The prompt states the exclusion explicitly.
  const prompt = buildSemanticFitPrompt({
    original_user_query: "Find founders of SaaS startups hiring Sales Operations in the United States.",
    mission_verticals: ["saas"], mission_geography: "United States",
    workspace_industries: [], company_name: "SnapMagic",
    yc_description: "AI-assisted electronics design", website_description: null,
    linkedin_description: null, linkedin_industry: "Software Development",
    linkedin_industry_ids: ["4"], employee_count: 23, employee_advisory: null,
    geography: "United States", commercial_signal: "Head of Sales", commercial_tier: "A",
  }, POLICY);
  assert(prompt.includes("IGNORE these unrelated workspace categories: Recruiting Agencies"));
  assert(prompt.includes("WEAK METADATA"));
  assert(prompt.includes("do not accept"), "the label must not auto-pass either");

  // A recruiting mission KEEPS the recruiting category.
  const recruiting = applyMissionPrecedence({
    original_user_query: "Find recruiting agencies hiring sales staff",
    mission_verticals: ["recruiting agencies"], mission_geography: null,
    workspace_industries: ["B2B SaaS", "Recruiting Agencies"],
  });
  assert(recruiting.workspace_context_applied.includes("Recruiting Agencies"));
});

// ═══════════ 7. exactly one outcome, always ══

Deno.test("7. every eligible company gets QUALIFIED, REVIEW or REJECT", () => {
  const cases: Array<[Partial<HardGateInput>, SemanticFitAssessment | null, boolean]> = [
    [{}, semantic(), true],
    [{}, semantic({ company_fit: "review" }), true],
    [{}, semantic({ company_fit: "fail" }), true],
    [{}, null, true],
    [{ identity_status: "rejected_mismatch" }, semantic(), true],
    [{ active: false }, semantic(), true],
    [{ employee_count: 900 }, semantic(), true],
    [{ commercial_tier: null }, semantic(), true],
    [{ geography: "Germany" }, semantic(), true],
    [{}, semantic({ agentory_use_case: "none" }), false],
  ];
  for (const [g, s, hv] of cases) {
    const d = decideCompanyBrain({ gates: gates(g), semantic: s, policy: POLICY, hiring_verified: hv });
    assert(["QUALIFIED", "REVIEW", "REJECT"].includes(d.outcome),
      `unexpected outcome ${d.outcome}`);
    assert(d.reason.length > 0, "every outcome must carry a reason");
  }
});

Deno.test("hard gates reject only on FACTS", () => {
  assert(failedHardGates(gates({ identity_status: "rejected_mismatch" })).includes("identity_mismatch"));
  assert(failedHardGates(gates({ active: false })).includes("inactive_company"));
  assert(failedHardGates(gates({ geography: "Germany" })).includes("unsupported_geography"));
  assert(failedHardGates(gates({ employee_count: 900 })).includes("employee_count_far_above_ceiling"));
  assert(failedHardGates(gates({ commercial_tier: null })).includes("no_commercial_signal"));

  // …and NOT on uncertainty.
  assertEquals(failedHardGates(gates({ geography: null })).length, 0,
    "unknown geography is a review question, not a rejection");
  assertEquals(failedHardGates(gates({ employee_count: null })).length, 0,
    "unknown headcount is not a rejection");
  assertEquals(failedHardGates(gates({ employee_count: 210 })).length, 0,
    "a count near the ceiling is REVIEW, not REJECT");
  assertEquals(failedHardGates(gates({ identity_status: "unresolved" })).length, 0,
    "unresolved is not the same as proven wrong");
});

Deno.test("a malformed classifier response degrades to UNKNOWN, never to a pass", () => {
  assertEquals(parseSemanticFit(null), null);
  assertEquals(parseSemanticFit("not json"), null);
  const junk = parseSemanticFit('{"business_model":"wat","company_fit":"definitely","confidence":9}')!;
  assertEquals(junk.business_model, "unknown");
  assertEquals(junk.company_fit, "review");
  assertEquals(junk.confidence, 1);
  // Wrapped in prose, as models often answer.
  const wrapped = parseSemanticFit('Sure!\n{"business_model":"b2b_saas","company_fit":"pass"}')!;
  assertEquals(wrapped.business_model, "b2b_saas");
});

Deno.test("19/20. the module is pure and mcp is untouched", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/companyBrainSemanticFit.ts", import.meta.url));
  for (const forbidden of ["fetch(", "apifyFetch", "createClient", "Deno.env"]) {
    assertFalse(src.includes(forbidden), `${forbidden} must not appear`);
  }
});
