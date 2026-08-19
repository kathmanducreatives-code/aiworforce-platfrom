// WHAT EACH ACTOR'S INPUT ACTUALLY LOOKS LIKE — read from the LIVE build.
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
//
// `hiringActorCatalog` told the planner which FIELD NAMES an actor accepts. It
// never said what TYPE any of them is, which values are legal, or what a
// well-formed input looks like end to end. Three production failures came
// straight out of that gap, all in one week:
//
//   2026-08-19  industries: "Engineering, Product and Design"   (string, not array)
//               -> the validator iterated the string CHARACTER BY CHARACTER and
//                  produced 31 violations reading `"E"`, `"n"`, `"g"`…
//   2026-08-19  maxEmployeeSize: 150                            (int, not enum)
//               -> refused; the legal values are "1+", "5", "10", "25"…
//   2026-08-19  status: "Active"                                (string, not array)
//               -> solidcode rejected the whole run with apify_input_schema_error,
//                  three times, and nothing told the planner why
//
// None of those is a reasoning failure. Each is a model guessing at a shape it
// was never shown.
//
// ── WHERE THIS COMES FROM, AND WHY NOT THE DOCS ──────────────────────────────
//
// Generated from `GET /v2/acts/{id}/builds/default` — the schema the actor
// actually validates against — on the date stamped below. The catalog's own
// header states the rule this obeys: the 2026-08-01 benchmark found seven
// places where documentation and runtime disagreed, and runtime won each time.
// A README is a claim; the build schema is the contract.
//
// ── AND WHY QUALITY SITS NEXT TO IT ──────────────────────────────────────────
//
// "This actor accepts these fields" and "this actor is worth pointing at your
// problem" are different questions, and the planner needs both to choose well.
// Store-wide run counts and monthly users are the cheapest honest proxy for
// maturity: an actor with 9.3M runs behaves predictably because a great many
// people have already found its edges.
//
// REGENERATE by re-reading the build schemas; do not hand-edit.
//
// PURE. No network, model or database access.

export type ActorFieldType = "string" | "integer" | "boolean" | "array" | "object";

export interface ActorInputField {
  name: string;
  type: ActorFieldType;
  /** Legal values, verbatim from the live schema. Anything else is refused. */
  enum?: readonly string[];
  /** The actor's own default when the field is omitted. */
  default?: unknown;
}

export interface ActorQuality {
  /** Runs the actor has served across the whole Apify store. */
  total_runs: number;
  /** Distinct users in the last 30 days. Maturity, not popularity. */
  monthly_users: number;
  /** Store-reported success rate, where published. */
  success_rate_pct: number | null;
  /** Store rating out of 5, where published. */
  rating: number | null;
  /** What the numbers mean for a planning decision. */
  note: string;
}

export interface ActorInputContract {
  /** The date the live build schema was read. */
  verified_at: string;
  /** Every field the live schema accepts, with its real type. */
  fields: ActorInputField[];
  /** A minimal, known-good input. Copy its SHAPE, not its values. */
  example: Record<string, unknown>;
  quality: ActorQuality;
}

export const ACTOR_INPUT_CONTRACTS: Readonly<Record<string, ActorInputContract>> =
  Object.freeze({
    apify_linkedin_company_employees: {
      verified_at: "2026-08-19",
      fields: [
        { name: "profileScraperMode", type: "string", enum: ["Short ($4 per 1k)", "Full ($8 per 1k)", "Full + email search ($12 per 1k)"], default: "Full ($8 per 1k)" },
        { name: "maxItems", type: "integer", default: 25 },
        { name: "companies", type: "array", default: ["https://www.linkedin.com/company/google"] },
        { name: "locations", type: "array" },
        { name: "searchQuery", type: "string" },
        { name: "jobTitles", type: "array" },
        { name: "pastJobTitles", type: "array" },
        { name: "schools", type: "array" },
        { name: "industryIds", type: "array" },
        { name: "yearsAtCurrentCompanyIds", type: "array" },
        { name: "yearsOfExperienceIds", type: "array" },
        { name: "seniorityLevelIds", type: "array" },
        { name: "functionIds", type: "array" },
        { name: "companyHeadcount", type: "array" },
        { name: "recentlyChangedJobs", type: "boolean" },
        { name: "companyBatchMode", type: "string", enum: ["all_at_once", "one_by_one"], default: "all_at_once" },
        { name: "maxItemsPerCompany", type: "integer" },
        { name: "startPage", type: "integer" },
        { name: "takePages", type: "integer" },
        { name: "excludeLocations", type: "array" },
        { name: "excludePastCompanies", type: "array" },
        { name: "excludeSchools", type: "array" },
        { name: "excludeCurrentJobTitles", type: "array" },
        { name: "excludePastJobTitles", type: "array" },
        { name: "excludeIndustryIds", type: "array" },
        { name: "excludeSeniorityLevelIds", type: "array" },
        { name: "excludeFunctionIds", type: "array" },
      ],
      example: { companies: ["https://www.linkedin.com/company/retell-ai"], profileScraperMode: "Short ($4 per 1k)", maxItems: 10 },
      quality: { total_runs: 4322317, monthly_users: 4526, success_rate_pct: null, rating: null,
        note: "Heavily used (4,322,317 runs, 4,526 monthly users). Mature and predictable; its edges are well explored." },
    },
    apify_linkedin_company_search: {
      verified_at: "2026-08-19",
      fields: [
        { name: "scraperMode", type: "string", enum: ["short", "full"], default: "full" },
        { name: "maxItems", type: "integer", default: 20 },
        { name: "searchQuery", type: "string" },
        { name: "locations", type: "array" },
        { name: "industryIds", type: "array" },
        { name: "companySize", type: "array" },
        { name: "startPage", type: "integer", default: 1 },
        { name: "takePages", type: "integer" },
      ],
      example: { searchQuery: "Retell AI", scraperMode: "full", maxItems: 5, locations: ["United States"] },
      quality: { total_runs: 962213, monthly_users: 1449, success_rate_pct: null, rating: null,
        note: "Widely used (962,213 runs, 1,449 monthly users). Reliable." },
    },
    apify_linkedin_company_details: {
      verified_at: "2026-08-19",
      fields: [
        { name: "companies", type: "array", default: ["https://www.linkedin.com/company/google", "https://www.linkedin.com/company/microsoft"] },
        { name: "searches", type: "array" },
      ],
      example: { companies: ["https://www.linkedin.com/company/retell-ai"] },
      quality: { total_runs: 9299972, monthly_users: 3245, success_rate_pct: null, rating: null,
        note: "Heavily used (9,299,972 runs, 3,245 monthly users). Mature and predictable; its edges are well explored." },
    },
    apify_linkedin_job_search: {
      verified_at: "2026-08-19",
      fields: [
        { name: "jobTitles", type: "array", default: ["software engineer"] },
        { name: "locations", type: "array", default: ["New York", "California"] },
        { name: "maxItems", type: "integer", default: 10 },
        { name: "company", type: "array", default: ["https://www.linkedin.com/company/google", "https://www.linkedin.com/company/microsoft", "Netflix", "Oracle Corp"] },
        { name: "workplaceType", type: "array" },
        { name: "employmentType", type: "array" },
        { name: "experienceLevel", type: "array" },
        { name: "salary", type: "array" },
        { name: "under10Applicants", type: "boolean" },
        { name: "easyApply", type: "boolean" },
        { name: "postedLimit", type: "string", enum: ["1h", "24h", "week", "month"] },
        { name: "industryIds", type: "array", default: ["4", "5", "6"] },
        { name: "sortBy", type: "string", enum: ["date", "relevance"], default: "date" },
        { name: "geoIds", type: "array" },
        { name: "page", type: "integer" },
        { name: "cookie", type: "string" },
        { name: "userAgent", type: "string" },
        { name: "proxy", type: "string" },
      ],
      example: { company: ["https://www.linkedin.com/company/retell-ai"], jobTitles: ["Software Engineer"], maxItems: 10 },
      quality: { total_runs: 1381328, monthly_users: 707, success_rate_pct: null, rating: null,
        note: "Heavily used (1,381,328 runs, 707 monthly users). Mature and predictable; its edges are well explored." },
    },
    apify_people_search: {
      verified_at: "2026-08-19",
      fields: [
        { name: "profileScraperMode", type: "string", enum: ["Short", "Full", "Full + email search"], default: "Full" },
        { name: "searchQuery", type: "string" },
        { name: "maxItems", type: "integer", default: 20 },
        { name: "locations", type: "array" },
        { name: "currentCompanies", type: "array" },
        { name: "pastCompanies", type: "array" },
        { name: "schools", type: "array" },
        { name: "currentJobTitles", type: "array" },
        { name: "pastJobTitles", type: "array" },
        { name: "yearsOfExperienceIds", type: "array" },
        { name: "yearsAtCurrentCompanyIds", type: "array" },
        { name: "seniorityLevelIds", type: "array" },
        { name: "functionIds", type: "array" },
        { name: "industryIds", type: "array" },
        { name: "firstNames", type: "array" },
        { name: "lastNames", type: "array" },
        { name: "profileLanguages", type: "array" },
        { name: "companyHeadcount", type: "array" },
        { name: "companyHeadquarterLocations", type: "array" },
        { name: "recentlyChangedJobs", type: "boolean" },
        { name: "recentlyPostedOnLinkedIn", type: "boolean" },
        { name: "excludeLocations", type: "array" },
        { name: "excludeCurrentCompanies", type: "array" },
        { name: "excludePastCompanies", type: "array" },
        { name: "excludeSchools", type: "array" },
        { name: "excludeCurrentJobTitles", type: "array" },
        { name: "excludePastJobTitles", type: "array" },
        { name: "excludeIndustryIds", type: "array" },
        { name: "excludeSeniorityLevelIds", type: "array" },
        { name: "excludeFunctionIds", type: "array" },
        { name: "excludeCompanyHeadquarterLocations", type: "array" },
        { name: "startPage", type: "integer", default: 1 },
        { name: "takePages", type: "integer" },
        { name: "autoQuerySegmentation", type: "boolean" },
        { name: "autoQuerySegmentationLevels", type: "array" },
        { name: "autoQuerySegmentationTargetCountries", type: "array" },
        { name: "profileDeduplicationMode", type: "string", enum: ["off", "insert_ids", "insert_profiles", "read_only"] },
        { name: "mongoDbConnectionString", type: "string" },
        { name: "mongoDbDatabaseName", type: "string" },
        { name: "postFilteringMongoDbQuery", type: "object" },
        { name: "postFilteringMongoDbAggregation", type: "array" },
      ],
      example: { currentCompanies: ["https://www.linkedin.com/company/retell-ai"], currentJobTitles: ["Founder"], profileScraperMode: "Short", maxItems: 5 },
      quality: { total_runs: 7090553, monthly_users: 5859, success_rate_pct: null, rating: null,
        note: "Heavily used (7,090,553 runs, 5,859 monthly users). Mature and predictable; its edges are well explored." },
    },
    apify_yc_companies_memo23: {
      verified_at: "2026-08-19",
      fields: [
        { name: "startUrls", type: "array", default: ["https://www.ycombinator.com/jobs/role/software-engineer/san-francisco", "https://www.ycombinator.com/companies?batch=Spring%202026&industry=B2B"] },
        { name: "mode", type: "string", enum: ["jobs", "companies"], default: "jobs" },
        { name: "role", type: "string", enum: ["", "software-engineer", "designer", "product-manager", "operations", "marketing", "sales-manager", "recruiting-hr", "support", "science"], default: "" },
        { name: "location", type: "string", enum: ["", "san-francisco", "new-york", "los-angeles", "seattle", "austin", "chicago", "india", "remote"], default: "" },
        { name: "queries", type: "array", default: [] },
        { name: "topCompany", type: "boolean", default: false },
        { name: "isHiring", type: "boolean", default: false },
        { name: "nonprofit", type: "boolean", default: false },
        { name: "batch", type: "array", default: ["All Batches"] },
        { name: "industries", type: "array", default: ["All industries"] },
        { name: "regions", type: "array", default: ["Anywhere"] },
        { name: "minEmployeeSize", type: "string", enum: ["1+", "5+", "10+", "25+", "50+", "100+", "250+", "500+", "1000+"], default: "1+" },
        { name: "maxEmployeeSize", type: "string", enum: ["1+", "5", "10", "25", "50", "100", "250", "500", "1000+"], default: "1000+" },
        { name: "scrapeFounderDetails", type: "boolean", default: false },
        { name: "scrapeOpenJobs", type: "boolean", default: false },
        { name: "enrichEmails", type: "boolean", default: false },
        { name: "maxItems", type: "integer", default: 100 },
        { name: "monitoringMode", type: "boolean", default: false },
        { name: "maxConcurrency", type: "integer", default: 10 },
        { name: "minConcurrency", type: "integer", default: 1 },
        { name: "maxRequestRetries", type: "integer", default: 3 },
        { name: "proxy", type: "object", default: {"useApifyProxy": true} },
      ],
      example: { mode: "companies", regions: ["United States of America"], isHiring: true, scrapeOpenJobs: true, maxItems: 100 },
      quality: { total_runs: 993, monthly_users: 35, success_rate_pct: 97.7, rating: 4.62,
        note: "NICHE (993 runs, 35 monthly users). Serves a specific cohort well but has far less real-world exposure than the LinkedIn actors \u2014 treat an unexpected empty result as a plausible filter problem rather than proof the cohort is empty." },
    },
    apify_yc_companies_solidcode: {
      verified_at: "2026-08-19",
      fields: [
        { name: "startUrls", type: "array", default: [] },
        { name: "searchQuery", type: "string" },
        { name: "batches", type: "array", default: [] },
        { name: "status", type: "array", default: [] },
        { name: "regions", type: "array", default: [] },
        { name: "industries", type: "array", default: [] },
        { name: "teamSize", type: "array", default: [] },
        { name: "isHiring", type: "boolean", default: false },
        { name: "includeFounders", type: "boolean", default: true },
        { name: "includeJobs", type: "boolean", default: false },
        { name: "maxResults", type: "integer", default: 100 },
      ],
      example: { status: ["Active"], regions: ["United States of America"], teamSize: ["11-50"], isHiring: true, maxResults: 100 },
      quality: { total_runs: 278, monthly_users: 2, success_rate_pct: null, rating: null,
        note: "VERY LOW TRAFFIC (278 runs, 2 monthly users). Barely exercised and correspondingly more likely to reject an input or drift from its documented shape. Prefer an alternative where one exists." },
    },
  });
