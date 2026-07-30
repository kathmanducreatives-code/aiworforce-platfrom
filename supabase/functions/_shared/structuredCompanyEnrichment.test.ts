import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCompanyEnrichmentInput, normalizeCompanyActorItem, interpretCompanyActorResponse,
  normalizeCompanyLinkedInUrl, normalizeWebsite, normalizeCompanyNameFallback,
  normalizeIndustries, selectHeadquarters, extractProviderCompanyLinkedInUrl,
  COMPANY_DETAILS_ACTOR_KEY, COMPANY_DETAILS_ACTOR_ID,
} from "./structuredCompanyEnrichment.ts";
import {
  FIXTURE_COMPLETE, FIXTURE_NO_WEBSITE, FIXTURE_NO_INDUSTRY, FIXTURE_MULTI_LOCATION,
  FIXTURE_DIRTY_WEBSITE, FIXTURE_TRACKED_LINKEDIN, FIXTURE_PERSON_URL_AS_COMPANY,
  FIXTURE_BAD_EMPLOYEE_COUNT, FIXTURE_EMPTY, FIXTURE_ERROR, FIXTURE_DUPLICATES,
  FIXTURE_VARIANT_SHAPES,
} from "./linkedinCompanyActorFixture.ts";
import { DEFAULT_EVIDENCE_BUDGET } from "./conditionalEnrichmentPlanner.ts";
import { getActorCapability, isCallable, getStructuredCompanyEnrichmentCapability, STRUCTURED_COMPANY_ENRICHMENT_ACTOR_KEY } from "./actorCapabilityRegistry.ts";
import { getActorByKey, ACTOR_REGISTRY } from "./actorRegistry.ts";
import { satisfiedCategories, appendEvidence, type CandidateEnvelope } from "./candidateEnvelope.ts";

const B = DEFAULT_EVIDENCE_BUDGET;
const NOW = "2026-07-16T12:00:00.000Z";

// ---- (1)(2)(15) binding ----
Deno.test("1: canonical actor registry binds harvestapi/linkedin-company", () => {
  const e = ACTOR_REGISTRY["apify_linkedin_company_details"];
  assert(e, "registry entry missing");
  assertEquals(e.actor_id, "harvestapi/linkedin-company");
  assertEquals(e.key, "apify_linkedin_company_details");
  assertEquals(e.provider, "apify");
  assertEquals(e.enabled, true);
});

Deno.test("2: capability registry marks structured company enrichment VERIFIED", () => {
  const cap = getStructuredCompanyEnrichmentCapability();
  assertEquals(STRUCTURED_COMPANY_ENRICHMENT_ACTOR_KEY, "apify_linkedin_company_details");
  assertEquals(isCallable(cap), true);
  assertEquals(cap!.implementationId, "harvestapi/linkedin-company");
  assertEquals(cap!.costClass, "low");
  // Same identity everywhere.
  assertEquals(cap!.actorKey, COMPANY_DETAILS_ACTOR_KEY);
  assertEquals(cap!.implementationId, COMPANY_DETAILS_ACTOR_ID);
  assertEquals(getActorCapability("apify_linkedin_company_details")!.verifiedBinding, true);
});

Deno.test("3: planner prose / tool_input cannot replace the actor id", () => {
  // The id is resolved from the canonical registry, never from caller text.
  const id = getActorByKey("apify_linkedin_company_details")?.actor_id ?? null;
  assertEquals(id, "harvestapi/linkedin-company");
  // A bogus key (e.g. injected via planner prose) resolves to nothing — never a
  // generic "apify" and never an attacker-supplied implementation id.
  assertEquals(getActorByKey("totally_made_up_actor"), null);
  assertEquals(getActorByKey("harvestapi/linkedin-company-search"), null);
  assert(id !== "apify");
});

// ---- (4)(5)(6)(7)(8) input builder ----
Deno.test("4: LinkedIn company URL is preferred over company name", () => {
  const p = buildCompanyEnrichmentInput([{ companyKey: "k1", companyLinkedInUrl: "https://www.linkedin.com/company/acme-saas", companyName: "Acme SaaS" }], B);
  assertEquals(p.input.companies, ["https://www.linkedin.com/company/acme-saas"]);
  assertEquals(p.input.searches, undefined);
  assertEquals(p.targets[0].via, "companies");
});

Deno.test("5: company-name fallback is deterministic and free of role/hiring prose", () => {
  const p = buildCompanyEnrichmentInput([{ companyKey: "k1", companyName: "Founder & CEO at Acme SaaS Inc — we're hiring engineers" }], B);
  assertEquals(p.input.companies, undefined);
  assertEquals(p.targets[0].via, "searches");
  const name = p.input.searches![0];
  assert(!/founder|ceo|hiring|engineers?/i.test(name), name);
  assertEquals(normalizeCompanyNameFallback("Acme SaaS Inc."), "Acme SaaS");
  // deterministic
  assertEquals(normalizeCompanyNameFallback("Acme SaaS Inc."), normalizeCompanyNameFallback("Acme SaaS Inc."));
});

Deno.test("6: a PERSON profile URL can never be used as a company URL", () => {
  assertEquals(normalizeCompanyLinkedInUrl("https://www.linkedin.com/in/jane-founder"), null);
  const p = buildCompanyEnrichmentInput([{ companyKey: "k1", companyLinkedInUrl: "https://www.linkedin.com/in/jane-founder", companyName: "Acme SaaS" }], B);
  // Falls back to the name — never emits the person URL.
  assertEquals(p.input.companies, undefined);
  assertEquals(p.input.searches, ["Acme SaaS"]);
});

Deno.test("7: input builder dedupes company identifiers and company keys", () => {
  const p = buildCompanyEnrichmentInput([
    { companyKey: "k1", companyLinkedInUrl: "https://www.linkedin.com/company/acme/" },
    { companyKey: "k1", companyLinkedInUrl: "https://www.linkedin.com/company/acme" },      // same key
    { companyKey: "k2", companyLinkedInUrl: "https://www.linkedin.com/company/ACME?trk=x" }, // same URL, other key
  ], B);
  assertEquals(p.input.companies!.length, 1);
  assertEquals(p.input.companies, ["https://www.linkedin.com/company/acme"]);
});

Deno.test("8: input builder respects the enrichment budget cap", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ companyKey: `k${i}`, companyLinkedInUrl: `https://www.linkedin.com/company/c${i}` }));
  const p = buildCompanyEnrichmentInput(many, B);
  assertEquals(p.targets.length, B.companyStructuredEnrichments);   // 8
  assertEquals(p.input.companies!.length, 8);
  assert(p.skipped.every((s) => s.reason === "budget_cap"));
  assertEquals(p.skipped.length, 4);
});

Deno.test("input builder: URL userinfo/query/fragment stripped; non-http rejected", () => {
  assertEquals(normalizeCompanyLinkedInUrl("https://user:pw@www.linkedin.com/company/x"), null);
  assertEquals(normalizeCompanyLinkedInUrl("https://www.linkedin.com/company/x/?trk=a#b"), "https://www.linkedin.com/company/x");
  assertEquals(normalizeCompanyLinkedInUrl("javascript:alert(1)"), null);
  assertEquals(normalizeWebsite("https://acme.com/home?utm=1#top"), "https://acme.com/home");
  assertEquals(normalizeWebsite("ftp://acme.com"), null);
});

// ---- (9)-(14) normalizer ----
Deno.test("9/10/13: complete output normalizes website + industry, stripping query/fragment", () => {
  const b = normalizeCompanyActorItem(FIXTURE_COMPLETE, "dom:acmesaas.com", { observedAt: NOW })!;
  assertEquals(b.company.officialWebsite, "https://www.acmesaas.com");     // query+fragment gone
  assertEquals(b.company.industries, ["Software Development", "B2B SaaS"]);
  assertEquals(b.company.linkedinUrl, "https://www.linkedin.com/company/acme-saas");
});

Deno.test("11: employee count/range normalize safely; invalid strings are NOT coerced", () => {
  const ok = normalizeCompanyActorItem(FIXTURE_COMPLETE, "k", { observedAt: NOW })!;
  assertEquals(ok.company.employeeCount, 48);
  assertEquals(ok.company.employeeRange, { start: 11, end: 50 });
  const bad = normalizeCompanyActorItem(FIXTURE_BAD_EMPLOYEE_COUNT, "k", { observedAt: NOW })!;
  assertEquals(bad.company.employeeCount, undefined);        // "about fifty" not fabricated
  assertEquals(bad.company.employeeRange, undefined);
  assert(!bad.evidence.some((e) => e.category === "company_size"));
});

Deno.test("12: headquarters prefers headquarter=true", () => {
  const b = normalizeCompanyActorItem(FIXTURE_MULTI_LOCATION, "k", { observedAt: NOW })!;
  assertEquals(b.company.headquarters!.city, "Boston");
  assertEquals(b.company.headquarters!.countryCode, "US");
  const c = normalizeCompanyActorItem(FIXTURE_COMPLETE, "k", { observedAt: NOW })!;
  assertEquals(c.company.headquarters!.city, "Austin");     // the HQ-flagged one, not Brooklyn
});

Deno.test("13b: dirty website + tracked LinkedIn URL normalize", () => {
  const d = normalizeCompanyActorItem(FIXTURE_DIRTY_WEBSITE, "k", { observedAt: NOW })!;
  assertEquals(d.company.officialWebsite, "http://dirty.example.com/home");
  const t = normalizeCompanyActorItem(FIXTURE_TRACKED_LINKEDIN, "k", { observedAt: NOW })!;
  assertEquals(t.company.linkedinUrl, "https://www.linkedin.com/company/tracked");
});

Deno.test("14: a person URL in the company field is rejected (no company_identity URL)", () => {
  const b = normalizeCompanyActorItem(FIXTURE_PERSON_URL_AS_COMPANY, "k", { observedAt: NOW })!;
  assertEquals(b.company.linkedinUrl, undefined);
  assert(!b.evidence.some((e) => String(e.value ?? "").includes("/in/")));
});

Deno.test("normalizer: missing website / industry are not fabricated", () => {
  const w = normalizeCompanyActorItem(FIXTURE_NO_WEBSITE, "k", { observedAt: NOW })!;
  assertEquals(w.company.officialWebsite, undefined);
  assert(!w.evidence.some((e) => e.category === "company_website"));
  const i = normalizeCompanyActorItem(FIXTURE_NO_INDUSTRY, "k", { observedAt: NOW })!;
  assertEquals(i.company.industries, undefined);
  assert(!i.evidence.some((e) => e.category === "company_industry"));
});

Deno.test("normalizer: documented variants (industries string, flat range, parsed HQ)", () => {
  const v = normalizeCompanyActorItem(FIXTURE_VARIANT_SHAPES, "k", { observedAt: NOW })!;
  assertEquals(v.company.industries, ["Software Development"]);
  assertEquals(v.company.employeeRange, { start: 51, end: 200 });
  assertEquals(v.company.headquarters!.countryCode, "CA");
  assertEquals(normalizeIndustries([{ name: "SaaS" }, "SaaS", "", null]), ["SaaS"]);
  assertEquals(selectHeadquarters([]), undefined);
});

// ---- privacy: phone must never surface ----
Deno.test("phone/email never enter evidence or the normalized company", () => {
  const b = normalizeCompanyActorItem(FIXTURE_COMPLETE, "k", { observedAt: NOW })!;
  const json = JSON.stringify(b);
  assert(!/415 555 0199|"phone"/.test(json), json);
});

// ---- (15) provenance ----
Deno.test("15: company evidence carries canonical actor provenance", () => {
  const b = normalizeCompanyActorItem(FIXTURE_COMPLETE, "k", { observedAt: NOW, providerRunId: "run-1" })!;
  assertEquals(b.provenance.provider, "apify");
  assertEquals(b.provenance.actorKey, "apify_linkedin_company_details");
  assertEquals(b.provenance.actorId, "harvestapi/linkedin-company");
  assertEquals(b.provenance.verified, true);
  for (const e of b.evidence) {
    assertEquals(e.actorId, "harvestapi/linkedin-company");
    assertEquals(e.sourceType, "apify_actor");
    assertEquals(e.verified, true);
    assertEquals(e.observedAt, NOW);
  }
});

// ---- (16)(17) evidence integrity ----
Deno.test("16/17: Brain constraints and LLM guesses cannot become company evidence", () => {
  const env: CandidateEnvelope = {
    candidateId: "c1", targetEntity: "person", primaryArtifactType: "person_candidate", evidence: [],
    sourceProvenance: { provider: "apify", actorKey: "apify_people_search", actorId: "harvestapi/linkedin-profile-search", verified: true },
  };
  const withBrain = appendEvidence(env, [{ category: "company_industry", sourceType: "company_brain", confidence: "high", verified: true }]);
  assertEquals(withBrain.evidence.length, 0);
  const withGuess = appendEvidence(env, [{ category: "company_industry", sourceType: "public_web", confidence: "high", verified: false }]);
  assert(!satisfiedCategories(withGuess).has("company_industry"));
});

// ---- (22) structured enrichment fills fit gaps ----
Deno.test("22: enrichment evidence fills website/industry/size/geography gaps", () => {
  const b = normalizeCompanyActorItem(FIXTURE_COMPLETE, "dom:acmesaas.com", { observedAt: NOW })!;
  const env: CandidateEnvelope = {
    candidateId: "c1", targetEntity: "person", primaryArtifactType: "person_candidate", evidence: [],
    sourceProvenance: { provider: "apify", actorKey: "apify_people_search", actorId: "harvestapi/linkedin-profile-search", verified: true },
  };
  const after = appendEvidence(env, b.evidence);
  const sat = satisfiedCategories(after);
  assert(sat.has("company_website") && sat.has("company_industry") && sat.has("company_size") && sat.has("company_geography") && sat.has("company_identity"));
  // description/tagline is only a LOW-confidence business-model hint.
  const bm = after.evidence.find((e) => e.category === "company_business_model");
  assertEquals(bm?.confidence, "low");
  assert(!satisfiedCategories(after, "medium").has("company_business_model"));
});

// ---- (24)(25)(26)(28) failure policy ----
Deno.test("24/26: empty result stages safely, fabricates nothing", () => {
  const r = interpretCompanyActorResponse({ companyKey: "k", items: FIXTURE_EMPTY });
  assertEquals(r.outcome, "no_result");
  assertEquals(r.bundle, null);
  assertEquals(r.failureReason, "empty_result");
});

Deno.test("25/28: provider error is isolated and fabricates nothing", () => {
  const bad = interpretCompanyActorResponse({ companyKey: "k1", error: FIXTURE_ERROR });
  assertEquals(bad.outcome, "provider_error");
  assertEquals(bad.bundle, null);
  // An unrelated company still enriches normally.
  const good = interpretCompanyActorResponse({ companyKey: "k2", items: [FIXTURE_COMPLETE], observedAt: NOW });
  assertEquals(good.outcome, "enriched");
  assert(!!good.bundle);
});

Deno.test("invalid_result when the record has no company identity", () => {
  const r = interpretCompanyActorResponse({ companyKey: "k", items: [{ website: "https://x.com" }] });
  assertEquals(r.outcome, "invalid_result");
  assertEquals(r.bundle, null);
});

Deno.test("duplicate company records collapse to one bundle per company key", () => {
  const r = interpretCompanyActorResponse({ companyKey: "k", items: FIXTURE_DUPLICATES, observedAt: NOW });
  assertEquals(r.outcome, "enriched");
  assertEquals(r.bundle!.companyKey, "k");
  assertEquals(r.bundle!.company.linkedinUrl, "https://www.linkedin.com/company/dupe");
});

// ---- (27)(28) grounded company-URL extraction from provider people ----
Deno.test("27: extract company LinkedIn URL from a documented provider field, canonicalized", () => {
  // top-level field
  assertEquals(
    extractProviderCompanyLinkedInUrl({ companyLinkedinUrl: "https://www.linkedin.com/company/acme-saas/?trk=x" }),
    "https://www.linkedin.com/company/acme-saas",
  );
  // nested currentPosition[0].company object
  assertEquals(
    extractProviderCompanyLinkedInUrl({ currentPosition: [{ company: { linkedinUrl: "https://linkedin.com/company/nested-co" } }] }),
    "https://www.linkedin.com/company/nested-co",
  );
});

Deno.test("28: never invent/derive a URL; a person /in/ URL is rejected; absent ⇒ null (name fallback)", () => {
  // A person profile URL in a company field is REJECTED (never mis-mapped).
  assertEquals(extractProviderCompanyLinkedInUrl({ companyLinkedinUrl: "https://www.linkedin.com/in/some-person" }), null);
  // No provider-backed URL at all ⇒ null ⇒ caller keeps the company-name search fallback.
  assertEquals(extractProviderCompanyLinkedInUrl({ company: "Acme SaaS", currentPosition: [{ companyName: "Acme SaaS" }] }), null);
  assertEquals(extractProviderCompanyLinkedInUrl(null), null);
  // And the input builder prefers the URL (companies) over name (searches) when present.
  const withUrl = buildCompanyEnrichmentInput([{ companyKey: "k1", companyLinkedInUrl: "https://www.linkedin.com/company/acme-saas", companyName: "Acme SaaS" }], B);
  assertEquals(withUrl.input.companies, ["https://www.linkedin.com/company/acme-saas"]);
  assertEquals(withUrl.input.searches, undefined);
  const noUrl = buildCompanyEnrichmentInput([{ companyKey: "k2", companyLinkedInUrl: null, companyName: "Acme SaaS" }], B);
  assertEquals(noUrl.input.searches, ["Acme SaaS"]);
  assertEquals(noUrl.input.companies, undefined);
});
