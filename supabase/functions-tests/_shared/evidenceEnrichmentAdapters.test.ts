import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  planStructuredCompanyEnrichment, structuredCompanyEvidenceToItems,
  planTargetedFirecrawl, selectFirecrawlPages, planSignalEnrichment,
} from "../../functions/_shared/evidenceEnrichmentAdapters.ts";
import { DEFAULT_EVIDENCE_BUDGET } from "../../functions/_shared/conditionalEnrichmentPlanner.ts";
import { getActorCapability } from "../../functions/_shared/actorCapabilityRegistry.ts";
import { satisfiedCategories, appendEvidence, type CandidateEnvelope } from "../../functions/_shared/candidateEnvelope.ts";

const B = DEFAULT_EVIDENCE_BUDGET;

// ---- Phase 2: structured company enrichment (VERIFIED binding: harvestapi/linkedin-company) ----
Deno.test("Phase 2: structured enrichment is READY on the verified binding (real actor id)", () => {
  const p = planStructuredCompanyEnrichment({
    companyKey: "dom:acme.com", companyName: "Acme SaaS", officialDomain: "acme.com",
    requiredEvidence: ["company_website", "company_industry"], budget: B,
  });
  assertEquals(p.status, "ready");
  assertEquals(p.actorKey, "apify_linkedin_company_details");
  assertEquals(p.actorId, "harvestapi/linkedin-company");   // canonical, never invented
  assertEquals(p.estimatedCostClass, "low");
});

Deno.test("Phase 2: an UNVERIFIED capability still refuses to emit a call plan", () => {
  const unverified = { ...getActorCapability("apify_linkedin_company_details")!, verifiedBinding: false, implementationId: undefined, missingBindingNote: "no binding" };
  const p = planStructuredCompanyEnrichment({
    companyKey: "dom:acme.com", requiredEvidence: ["company_website"], budget: B, actorCapability: unverified as any,
  });
  assertEquals(p.status, "blocked_no_binding");
  assertEquals(p.actorId, undefined);
  assertEquals(p.estimatedCostClass, "none");
});

Deno.test("Phase 2: no firmographic gap ⇒ not_needed (never calls)", () => {
  const p = planStructuredCompanyEnrichment({ companyKey: "dom:acme.com", requiredEvidence: [], budget: B });
  assertEquals(p.status, "not_needed");
});

Deno.test("Phase 2: request prefers the LinkedIn company URL identifier", () => {
  const fake = { ...getActorCapability("apify_linkedin_company_details")! };
  const p = planStructuredCompanyEnrichment({
    companyKey: "li:linkedin.com/company/acme", companyLinkedInUrl: "https://www.linkedin.com/company/acme",
    requiredEvidence: ["company_website", "company_industry", "company_size"], budget: B, actorCapability: fake,
  });
  assertEquals(p.status, "ready");
  assertEquals(p.actorId, "harvestapi/linkedin-company");
  assertEquals((p.request as any).maxItems, 1);
  assertEquals((p.request as any).companyLinkedInUrl, "https://www.linkedin.com/company/acme");
});

Deno.test("Phase 2: adapter output maps to append-only verified evidence items", () => {
  const items = structuredCompanyEvidenceToItems({
    companyKey: "dom:acme.com",
    website: { value: "https://acme.com", confidence: "high" },
    industry: { value: "B2B SaaS", confidence: "high" },
    employeeCount: { value: 42, confidence: "medium" },
    headquarters: { value: "Austin, Texas, United States", confidence: "medium" },
    companyLinkedInUrl: { value: "https://www.linkedin.com/company/acme", confidence: "high" },
    observedAt: "2026-07-16T06:00:00.000Z",
    sourceProvenance: { provider: "apify", actorKey: "apify_linkedin_company_details", actorId: "harvestapi/linkedin-company", verified: true },
  });
  const cats = items.map((i) => i.category).sort();
  assertEquals(cats, ["company_geography", "company_identity", "company_industry", "company_size", "company_website"]);
  for (const i of items) { assertEquals(i.verified, true); assertEquals(i.sourceType, "apify_actor"); }

  // (10) structured enrichment fills the gaps ⇒ Firecrawl not needed afterwards.
  const env: CandidateEnvelope = {
    candidateId: "c1", targetEntity: "person", primaryArtifactType: "person_candidate", evidence: [],
    sourceProvenance: { provider: "apify", actorKey: "apify_people_search", actorId: "harvestapi/linkedin-profile-search", verified: true },
  };
  const after = appendEvidence(env, items);
  const sat = satisfiedCategories(after);
  assert(sat.has("company_website") && sat.has("company_industry") && sat.has("company_size"));
});

// ---- Phase 3: targeted Firecrawl ----
Deno.test("Phase 3/13: Firecrawl is capped at 3 pages and never full-site", () => {
  const p = planTargetedFirecrawl({
    companyKey: "dom:acme.com", officialDomain: "acme.com",
    requiredEvidence: ["company_business_model", "job_signal"], budget: B, firecrawlCompaniesUsed: 0,
  });
  assertEquals(p.status, "ready");
  assert((p.pages?.length ?? 0) <= B.firecrawlPagesPerCompany);
  assertEquals((p.request as any).fullSiteCrawl, false);
  assertEquals((p.request as any).maxPages, p.pages!.length);
});

Deno.test("Phase 3: page selection targets only what is missing", () => {
  assertEquals(selectFirecrawlPages(["company_business_model"], 3).map((p) => p.purpose), ["homepage", "product_about"]);
  assertEquals(selectFirecrawlPages(["job_signal"], 3).map((p) => p.purpose), ["homepage", "careers"]);
  assertEquals(selectFirecrawlPages(["launch_signal"], 3).map((p) => p.purpose), ["homepage", "press_news"]);
  assertEquals(selectFirecrawlPages(["company_business_model", "job_signal"], 2).length, 2); // hard cap
});

Deno.test("Phase 3/12: no web gap ⇒ Firecrawl not_needed; budget exhaustion blocks", () => {
  assertEquals(planTargetedFirecrawl({ companyKey: "k", officialDomain: "acme.com", requiredEvidence: [], budget: B, firecrawlCompaniesUsed: 0 }).status, "not_needed");
  const blocked = planTargetedFirecrawl({ companyKey: "k", officialDomain: "acme.com", requiredEvidence: ["company_business_model"], budget: B, firecrawlCompaniesUsed: B.firecrawlCompanies });
  assertEquals(blocked.status, "blocked_budget");
  const noDomain = planTargetedFirecrawl({ companyKey: "k", officialDomain: null, requiredEvidence: ["company_business_model"], budget: B, firecrawlCompaniesUsed: 0 });
  assertEquals(noDomain.status, "blocked_no_binding");
});

// ---- Phase 4: signal enrichment ----
Deno.test("Phase 4: prefers a VERIFIED structured signal source over Firecrawl", () => {
  // founder_activity_signal is produced by apify_linkedin_profile_posts (verified).
  const p = planSignalEnrichment({ missingTiming: ["founder_activity_signal"], targetEntity: "person", budget: B });
  assertEquals(p.status, "ready");
  assertEquals(p.selectedSource, "apify_linkedin_profile_posts");
  assertEquals(p.selectedActorId, "harvestapi/linkedin-profile-posts");
  assertEquals(p.signalCategory, "founder_activity");
  assertEquals(p.reason, "verified_structured_signal_source_preferred");
  assert(!!p.stopCondition);
});

Deno.test("Phase 4: hiring signal for a company routes to the verified jobs actor", () => {
  const p = planSignalEnrichment({ missingTiming: ["job_signal"], targetEntity: "company", budget: B });
  assertEquals(p.status, "ready");
  assertEquals(p.selectedSource, "apify_jobs");
  assertEquals(p.selectedActorId, "curious_coder/linkedin-jobs-scraper");
  assertEquals(p.signalCategory, "hiring");
});

Deno.test("Phase 4: falls back to Firecrawl only when no structured source exists", () => {
  // funding_signal has no verified structured producer in this repo.
  const p = planSignalEnrichment({ missingTiming: ["funding_signal"], targetEntity: "person", budget: B, firecrawlCompaniesUsed: 0 });
  assertEquals(p.selectedSource, "firecrawl_scrape_url");
  assertEquals(p.reason, "no_structured_source_official_confirmation_required");
  assertEquals(p.signalCategory, "funding");
});

Deno.test("Phase 4: no timing gap ⇒ not_needed; exhausted budget blocks honestly", () => {
  assertEquals(planSignalEnrichment({ missingTiming: [], targetEntity: "person", budget: B }).status, "not_needed");
  const blocked = planSignalEnrichment({ missingTiming: ["funding_signal"], targetEntity: "person", budget: B, firecrawlCompaniesUsed: B.firecrawlCompanies });
  assertEquals(blocked.status, "blocked_budget");
  assertEquals(blocked.selectedSource, null);
});

// ---- (35) planner diagnostics are sanitized ----
Deno.test("35: adapter plans expose no secrets/tokens/raw payloads", () => {
  const plans = [
    planStructuredCompanyEnrichment({ companyKey: "dom:acme.com", requiredEvidence: ["company_website"], budget: B }),
    planTargetedFirecrawl({ companyKey: "dom:acme.com", officialDomain: "acme.com", requiredEvidence: ["company_business_model"], budget: B, firecrawlCompaniesUsed: 0 }),
  ];
  const json = JSON.stringify(plans);
  assert(!/authorization|bearer |api[_-]?key|token=|password|eyJ[A-Za-z0-9]{8}|sk_live_/i.test(json), json);
  assert(!/"raw"|"profile"\s*:/.test(json));
});
