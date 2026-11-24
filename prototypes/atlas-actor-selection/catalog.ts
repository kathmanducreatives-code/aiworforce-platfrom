// PROTOTYPE (offline, not imported by any live code). Architecture review 2026-11-20.
//
// ONE CAPABILITY CATALOGUE, DATA NOT CODE. Today ATLAS has two Actor catalogues that never
// meet: the lead pipeline's `DISCOVERY_CAPABILITIES` + `PIPELINE_ACTORS` (strategy.ts,
// apifyInvoker.ts — 5 executable Actors) and the legacy engine's `APIFY_INTELLIGENCE`
// (apifyIntelligenceRegistry.ts — 13 Store-verified records, unused by ATLAS). This file
// shows the shape one catalogue would take: what an Actor can EVIDENCE, which of its input
// properties carry each semantic slot, how it bills, and whether it is APPROVED to run.
//
// Pricing and schemas were read on 2026-11-20 from the Apify REST API
// (GET /v2/acts/{id}, /v2/acts/{id}/builds/default) — see snapshots/.

export type Capability =
  | "discover_companies_by_hiring"     // dated open roles → employers
  | "discover_companies_by_firmographics" // query + industry + size + location → companies
  | "verify_company_record"            // HQ, size band, industry label from the company's own page
  | "verify_business_model"            // first-party website text → grounded B2B reading
  | "people_at_companies";             // decision-makers at known companies

/** The semantic inputs a plan can fill. An Actor maps a subset of them to its own properties. */
export type Slot =
  | "jobTitles" | "jobFunctions" | "locations" | "industries" | "companySize"
  | "recencyDays" | "query" | "companyUrls" | "startUrls" | "limit";

export type Approval =
  /** On the pipeline allowlist (PIPELINE_ACTORS): the execution engine may call it. */
  | "approved"
  /** Store-verified and schema-captured, NOT on the allowlist: a proposal for owner review. */
  | "catalogued";

export interface ActorEntry {
  actorId: string;
  capability: Capability;
  approval: Approval;
  /** The captured input schema (snapshots/). Inputs are validated against it, not against memory. */
  schemaFile: string;
  /** Pay-per-event prices on the account's tier (FREE/BRONZE today), or compute bounds. */
  pricing:
    | { model: "pay_per_event"; startUsd: number; perItemUsd: number }
    | { model: "compute"; memoryMb: number; timeoutS: number; usdPerComputeUnit: number };
  /** How `maxItems` is counted by THIS Actor. job-search counts it per (title × location) query. */
  limitSemantics: "total" | "per_query";
  /** Which input property carries each slot. A slot with no property is NOT filtered at source. */
  slots: Partial<Record<Slot, string>>;
  /** Constant input the engine always sends (never chosen by a model). */
  fixed?: Record<string, unknown>;
  /** What the Actor's records can establish, in the evidence engine's terms. */
  proves: string[];
}

export const CATALOG: readonly ActorEntry[] = [
  {
    actorId: "harvestapi/linkedin-job-search", capability: "discover_companies_by_hiring", approval: "approved",
    schemaFile: "harvestapi__linkedin-job-search.schema.json",
    pricing: { model: "pay_per_event", startUsd: 0.001, perItemUsd: 0.001 }, limitSemantics: "per_query",
    slots: { jobTitles: "jobTitles", jobFunctions: "functionIds", locations: "locations", industries: "industryIds", recencyDays: "postedLimit", limit: "maxItems" },
    fixed: { sortBy: "date" }, proves: ["identity", "hiring"],
  },
  {
    actorId: "harvestapi/linkedin-company-search", capability: "discover_companies_by_firmographics", approval: "catalogued",
    schemaFile: "harvestapi__linkedin-company-search.schema.json",
    // "short-company" event; "full-company" is $0.004. Short mode is enough to DISCOVER —
    // the company-record step re-reads HQ and size from the full record anyway.
    pricing: { model: "pay_per_event", startUsd: 0.001, perItemUsd: 0.002 }, limitSemantics: "total",
    slots: { query: "searchQuery", locations: "locations", industries: "industryIds", companySize: "companySize", limit: "maxItems" },
    fixed: { scraperMode: "short" }, proves: ["identity"],
  },
  {
    actorId: "harvestapi/linkedin-company", capability: "verify_company_record", approval: "approved",
    schemaFile: "harvestapi__linkedin-company.schema.json",
    pricing: { model: "pay_per_event", startUsd: 0.00005, perItemUsd: 0.004 }, limitSemantics: "total",
    slots: { companyUrls: "companies" }, proves: ["identity", "headquarters", "presence", "size_band", "industry_label"],
  },
  {
    actorId: "apify/website-content-crawler", capability: "verify_business_model", approval: "approved",
    schemaFile: "apify__website-content-crawler.schema.json",
    // Starter plan compute is $0.20/CU (docs.apify.com/account/subscriptions); the live
    // pipeline budgets $0.40 (WEBSITE_PAGES_RUN) — conservative, kept here.
    pricing: { model: "compute", memoryMb: 1024, timeoutS: 120, usdPerComputeUnit: 0.4 }, limitSemantics: "total",
    slots: { startUrls: "startUrls", limit: "maxCrawlPages" },
    // proxyConfiguration is REQUIRED by the current schema; the live pipeline omits it and
    // relies on the default. maxRequestRetries defaults to 3 inside the Actor (bounded by timeout).
    fixed: { crawlerType: "cheerio", maxCrawlDepth: 0, saveMarkdown: false, saveHtml: false, removeCookieWarnings: true, proxyConfiguration: { useApifyProxy: true } },
    proves: ["business_model"],
  },
  {
    actorId: "harvestapi/linkedin-company-employees", capability: "people_at_companies", approval: "catalogued",
    schemaFile: "", // not captured in this review: a people step needs its own authorization review first
    pricing: { model: "pay_per_event", startUsd: 0.02, perItemUsd: 0.003 }, limitSemantics: "total",
    slots: { companyUrls: "companies", jobTitles: "jobTitles", limit: "maxItems" }, proves: ["current_employment"],
  },
];

/**
 * LinkedIn industry codes (v2), from HarvestAPI/linkedin-industry-codes-v2 (read 2026-11-09).
 * A REVIEWED vocabulary map, not a guess: an industry with no entry is not filtered at the
 * source and is disclosed as such — it is never silently widened or dropped.
 */
export const LINKEDIN_INDUSTRY_IDS: Readonly<Record<string, readonly string[]>> = {
  "commercial contracting": ["48", "413", "435"],        // Construction, Nonresidential Building Construction, Specialty Trade Contractors
  "industrial distribution": ["1187", "49", "1178"],     // Wholesale Machinery, Building Materials, Hardware/Plumbing/Heating Equipment
  "commercial field services": ["122", "2247", "453"],   // Facilities Services, Commercial & Industrial Machinery Maintenance, Building Equipment Contractors
  "manufacturing": ["25", "55", "135"],                  // Manufacturing, Machinery Manufacturing, Industrial Machinery Manufacturing
};

/** LinkedIn job functions (job-search `functionIds` enum) for the role families ATLAS knows. */
export const ROLE_FAMILY_FUNCTIONS: Readonly<Record<string, readonly string[]>> = {
  gtm_sales: ["sale", "bd"],
  marketing_growth: ["mrkt"],
  engineering: ["eng", "it"],
  finance: ["fin", "acct"],
  customer_success: ["cust"],
};

/** LinkedIn location names (LinkedIn misreads short forms: "UK" → Ukraine, per the schema). */
export const LINKEDIN_LOCATIONS: Readonly<Record<string, string>> = { "United States": "United States", "Us": "United States", "Canada": "Canada", "United Kingdom": "United Kingdom" };
