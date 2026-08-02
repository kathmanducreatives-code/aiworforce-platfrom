// AI draft → Company Brain v2 mapping + the repair pass.
// The LLM is a local stub; no provider ever runs.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildDraftPrompt, mapDraftToV2, generateBrainDraft, type DraftInput } from "../../functions/_shared/generateBrainDraft.ts";
import { extractFromPages } from "../../functions/_shared/companyWebsite.ts";
import { countDisqualifiers } from "../../functions/_shared/draftQuality.ts";
import type { FounderResearch } from "../../functions/_shared/types.ts";
import {
  HOME, FIXTURE_A_CLEAN_SAAS, FIXTURE_B_AMBIGUOUS, FIXTURE_F_SPARSE,
  FIXTURE_E_USER_BEATS_SITE, FIXTURE_E_USER_DESCRIPTION,
} from "../../functions/_shared/testFixtures.ts";

const research = (pages: typeof FIXTURE_A_CLEAN_SAAS, desc?: string) =>
  extractFromPages(pages, { websiteUrl: HOME, nameHint: "Cekura", descriptionHint: desc });

const founderResearch: FounderResearch = {
  name: "Jane Doe", headline: "Co-Founder & CEO", location: "SF",
  current_role: "CEO", current_company: "Cekura", experience: [], education: [], skills: [],
  summary: "", credibility_signals: ["Co-Founder & CEO"], gtm_relevance: ["GTM experience"],
  source_url: "https://linkedin.com/in/jane-doe", confidence: "medium", missing_evidence: ["work experience"],
};

/** A well-behaved model response. */
const aiJson = {
  company: { category: "sales software", business_model: "B2B SaaS" },
  founder: { name: "Jane Doe", role: "CEO" },
  target_customer: {
    industries: ["B2B SaaS"], business_models: ["B2B SaaS"],
    company_size: { min: 10, max: 150, label: "10-150" },
    funding_stage: ["seed"], geography: ["US"], must_have: ["outbound motion"], nice_to_have: [],
    disqualifiers: { industries: [], company_types: [], domains: [], keywords: [], titles: [] },
  },
  buyer_personas: [],
  buyer_persona_profiles: [],
  triggers: ["recently funded"], jobs_to_watch: ["Founding Account Executive"],
  competitors: ["Clay"], tools: ["HubSpot"],
  pain_points: ["manual outbound"], positive_examples: ["Acme"], negative_examples: ["Pace Analytical"],
  content_angles: ["pipeline before payroll"],
  qualification_rules: { required_evidence: [], reject_if: [], manual_review_if: [] },
  brand_voice: { tone: "direct" },
  positioning: { promise: "Pipeline before payroll", proof_points: ["3x faster research"] },
  needs_confirmation: [],
  missing_fields: [],
};

const inputFor = (pages = FIXTURE_A_CLEAN_SAAS, desc?: string): DraftInput => ({
  founder_input: { name: "Jane Doe", role: "CEO" },
  founder_research: founderResearch,
  company_input: { name: "Cekura", website_url: HOME, description: desc ?? "" },
  company_research: research(pages, desc),
  company_linkedin: null,
});

// ------------------------------------------------------------------ prompt ---

Deno.test("1. prompt is a skeptical strategist and leads with the understanding pass", () => {
  const { system, user } = buildDraftPrompt(inputFor());
  assert(/senior B2B GTM strategist/i.test(system));
  assert(/NEVER invent proof/i.test(system));
  assert(/Do not overfit to one page/i.test(system));
  assert(/broad, generic targeting/i.test(system));
  assert(/Confidence discipline/i.test(system));
  assert(/company_understanding/.test(user), "understanding pass leads the payload");
  assert(!/enrichment_consent/.test(user), "consent flag never reaches the model");
});

Deno.test("2. ambiguous website adds an explicit warning to trust the user", () => {
  const { user } = buildDraftPrompt(inputFor(FIXTURE_B_AMBIGUOUS));
  assert(/AMBIGUOUS/.test(user));
  assert(/Trust the user's company description/i.test(user));
  // A clean site gets no such warning.
  assert(!/AMBIGUOUS/.test(buildDraftPrompt(inputFor()).user));
});

// ------------------------------------------------------------------ mapping --

Deno.test("3. AI JSON maps into a Company Brain v2 draft", () => {
  const d = mapDraftToV2(aiJson, inputFor());
  assertEquals(d.schema_version, 2);
  assertEquals(d.setup_status, "in_progress");
  assertEquals(d.is_draft, true);
  assertEquals(d.company.name, "Cekura");
  assertEquals(d.company.business_model, "B2B SaaS");
  assertEquals(d.jobs_to_watch, ["Founding Account Executive"]);
});

Deno.test("4. evidence is rebuilt from REAL sources — a model cannot inject it", () => {
  const d = mapDraftToV2({ ...aiJson, evidence: { source_pages: ["https://fake.invented/page"] } }, inputFor());
  assert(!d.evidence.source_pages.includes("https://fake.invented/page"));
  assert(d.evidence.source_pages.every((u) => u.startsWith(HOME)));
  assert(d.evidence.linkedin_sources.includes("https://linkedin.com/in/jane-doe"));
});

// --------------------------------------------------- personas (mandatory) ----

Deno.test("5. at least 3 buyer personas are drafted when company context exists", () => {
  const d = mapDraftToV2(aiJson, inputFor());
  assert(d.buyer_persona_profiles.length >= 3, `got ${d.buyer_persona_profiles.length}`);
  assert(d.buyer_personas.length >= 3, "titles mirrored into the v2 string[] slot");
  for (const p of d.buyer_persona_profiles) {
    assert(p.title && p.department && p.seniority);
    assert(p.role_keywords.length > 0);
    assertEquals(p.needs_confirmation, true);
    assert(p.confidence !== "high");
  }
  assert(d.needs_confirmation.includes("buyer_personas"));
});

Deno.test("6. no company context → no personas invented", () => {
  const empty: DraftInput = { founder_input: {}, company_input: {}, company_research: null, founder_research: null };
  const d = mapDraftToV2({}, empty);
  assertEquals(d.buyer_persona_profiles, []);
  assertEquals(d.buyer_personas, []);
});

// ---------------------------------------------- disqualifiers (mandatory) ----

Deno.test("7. at least 5 disqualifiers drafted when a target customer exists", () => {
  const d = mapDraftToV2(aiJson, inputFor());
  const disq = d.target_customer.disqualifiers as Record<string, string[]>;
  assert(countDisqualifiers(disq) >= 5, `got ${countDisqualifiers(disq)}`);
  assert(disq.titles.length > 0 && disq.company_types.length > 0);
  assert(d.needs_confirmation.includes("target_customer.disqualifiers"));
});

Deno.test("8. empty model targeting + real company context → SUGGESTED targeting, flagged for confirmation", () => {
  // v3: the founder confirms suggestions instead of inventing obvious fields.
  const noTarget = { ...aiJson, target_customer: { industries: [], business_models: [], disqualifiers: {} } };
  const d = mapDraftToV2(noTarget, inputFor());
  const tc = d.target_customer as Record<string, string[]>;
  assert(tc.industries.length > 0 || tc.business_models.length > 0, "targeting suggested from context");
  assert(countDisqualifiers(d.target_customer.disqualifiers as never) >= 5, "disqualifiers follow the suggested target");
  assert(d.needs_confirmation.some((n) => n.startsWith("target_customer")), "suggestions are flagged");
});

Deno.test("8b. no company context at all → nothing fabricated", () => {
  const empty: DraftInput = { founder_input: {}, company_input: {}, company_research: null, founder_research: null };
  const noTarget = { target_customer: { industries: [], business_models: [], disqualifiers: {} } };
  const d = mapDraftToV2(noTarget, empty);
  const tc = d.target_customer as Record<string, string[]>;
  assertEquals(tc.industries.length, 0);
  assertEquals(countDisqualifiers(d.target_customer.disqualifiers as never), 0);
  assertEquals((d.triggers as string[]).length, 0);
});

// ------------------------------------------------------ qualification rules --

Deno.test("9. qualification rules are always complete, even when the model omits them", () => {
  const d = mapDraftToV2(aiJson, inputFor());
  const q = d.qualification_rules as Record<string, string[]>;
  assert(q.required_evidence.length >= 3);
  assert(q.reject_if.length >= 3);
  assert(q.manual_review_if.length >= 3);
  assert(q.reject_if.some((r) => /disqualifier/i.test(r)));
  assert(q.reject_if.some((r) => /buyer title with no company fit/i.test(r)));
});

// -------------------------------------------------------- invented claims ----

Deno.test("10. the model cannot invent funding, customers, integrations or competitors", () => {
  const lying = {
    ...aiJson,
    positioning: { promise: "x", proof_points: ["Raised $4M seed", "We grew 10x", "3x faster research"] },
    integrations: ["Slack", "HubSpot"],
    positive_examples: ["Stripe"],
    competitors: ["Clay"],
  };
  const d = mapDraftToV2(lying, inputFor());
  const proof = (d.positioning as Record<string, string[]>).proof_points;

  assert(!proof.some((p) => /raised|\$4M|seed/i.test(p)), "funding is never scrapable");
  assert(!proof.some((p) => /10x/.test(p)), "unsourced proof dropped");
  assert(proof.some((p) => /3x/.test(p)), "sourced proof kept");
  assert(d.dropped_claims.some((c) => /funding claim/i.test(c)));

  // Named customers and competitors survive but must be confirmed.
  assert(d.needs_confirmation.includes("positive_examples"));
  assert(d.needs_confirmation.includes("competitors"));
});

Deno.test("11. proof points from a sparse site cannot exist at all", () => {
  const d = mapDraftToV2({ ...aiJson, positioning: { proof_points: ["3x faster"] } }, inputFor(FIXTURE_F_SPARSE));
  assertEquals((d.positioning as Record<string, string[]>).proof_points, []);
});

// --------------------------------------------------------------- confidence --

Deno.test("12. brain_confidence can never be 'strong' on an ambiguous or thin read", () => {
  assertEquals(mapDraftToV2(aiJson, inputFor(FIXTURE_B_AMBIGUOUS)).brain_confidence, "partial");
  assertEquals(mapDraftToV2(aiJson, inputFor(FIXTURE_F_SPARSE)).brain_confidence, "partial");
  const noEvidence: DraftInput = { founder_input: {}, company_input: { name: "X" }, company_research: null, founder_research: null };
  assertEquals(mapDraftToV2(aiJson, noEvidence).brain_confidence, "weak");
});

Deno.test("13. ambiguous website flags the category for confirmation", () => {
  const d = mapDraftToV2(aiJson, inputFor(FIXTURE_B_AMBIGUOUS));
  assert(d.needs_confirmation.includes("company.category:ambiguous_website"));
  assert(d.needs_confirmation.includes("product_category"));
});

// ------------------------------------------------------------- sanitization --

Deno.test("14. glued chips and duplicates are cleaned before the UI sees them", () => {
  const messy = {
    ...aiJson,
    pain_points: ["  • manual outbound ", "manual outbound", "", "FoundersSales leaders"],
    content_angles: ["RevOps", "RevOps"],
  };
  const d = mapDraftToV2(messy, inputFor());
  assertEquals(d.pain_points, ["manual outbound", "Founders Sales leaders"]);
  assertEquals(d.content_angles, ["RevOps"], "real compounds are not split");
});

// -------------------------------------------------------- display evidence ---

Deno.test("15. draft carries display-ready per-page evidence", () => {
  const d = mapDraftToV2(aiJson, inputFor());
  assert(d.source_evidence.length > 0);
  const home = d.source_evidence.find((e) => e.page_type === "homepage")!;
  assert(home.used_for.includes("product_category"));
  const blogLess = d.source_evidence.every((e) => e.page_type !== "blog" || e.ignored_for.includes("product_category"));
  assert(blogLess);
});

// --------------------------------------------------- activation readiness ----

Deno.test("16. a clean read produces a draft with enough to review and activate", () => {
  const d = mapDraftToV2(aiJson, inputFor());
  assert(d.company.name && d.company.business_model);
  assert((d.target_customer.industries as string[]).length > 0);
  assert(d.buyer_personas.length >= 3);
  assert(countDisqualifiers(d.target_customer.disqualifiers as never) >= 5);
  assert(d.triggers.length > 0 || d.jobs_to_watch.length > 0);
  assert(d.pain_points.length > 0 || d.content_angles.length > 0);
});

Deno.test("17. user description rescues an ambiguous site into a usable draft", () => {
  const d = mapDraftToV2(aiJson, inputFor(FIXTURE_E_USER_BEATS_SITE, FIXTURE_E_USER_DESCRIPTION));
  assertEquals(d.company.description, FIXTURE_E_USER_DESCRIPTION);
  assert(d.buyer_personas.length >= 3, "personas still drafted from the user's own words");
});

// -------------------------------------------------------------- provider gate -

Deno.test("18. no LLM configured → honest error, nothing invented", async () => {
  const r = await generateBrainDraft(inputFor(), {});
  assertEquals(r.ok, false);
  assertEquals(r.error, "llm_not_configured");
  assertEquals(r.draft, null);
});

Deno.test("19. stubbed LLM produces a draft without any network call", async () => {
  const r = await generateBrainDraft(inputFor(), { generateJson: async () => ({ ok: true, json: aiJson }) });
  assertEquals(r.ok, true);
  assertEquals(r.draft?.company.name, "Cekura");
  assertEquals(r.draft?.is_draft, true);
  assert((r.draft?.buyer_persona_profiles.length ?? 0) >= 3);
});
