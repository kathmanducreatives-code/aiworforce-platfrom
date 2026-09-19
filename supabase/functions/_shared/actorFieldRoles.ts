// LEAD V2 P2 — WHAT EACH ACTOR INPUT FIELD IS FOR.
//
// The ProviderCallSpec compiler has to know, per field, whether a change is a
// semantic rewrite (queries, titles, locations, company size, max items, mode,
// exclusions) or an operational detail (proxy, concurrency). This table is that
// knowledge, read from the live input contracts in `actorInputContracts.ts` for
// every actor the lead path can reach. A field not listed is operational.
//
// `p2ProviderCallSpec.test.ts` asserts every contract field of every lead actor
// has a role here, so a newly carded field cannot slip in unclassified.
//
// Pure.

export type FieldRole =
  | "query"          // what is searched: queries, searchQuery, titles, keywords, signal switches
  | "geography"      // where the company (or the search) is
  | "industry"
  | "company_size"
  | "company_stage"
  | "count"          // maxItems and equivalents — the cost multiplier
  | "mode"           // scraper / profile modes (row shape and price)
  | "binding"        // the companies a per-candidate call is about
  | "exclusion"
  | "policy"         // switches the platform owns (people data, email enrichment)
  | "page"           // pagination
  | "operational"    // transport details
  | "forbidden";     // credentials / external data sinks — never sent, whoever proposes them

/** Roles a downstream layer may never change without a recorded reason. */
export const PROTECTED_ROLES: ReadonlySet<FieldRole> = new Set<FieldRole>([
  "query", "geography", "industry", "company_size", "company_stage", "count", "mode", "exclusion",
]);

/** Filter roles that must be backed by a HARD criterion. */
export const CRITERIA_FILTER_ROLES: ReadonlySet<FieldRole> = new Set<FieldRole>([
  "geography", "industry", "company_size", "company_stage", "exclusion",
]);

export const FIELD_ROLES: Readonly<Record<string, Readonly<Record<string, FieldRole>>>> = Object.freeze({
  apify_yc_companies_memo23: {
    startUrls: "binding", mode: "mode", role: "query", location: "geography", queries: "query",
    topCompany: "query", isHiring: "query", nonprofit: "query", batch: "company_stage",
    industries: "industry", regions: "geography", minEmployeeSize: "company_size",
    maxEmployeeSize: "company_size", scrapeFounderDetails: "policy", scrapeOpenJobs: "policy",
    enrichEmails: "policy", maxItems: "count", monitoringMode: "operational",
    maxConcurrency: "operational", minConcurrency: "operational", maxRequestRetries: "operational",
    proxy: "operational",
  },
  apify_yc_companies_solidcode: {
    startUrls: "binding", searchQuery: "query", batches: "company_stage", status: "query",
    regions: "geography", industries: "industry", teamSize: "company_size", isHiring: "query",
    includeFounders: "policy", includeJobs: "policy", maxResults: "count",
  },
  apify_linkedin_company_search: {
    scraperMode: "mode", maxItems: "count", searchQuery: "query", locations: "geography",
    industryIds: "industry", companySize: "company_size", startPage: "page", takePages: "page",
  },
  apify_linkedin_company_details: { companies: "binding", searches: "binding" },
  apify_linkedin_job_search: {
    jobTitles: "query", locations: "geography", maxItems: "count", company: "binding",
    workplaceType: "query", employmentType: "query", experienceLevel: "query", salary: "query",
    under10Applicants: "query", easyApply: "query", postedLimit: "query", industryIds: "industry",
    sortBy: "operational", geoIds: "geography", page: "page", cookie: "forbidden",
    userAgent: "operational", proxy: "operational",
  },
  apify_funding_rounds_datahyena: {
    since: "query", round: "company_stage", verticals: "industry", countries: "geography",
    industryGroups: "industry", naicsCode: "industry",
    employeeBuckets: "company_size", minAmountUsd: "query", maxAmountUsd: "query", maxItems: "count",
    // Narrows to rounds whose company the provider resolved. It changes the
    // provider's own completeness bar, not what the mission asked for.
    enrichedOnly: "operational",
    cursor: "page",
  },
  apify_google_news: {
    keywords: "query", topics: "query", topicUrls: "query", maxArticles: "count", timeframe: "query",
    region_language: "operational", decodeUrls: "operational", extractDescriptions: "operational",
    extractImages: "operational",
  },
  apify_linkedin_company_employees: {
    profileScraperMode: "mode", maxItems: "count", companies: "binding", locations: "geography",
    searchQuery: "query", jobTitles: "query", pastJobTitles: "query", schools: "query",
    industryIds: "industry", yearsAtCurrentCompanyIds: "query", yearsOfExperienceIds: "query",
    seniorityLevelIds: "query", functionIds: "query", companyHeadcount: "company_size",
    recentlyChangedJobs: "query", companyBatchMode: "operational", maxItemsPerCompany: "count",
    startPage: "page", takePages: "page",
  },
  apify_people_search: {
    profileScraperMode: "mode", searchQuery: "query", maxItems: "count", locations: "geography",
    currentCompanies: "binding", pastCompanies: "query", schools: "query", currentJobTitles: "query",
    pastJobTitles: "query", yearsOfExperienceIds: "query", yearsAtCurrentCompanyIds: "query",
    seniorityLevelIds: "query", functionIds: "query", industryIds: "industry", firstNames: "query",
    lastNames: "query", profileLanguages: "query", companyHeadcount: "company_size",
    companyHeadquarterLocations: "geography", recentlyChangedJobs: "query",
    recentlyPostedOnLinkedIn: "query", startPage: "page", takePages: "page",
    autoQuerySegmentation: "operational", autoQuerySegmentationLevels: "operational",
    autoQuerySegmentationTargetCountries: "geography", profileDeduplicationMode: "operational",
    mongoDbConnectionString: "forbidden", mongoDbDatabaseName: "forbidden",
    postFilteringMongoDbQuery: "forbidden", postFilteringMongoDbAggregation: "forbidden",
  },
});

export function roleOf(actorKey: string, field: string): FieldRole {
  const r = FIELD_ROLES[actorKey]?.[field];
  if (r) return r;
  if (/^exclude|^excluded/i.test(field)) return "exclusion";
  return "operational";
}

/** The field that multiplies cost, per actor. */
export const COUNT_FIELD: Readonly<Record<string, string>> = Object.freeze({
  apify_yc_companies_memo23: "maxItems",
  apify_yc_companies_solidcode: "maxResults",
  apify_linkedin_company_search: "maxItems",
  apify_linkedin_job_search: "maxItems",
  apify_funding_rounds_datahyena: "maxItems",
  apify_google_news: "maxArticles",
  apify_linkedin_company_employees: "maxItems",
  apify_people_search: "maxItems",
});

/**
 * The field a HARD geography fills when the proposal omitted it, for calls
 * whose geography is the company's. Evidence searches (job postings, news) are
 * not listed: a job's location is not the employer's.
 */
export const PRIMARY_GEOGRAPHY_FIELD: Readonly<Record<string, string>> = Object.freeze({
  apify_yc_companies_memo23: "regions",
  apify_linkedin_company_search: "locations",
  apify_funding_rounds_datahyena: "countries",
  // P4: a job-discovery route a route controller adds without `locations` would
  // otherwise search every country for a US-only mission. Discovery/identity
  // purposes only (providerCallSpec), so company-scoped hiring checks are untouched.
  apify_linkedin_job_search: "locations",
});
