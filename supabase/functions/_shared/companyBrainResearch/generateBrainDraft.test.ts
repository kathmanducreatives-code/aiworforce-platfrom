// AI draft → Company Brain v2 mapping. The LLM is a local stub; no provider runs.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildDraftPrompt, mapDraftToV2, generateBrainDraft, type DraftInput } from "./generateBrainDraft.ts";
import type { CompanyWebsiteResearch, FounderResearch } from "./types.ts";

const companyResearch: CompanyWebsiteResearch = {
  company_name: "Cekura", website: "https://cekura.ai",
  description: "AI SaaS for revenue teams", product_category: "", business_model: "B2B SaaS",
  target_users_guess: [], features: ["pipeline building"], use_cases: [], pricing_signal: "$99/mo",
  customers_or_segments: ["Acme"], integrations: ["integrates with HubSpot"],
  positioning_claims: ["Pipeline before payroll"], proof_points: ["3x faster research"],
  careers_signal: [], source_pages: ["https://cekura.ai", "https://cekura.ai/pricing"],
  confidence: "high", missing_evidence: [],
};

const founderResearch: FounderResearch = {
  name: "Jane Doe", headline: "Co-Founder & CEO", location: "SF",
  current_role: "CEO", current_company: "Cekura", experience: [], education: [], skills: [],
  summary: "", credibility_signals: ["Co-Founder & CEO"], gtm_relevance: ["GTM experience: Head of RevOps at Acme"],
  source_url: "https://linkedin.com/in/jane-doe", confidence: "medium", missing_evidence: ["work experience"],
};

// What a well-behaved model returns.
const aiJson = {
  company: { category: "AI SaaS", business_model: "B2B SaaS" },
  founder: { name: "Jane Doe", role: "CEO" },
  target_customer: {
    industries: ["B2B SaaS", "AI SaaS"], business_models: ["B2B SaaS"],
    company_size: { min: 10, max: 150, label: "10-150" },
    funding_stage: ["seed"], geography: ["US"], must_have: ["outbound motion"], nice_to_have: [],
    disqualifiers: { industries: ["pharma", "lab testing"], company_types: ["agency"], domains: [], keywords: ["staffing"], titles: [] },
  },
  buyer_personas: ["Founder", "Head of Revenue"],
  triggers: ["recently funded"], jobs_to_watch: ["Founding Account Executive"],
  competitors: ["Clay", "Apollo"], tools: ["HubSpot"],
  pain_points: ["manual outbound"], positive_examples: ["Acme"], negative_examples: ["Pace Analytical"],
  content_angles: ["pipeline before payroll"],
  qualification_rules: { required_evidence: ["job_url"], reject_if: ["lab testing"], manual_review_if: ["no website"] },
  brand_voice: { tone: "direct", tags: ["no-hype"], style_rules: [], avoid: ["hype"], example_message: "" },
  positioning: { promise: "Pipeline before payroll", differentiators: ["multi-agent"], use_cases: [], proof_points: ["3x faster research"], offer: "", pricing: "", avoid_positioning: ["AI SDR"] },
  needs_confirmation: ["target_customer.industries"],
  missing_fields: [],
};

const fullInput = (): DraftInput => ({
  founder_input: { name: "Jane Doe", role: "CEO" },
  founder_research: founderResearch,
  company_input: { name: "Cekura", website_url: "https://cekura.ai" },
  company_research: companyResearch,
  company_linkedin: null,
});

Deno.test("1. prompt forbids inventing proof and never leaks consent/contacts", () => {
  const { system, user } = buildDraftPrompt(fullInput());
  assert(/NEVER invent proof/i.test(system));
  assert(/broad, generic targeting/i.test(system));
  assert(!/enrichment_consent/.test(user), "consent flag must not reach the model");
});

Deno.test("2. AI JSON maps into a Company Brain v2 draft", () => {
  const d = mapDraftToV2(aiJson, fullInput());
  assertEquals(d.schema_version, 2);
  assertEquals(d.setup_status, "in_progress");
  assertEquals(d.is_draft, true);
  assertEquals(d.company.name, "Cekura");
  assertEquals(d.company.business_model, "B2B SaaS");
  assertEquals(d.buyer_personas, ["Founder", "Head of Revenue"]);
  assertEquals(d.jobs_to_watch, ["Founding Account Executive"]);
});

Deno.test("3. disqualifiers land in their buckets; good/bad-fit examples saved", () => {
  const d = mapDraftToV2(aiJson, fullInput());
  const disq = d.target_customer.disqualifiers as Record<string, string[]>;
  assert(disq.industries.includes("pharma"));
  assert(disq.industries.includes("lab testing"));
  assert(disq.company_types.includes("agency"));
  assert(disq.keywords.includes("staffing"));
  assertEquals(d.positive_examples, ["Acme"]);
  assertEquals(d.negative_examples, ["Pace Analytical"]);
});

Deno.test("4. evidence is rebuilt from REAL sources, not from the model", () => {
  const d = mapDraftToV2({ ...aiJson, evidence: { source_pages: ["https://fake.invented/page"] } }, fullInput());
  assertEquals(d.evidence.source_pages, ["https://cekura.ai", "https://cekura.ai/pricing"]);
  assert(!d.evidence.source_pages.includes("https://fake.invented/page"), "model cannot inject evidence");
  assert(d.evidence.linkedin_sources.includes("https://linkedin.com/in/jane-doe"));
  assert(d.evidence.confidence_notes.some((n) => /Website research confidence: high/.test(n)));
});

Deno.test("5. no evidence at all → weak confidence + inferences need confirmation", () => {
  const noEvidence: DraftInput = { founder_input: {}, company_input: { name: "X" }, company_research: null, founder_research: null };
  const d = mapDraftToV2(aiJson, noEvidence);
  assertEquals(d.brain_confidence, "weak");
  assert(d.needs_confirmation.includes("target_customer.industries"));
  assert(d.needs_confirmation.includes("buyer_personas"));
  assert(d.needs_confirmation.includes("competitors"));
  assert(d.evidence.confidence_notes.some((n) => /No research evidence/i.test(n)));
});

Deno.test("6. proof_points without a read page must be confirmed (never auto-trusted)", () => {
  const noPages: DraftInput = { ...fullInput(), company_research: null };
  const d = mapDraftToV2(aiJson, noPages);
  assert(d.needs_confirmation.includes("positioning.proof_points"));
});

Deno.test("7. missing evidence from adapters propagates into missing_fields", () => {
  const d = mapDraftToV2(aiJson, fullInput());
  assert(d.missing_fields.includes("work experience"), "founder's missing evidence surfaces");
});

Deno.test("8. empty model output produces empty targeting — no broad ICP defaults", () => {
  const d = mapDraftToV2({}, fullInput());
  assertEquals(d.target_customer.industries, []);
  assertEquals(d.buyer_personas, []);
  assertEquals(d.competitors, []);
  assertEquals(d.brain_confidence, "partial"); // evidence exists, but no targeting inferred
});

Deno.test("9. no LLM configured → honest error, nothing invented", async () => {
  const r = await generateBrainDraft(fullInput(), {});
  assertEquals(r.ok, false);
  assertEquals(r.error, "llm_not_configured");
  assertEquals(r.draft, null);
});

Deno.test("10. stubbed LLM produces a draft without any network call", async () => {
  const r = await generateBrainDraft(fullInput(), { generateJson: async () => ({ ok: true, json: aiJson }) });
  assertEquals(r.ok, true);
  assertEquals(r.draft?.company.name, "Cekura");
  assertEquals(r.draft?.is_draft, true);
});
