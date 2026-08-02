// Research System v3 — fixture tests for the actor strategy, example/proof
// separation, ICP suggestion fallbacks and activation suggestions.
// Every provider is a local stub; NO network, NO Apify, NO Firecrawl, NO LLM.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  enrichFounderFromLinkedIn, normalizeFounderProfile, isSparseFounderResearch,
  buildProfileActorInput, FOUNDER_ACTOR_ENV, FOUNDER_ACTOR_FALLBACK_ENV,
} from "./founderLinkedIn.ts";
import {
  enrichCompanyFromLinkedIn, normalizeCompanyLinkedIn, isSparseCompanyLinkedIn,
} from "./companyLinkedIn.ts";
import { selectPages, extractFromPages, isExcludedPath, MAX_PAGES } from "./companyWebsite.ts";
import { isExampleSentence } from "./companyUnderstanding.ts";
import { mapDraftToV2, type DraftInput } from "./generateBrainDraft.ts";
import { buildActivationSuggestions, hasSuggestions } from "./activationSuggestions.ts";
import { computeCompanyBrainCompleteness } from "../companyBrainCompleteness.ts";
import { normalizeCompanyBrain } from "../normalizeCompanyBrain.ts";
import type { ResearchDeps } from "./types.ts";
import {
  AGENTORY_HOME, FIXTURE_G_AGENTORY_LIKE, FIXTURE_G_USER_DESCRIPTION,
  ACTOR_SHAPE_PARSEFORGE, ACTOR_SHAPE_NESTED, ACTOR_SHAPE_SPARSE,
  ACTOR_COMPANY_SHAPE_A, ACTOR_COMPANY_SHAPE_B,
} from "./testFixtures.ts";

const PROFILE_URL = "https://linkedin.com/in/jane-doe";
const COMPANY_URL = "https://linkedin.com/company/cekura";

/** Deps stub that records actor calls and returns canned rows per actor id. */
function actorDeps(byActor: Record<string, unknown[]>, env: Record<string, string> = {}) {
  const calls: Array<{ actor: string; input: Record<string, unknown> }> = [];
  const deps: ResearchDeps = {
    runApifyActor: (actor, input) => {
      calls.push({ actor, input: input as Record<string, unknown> });
      return Promise.resolve(byActor[actor] ?? []);
    },
    actorId: (name, fallback) => env[name] ?? fallback,
  };
  return { deps, calls };
}

// ---------------------------------------------------- 1. URL-driven scraping --

Deno.test("v3-1. a profile URL drives a profile scraper — never a people search", async () => {
  const { deps, calls } = actorDeps(
    { "apimaestro/linkedin-profile-detail": [ACTOR_SHAPE_PARSEFORGE] },
  );
  const r = await enrichFounderFromLinkedIn({ profileUrl: PROFILE_URL, consent: true }, deps);
  assert(r.ok);
  assertEquals(calls.length, 1);
  const input = calls[0].input;
  assertEquals(input.profileUrls, [PROFILE_URL]);
  assertEquals(input.maxItems, 1);
  // No people-search keys, ever.
  for (const k of ["keywords", "searchQuery", "query", "search", "titles", "location"]) {
    assertEquals(k in input, false, `people-search key "${k}" must not appear`);
  }
});

Deno.test("v3-1b. actor ids resolve from env, with a separate fallback env", async () => {
  const { deps, calls } = actorDeps(
    { "custom/primary": [], "custom/fallback": [ACTOR_SHAPE_PARSEFORGE] },
    { [FOUNDER_ACTOR_ENV]: "custom/primary", [FOUNDER_ACTOR_FALLBACK_ENV]: "custom/fallback" },
  );
  const r = await enrichFounderFromLinkedIn({ profileUrl: PROFILE_URL, consent: true }, deps);
  assert(r.ok);
  assertEquals(calls.map((c) => c.actor), ["custom/primary", "custom/fallback"]);
  assertEquals(r.actor_used, "custom/fallback");
});

// ------------------------------------------------------- 2. sparse handling --

Deno.test("v3-2. sparse actor output is a failure with low confidence, not a success", async () => {
  const { deps } = actorDeps({
    "apimaestro/linkedin-profile-detail": [ACTOR_SHAPE_SPARSE],
    "curious_coder/linkedin-profile-scraper": [ACTOR_SHAPE_SPARSE],
  });
  const r = await enrichFounderFromLinkedIn({ profileUrl: PROFILE_URL, consent: true }, deps);
  assertEquals(r.ok, false);
  assertEquals(r.error, "sparse_profile_data");
  assert(r.research, "sparse research is still attached for honesty");
  assertEquals(r.research!.confidence, "low");
  assert(isSparseFounderResearch(r.research!));
});

// ------------------------------------------------- 3. output shape handling --

Deno.test("v3-3. flat snake_case and nested camelCase actor shapes both normalize", () => {
  const flat = normalizeFounderProfile(ACTOR_SHAPE_PARSEFORGE, PROFILE_URL);
  assertEquals(flat.name, "Jane Doe");
  assert(flat.headline.includes("Co-Founder"));
  assertEquals(flat.current_company, "Cekura");
  assertEquals(flat.experience.length, 2);
  assertEquals(flat.education[0].school, "Stanford");
  assert(!isSparseFounderResearch(flat));

  const nested = normalizeFounderProfile(ACTOR_SHAPE_NESTED, PROFILE_URL);
  assertEquals(nested.name, "Jane Doe");
  assert(nested.headline.includes("Co-Founder"));
  assertEquals(nested.experience[0].company, "Cekura");
  assertEquals(nested.education[0].school, "Stanford");
  assert(!isSparseFounderResearch(nested));
});

// ------------------------------------------------------------- 4. no PII -----

Deno.test("v3-4. emails, phones and contact blocks never survive normalization", () => {
  const r = normalizeFounderProfile(ACTOR_SHAPE_PARSEFORGE, PROFILE_URL);
  const s = JSON.stringify(r);
  assert(!s.includes("jane@example.com"), "email stripped");
  assert(!s.includes("+1 555"), "phone stripped");
  assert(!/contact_info|email|phone/i.test(Object.keys(r).join(",")));
});

// ------------------------------------------------- 5. company normalization --

Deno.test("v3-5. company actor shapes normalize with name/HQ/founded", async () => {
  const a = normalizeCompanyLinkedIn(ACTOR_COMPANY_SHAPE_A, COMPANY_URL);
  assertEquals(a.company_name, "Cekura");
  assertEquals(a.headquarters, "San Francisco, CA");
  assertEquals(a.founded, "2024");
  assertEquals(a.employee_count, "51-200");
  assert(!isSparseCompanyLinkedIn(a));

  const b = normalizeCompanyLinkedIn(ACTOR_COMPANY_SHAPE_B, COMPANY_URL);
  assertEquals(b.company_name, "Cekura");
  assertEquals(b.website, "https://cekura.ai");
  assertEquals(b.employee_count, "87");
  assert(!isSparseCompanyLinkedIn(b));

  // Fallback actor engages when the primary returns junk.
  const { deps, calls } = actorDeps({
    "curious_coder/linkedin-company-scraper": [{ id: "junk" }],
    "apimaestro/linkedin-company-detail": [ACTOR_COMPANY_SHAPE_A],
  });
  const r = await enrichCompanyFromLinkedIn({ companyUrl: COMPANY_URL }, deps);
  assert(r.ok);
  assertEquals(calls.length, 2);
  assertEquals(r.actor_used, "apimaestro/linkedin-company-detail");
});

// ------------------------------------------------ 6-7. page selection rules --

Deno.test("v3-6. Map selection prefers product pages within the cap", () => {
  const mapped = [
    `${AGENTORY_HOME}/product`, `${AGENTORY_HOME}/pricing`, `${AGENTORY_HOME}/blog/post`,
    `${AGENTORY_HOME}/customers`, `${AGENTORY_HOME}/how-it-works`,
  ];
  const urls = selectPages(AGENTORY_HOME, mapped, MAX_PAGES);
  assertEquals(urls[0], AGENTORY_HOME);
  assertEquals(urls[1], `${AGENTORY_HOME}/product`);
  assert(urls.includes(`${AGENTORY_HOME}/how-it-works`), "how-it-works counts as product");
  assert(!urls.includes(`${AGENTORY_HOME}/blog/post`), "blog earns no budget");
});

Deno.test("v3-7. login / app / legal pages never earn crawl budget", () => {
  for (const p of ["/login", "/sign-up", "/app", "/dashboard", "/privacy", "/terms", "/cookies", "/legal"]) {
    assert(isExcludedPath(`${AGENTORY_HOME}${p}`), `${p} must be excluded`);
  }
  const mapped = [`${AGENTORY_HOME}/login`, `${AGENTORY_HOME}/privacy`, `${AGENTORY_HOME}/pricing`];
  const urls = selectPages(AGENTORY_HOME, mapped, MAX_PAGES);
  assertEquals(urls, [AGENTORY_HOME, `${AGENTORY_HOME}/pricing`]);
});

// --------------------------------------- 8-10. Agentory-like understanding ---

const agentory = () => extractFromPages(FIXTURE_G_AGENTORY_LIKE, {
  websiteUrl: AGENTORY_HOME, nameHint: "Agentory", descriptionHint: FIXTURE_G_USER_DESCRIPTION,
});

Deno.test("v3-8. Agentory-like site is NOT classified as recruiting", () => {
  const r = agentory();
  assert(!/recruit|staffing/i.test(r.product_category), `got "${r.product_category}"`);
  assert(r.product_category.length > 0, "a category hypothesis is still offered");
  assert(/lead intelligence|ai workforce|ai-powered/i.test(r.product_category), `got "${r.product_category}"`);
});

Deno.test("v3-9. demo signals and example workflows are quarantined from proof", () => {
  const r = agentory();
  const u = r.understanding;
  assert(isExampleSentence("For example, imagine a Series A fintech hiring SDRs"), "example detector works");
  assert(!u.proof_points.some((p) => /52 signals/i.test(p)), "demo signal is not proof");
  assert(u.examples_detected.some((e) => /52 signals|series a fintech/i.test(e)), "demo captured as example");
  assert(u.claims.some((c) => c.tag === "signal_example"), "claims carry the signal_example tag");
  assert(!u.claims.some((c) => c.tag === "customer_proof" && /52 signals/i.test(c.text)));
});

Deno.test("v3-10. the user's description anchors the category and is tagged user_input", () => {
  const r = agentory();
  const u = r.understanding;
  assert(u.claims.some((c) => c.tag === "user_input" && /ai workforce os/i.test(c.text)));
  // Inferred category is flagged for confirmation, never silently asserted.
  if (u.needs_confirmation.some((n) => n.startsWith("product_category:inferred"))) {
    assert(u.ambiguity_reasons.length > 0, "ambiguity is explained in plain English");
    assert(u.confidence !== "high", "an inferred category is never high confidence");
  }
});

// ------------------------------------- 11-16. draft fallbacks + confidence ---

const emptyModelDraft = () => {
  const input: DraftInput = {
    founder_input: { name: "Prasidha", role: "Founder" },
    founder_research: null,
    company_input: { name: "Agentory", website_url: AGENTORY_HOME, description: FIXTURE_G_USER_DESCRIPTION },
    company_research: agentory(),
    company_linkedin: null,
  };
  // The model returned nothing useful — v3 must still produce a useful draft.
  return mapDraftToV2({}, input);
};

Deno.test("v3-11. >=3 buyer personas for an Agentory-like product", () => {
  const d = emptyModelDraft();
  assert(d.buyer_persona_profiles.length >= 3, `got ${d.buyer_persona_profiles.length}`);
  assert(d.buyer_personas.some((p) => /founder|ceo/i.test(p)), "economic buyer present");
  assert(d.buyer_persona_profiles.every((p) => p.needs_confirmation === true));
});

Deno.test("v3-12. >=5 disqualifiers for an Agentory-like product", () => {
  const d = emptyModelDraft();
  const disq = d.target_customer.disqualifiers as Record<string, string[]>;
  const count = disq.industries.length + disq.company_types.length + disq.keywords.length + disq.titles.length + disq.domains.length;
  assert(count >= 5, `got ${count}`);
  assert(d.needs_confirmation.includes("target_customer.disqualifiers"));
});

Deno.test("v3-13. qualification rules always generated", () => {
  const d = emptyModelDraft();
  const q = d.qualification_rules as Record<string, string[]>;
  assert(q.required_evidence.length >= 3);
  assert(q.reject_if.length >= 3);
  assert(q.manual_review_if.length >= 2);
});

Deno.test("v3-14. content angles + brand voice suggested from product context", () => {
  const d = emptyModelDraft();
  assert(d.content_angles.length >= 2, `got ${d.content_angles.length}`);
  assert(d.content_angles.some((a) => /pipeline before payroll|signal-based|lead lists/i.test(a)));
  const voice = d.brand_voice as Record<string, unknown>;
  assert(typeof voice.tone === "string" && (voice.tone as string).length > 0, "brand voice tone set");
  assert(Array.isArray(voice.tags) && (voice.tags as string[]).includes("founder-focused"));
});

Deno.test("v3-15. thin evidence can never present as strong", () => {
  const d = emptyModelDraft();
  assert(d.brain_confidence !== "strong", `got ${d.brain_confidence}`);
  const u = agentory().understanding;
  assert(u.confidence !== "high", "inferred/ambiguous read caps at medium");
});

Deno.test("v3-16. every suggested field is flagged as ai_suggested for confirmation", () => {
  const d = emptyModelDraft();
  assert(d.needs_confirmation.some((n) => n === "target_customer:ai_suggested"));
  assert(d.needs_confirmation.some((n) => n === "triggers:ai_suggested"));
});

// ------------------------------------------- 17. activation suggested fixes --

Deno.test("v3-17. blocked activation returns editable suggested fixes", () => {
  // A Brain with company context but missing personas/triggers/disqualifiers.
  const brain = normalizeCompanyBrain({
    schema_version: 2,
    company: { name: "Agentory", website_url: AGENTORY_HOME, description: FIXTURE_G_USER_DESCRIPTION, business_model: "B2B SaaS", category: "AI-powered lead intelligence" },
  });
  const completeness = computeCompanyBrainCompleteness(brain);
  assertEquals(completeness.complete, false);

  const fixes = buildActivationSuggestions(brain, completeness);
  assert(hasSuggestions(fixes));
  assert((fixes.suggested_buyer_personas?.length ?? 0) >= 3, "personas suggested");
  assert((fixes.suggested_disqualifiers?.length ?? 0) >= 5, "disqualifiers suggested");
  assert((fixes.suggested_triggers?.length ?? 0) >= 1, "triggers suggested");
  assert((fixes.suggested_target_customer?.value.industries.length ?? 0) >= 1, "targeting suggested");
  for (const s of fixes.suggested_buyer_personas ?? []) {
    assertEquals(s.origin, "ai_inference");
    assertEquals(s.needs_confirmation, true);
    assert(s.confidence === "low" || s.confidence === "medium", "suggestions are never high confidence");
  }
});

Deno.test("v3-17b. a complete Brain gets no suggestions", () => {
  const brain = normalizeCompanyBrain({
    schema_version: 2,
    company: { name: "Agentory", website_url: AGENTORY_HOME, description: "x", business_model: "B2B SaaS" },
    target_customer: { industries: ["B2B SaaS"], disqualifiers: { industries: ["staffing"] } },
    buyer_personas: ["Founder / CEO"],
    triggers: ["raised a round"],
    pain_points: ["no pipeline"],
  });
  const completeness = computeCompanyBrainCompleteness(brain);
  assertEquals(completeness.complete, true);
  assertEquals(hasSuggestions(buildActivationSuggestions(brain, completeness)), false);
});

// ------------------------------------------------- 18. no providers in tests --

Deno.test("v3-18. adapters refuse to run without injected deps (no real providers)", async () => {
  const noDeps: ResearchDeps = {};
  const f = await enrichFounderFromLinkedIn({ profileUrl: PROFILE_URL, consent: true }, noDeps);
  assertEquals(f.skipped, true);
  assertEquals(f.reason, "apify_not_configured");
  const c = await enrichCompanyFromLinkedIn({ companyUrl: COMPANY_URL }, noDeps);
  assertEquals(c.skipped, true);
});

// Input builders stay URL-driven (guards the "no people search" invariant).
Deno.test("v3-18b. profile actor input carries only URL/username variants — never a people search", () => {
  const input = buildProfileActorInput(PROFILE_URL);
  // URL forms for URL-keyed actors + the bare handle for username-keyed actors.
  for (const k of ["profileUrls", "urls", "startUrls", "profileUrl", "url", "username", "maxItems"]) {
    assert(k in input, `expected input key ${k}`);
  }
  // NEVER any free-text search keys.
  for (const k of ["keywords", "searchQuery", "query", "search", "title", "titles"]) {
    assertEquals(k in input, false, `people-search key "${k}" must not appear`);
  }
});
