// PROVIDER CAPABILITY CONTRACTS — what each provider can do for a lead mission, in ONE shape
// (MRLE Phase 2 groundwork; audit 2026-11-07 J: four registries describe providers today).
//
// A card says what a capability DOES (action), what it can PROVE and how strongly, what it
// costs and in which unit, whether it is AVAILABLE under the workspace's provider policy, and
// what AUTHORIZATION it needs. The planner selects by capability, never by provider name, so
// adding a provider is adding cards (and an adapter) — the interpreter is untouched.
//
// Deliberately small: the executable pilot capabilities stay in leadPipeline/strategy.ts
// (DISCOVERY_CAPABILITIES) and are mirrored here by id; the other providers' cards record
// DOCUMENTED capability (LeadOcean: api.leadocean.io/openapi.json + leadocean.io/docs, read
// 2026-11-07) separately from what Agentory has VERIFIED in its own integration.
// Pure.

export type CapabilityKind =
  | "company_discovery" | "people_discovery" | "hiring_signal" | "business_model_verification"
  | "website_research" | "funding_research" | "company_enrichment" | "contact_enrichment";

// A retired provider has no card (see the retirement guard in tests/edge-functions/_shared).
export type ProviderName = "apify" | "leadocean" | "firecrawl";
export type Strength = "verified" | "claim" | "inference" | "hint";

export interface CapabilityCard {
  id: string;
  provider: ProviderName;
  kind: CapabilityKind;
  /** What the step returns. */
  outputs: string[];
  /** What it can establish, and how strongly (a claim never qualifies a lead on its own). */
  proves: { dimension: string; strength: Strength }[];
  /** Filters the provider applies itself (narrowing only, never proof). */
  filters: string[];
  cost: { unit: "usd" | "record" | "credit" | "call"; perItem: number | null; perCall: number | null; note: string };
  limits: string[];
  /** documented = the provider says so; verified = Agentory observed it in its own integration. */
  basis: "documented" | "verified";
  authorization: "owner_approval" | "explicit_contact_authorization";
  /** The pilot's executable capability id (strategy.ts), when one exists. */
  executableAs: string | null;
}

/** Which providers a workspace may spend on, and on what. TEST today: Apify only, $0.25, 0 records. */
export interface ProviderPolicy {
  allowedProviders: ProviderName[];
  maxApifyUsd: number;
  maxLeadoceanRecords: number;
  contactEnrichment: boolean;
}
export const TEST_PILOT_POLICY: ProviderPolicy = Object.freeze({ allowedProviders: ["apify"], maxApifyUsd: 0.25, maxLeadoceanRecords: 0, contactEnrichment: false }) as ProviderPolicy;

export const CAPABILITY_CARDS: readonly CapabilityCard[] = Object.freeze([
  { id: "apify.linkedin_job_search", provider: "apify", kind: "hiring_signal", outputs: ["employers with dated open roles"],
    proves: [{ dimension: "hiring", strength: "verified" }, { dimension: "identity", strength: "verified" }], filters: ["job_title", "geography", "posted_window"],
    cost: { unit: "usd", perItem: 0.001, perCall: 0.001, note: "per posting + start" }, limits: ["≤3 titles, ≤2 locations per run", "titles fuzzy: post-filtered"], basis: "verified", authorization: "owner_approval", executableAs: "apify.linkedin_job_search" },
  { id: "apify.linkedin_company_record", provider: "apify", kind: "company_enrichment", outputs: ["HQ-flagged location", "declared size band", "website", "description"],
    proves: [{ dimension: "headquarters", strength: "verified" }, { dimension: "size_band", strength: "verified" }], filters: [],
    cost: { unit: "usd", perItem: 0.004, perCall: 0.00005, note: "per company record" }, limits: ["self-declared on LinkedIn"], basis: "verified", authorization: "owner_approval", executableAs: "apify.linkedin_company_record" },
  { id: "apify.website_business_model", provider: "apify", kind: "business_model_verification", outputs: ["≤3 first-party pages per company", "grounded business-model claim"],
    proves: [{ dimension: "business_model", strength: "verified" }], filters: [],
    cost: { unit: "usd", perItem: null, perCall: 0.01334, note: "compute-bounded (1 GB × 120 s) at an ASSUMED $0.40/CU — unmeasured" }, limits: ["a first-party statement is marketing text: inference with quotes"], basis: "documented", authorization: "owner_approval", executableAs: "apify.website_business_model" },
  { id: "leadocean.company_search", provider: "leadocean", kind: "company_discovery", outputs: ["company records (company_data, company_metrics)"],
    proves: [{ dimension: "headquarters", strength: "claim" }, { dimension: "size_band", strength: "claim" }, { dimension: "industry", strength: "claim" }, { dimension: "funding", strength: "claim" }],
    filters: ["industry (534 labels)", "employeeRange / min-maxEmployees", "hqCountry / hqState / hqCity", "fundingType / min-maxLastFundingYear", "technologies", "naics / sic", "keywords", "domain", "linkedin"],
    cost: { unit: "record", perItem: 1, perCall: 0, note: "1 record per row returned; count calls free" }, limits: ["no B2B / business-model filter", "no hiring filter", "HQ wrong for ~29% (Agentory benchmark)", "Free plan: 1,000 records lifetime, 402 after"], basis: "documented", authorization: "owner_approval", executableAs: null },
  { id: "leadocean.people_search", provider: "leadocean", kind: "people_discovery", outputs: ["people (thin rows, no contact points)"],
    proves: [{ dimension: "current_employment", strength: "claim" }], filters: ["title / excludeTitle", "seniority", "jobFunction", "country", "domain / companyLinkedin", "employer filters (≤50,000 matching companies)"],
    cost: { unit: "record", perItem: 1, perCall: 0, note: "1 record per row returned" }, limits: ["seniority over-matches (investors, developer co-founders)"], basis: "verified", authorization: "owner_approval", executableAs: "leadocean.people_by_domain" },
  { id: "leadocean.contact_enrich", provider: "leadocean", kind: "contact_enrichment", outputs: ["work email / phone"],
    proves: [], filters: [], cost: { unit: "record", perItem: 1, perCall: null, note: "1 record per call (cost of a no-match is contradictory in LeadOcean's own docs)" },
    limits: ["requires the enrich key scope", "never automatic"], basis: "documented", authorization: "explicit_contact_authorization", executableAs: null },
  { id: "firecrawl.scrape", provider: "firecrawl", kind: "website_research", outputs: ["page text (markdown)"],
    proves: [{ dimension: "business_model", strength: "inference" }], filters: [],
    cost: { unit: "credit", perItem: 1, perCall: null, note: "1 credit per page that produced a document" }, limits: ["used by the production engine's web evidence; not on the pilot's Apify-only policy"], basis: "verified", authorization: "owner_approval", executableAs: null },
  { id: "apify.funding_corroboration", provider: "apify", kind: "funding_research", outputs: ["funding rounds with dates and source URLs (two providers)"],
    proves: [{ dimension: "funding", strength: "verified" }], filters: [],
    cost: { unit: "usd", perItem: 0.0035, perCall: null, note: "per company lookup" }, limits: ["~4 weeks stale", "production engine only; not wired into the pilot"], basis: "verified", authorization: "owner_approval", executableAs: null },
]);

/**
 * The cards a mission may use for a kind under a policy: the provider must be allowed, and
 * contact enrichment needs its own explicit authorization. Order: verified evidence first.
 */
export function capabilitiesFor(kind: CapabilityKind, policy: ProviderPolicy): CapabilityCard[] {
  const rank: Record<Strength, number> = { verified: 0, claim: 1, inference: 2, hint: 3 };
  return CAPABILITY_CARDS
    .filter((c) => c.kind === kind && policy.allowedProviders.includes(c.provider))
    .filter((c) => c.authorization !== "explicit_contact_authorization" || policy.contactEnrichment)
    .filter((c) => c.provider !== "leadocean" || policy.maxLeadoceanRecords > 0)
    .sort((a, b) => Math.min(...a.proves.map((p) => rank[p.strength]), 9) - Math.min(...b.proves.map((p) => rank[p.strength]), 9));
}
