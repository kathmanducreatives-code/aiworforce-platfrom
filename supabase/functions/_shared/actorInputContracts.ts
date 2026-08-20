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
  /**
   * WHAT THIS FIELD IS FOR — the part a type cannot express.
   *
   * Knowing that `industries` is an array of enum values does not tell you that
   * the enum has no technology axis, so "AI" cannot be said there no matter how
   * well-formed the array is. Run df00b2cd asked for AI startups, sent
   * `industries: ["B2B", "Engineering, Product and Design"]` — legal, accepted,
   * 100 rows — and not one row was an AI startup. A schema-valid input can
   * still be the wrong question, and only prose can say which field asks the
   * right one.
   */
  note?: string;
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
  /**
   * A COMPLETE, known-good input — not a minimal one.
   *
   * The planner imitates this. Run df00b2cd emitted
   * `{mode, regions, isHiring, scrapeOpenJobs, maxItems}` for a mission about
   * AI startups, which was character-for-character the example this file
   * carried, down to the omissions. An example that leaves out the fields that
   * decide relevance teaches the planner to leave them out too, so these show
   * every field a real mission needs — topic, geography, signal and bounds.
   */
  example: Record<string, unknown>;
  /**
   * How to aim this actor at a mission, in the actor's own terms.
   *
   * Field-level notes say what one field means; these say which field to reach
   * for given what the mission asks. That is the judgement the planner is
   * making, and it was making it blind.
   */
  selection_notes?: readonly string[];
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
        { name: "queries", type: "array", default: [],
          note: "FREE-TEXT ALGOLIA SEARCH over the directory — product category, market, TECHNOLOGY, location. This is the ONLY field that can express a technology or topic such as AI, robotics, fintech infrastructure or developer tools; none of them exists in the `industries` enum. Each keyword runs as its own search and results are merged and deduped by company id, so 2-3 phrasings widen recall without duplicating rows. If the mission names a technology, a product space or a market, it belongs here." },
        { name: "topCompany", type: "boolean", default: false,
          note: "YC's own 'Top Company' badge. Skews hard toward large, long-graduated companies; almost never what a startup-cohort mission wants." },
        { name: "isHiring", type: "boolean", default: false,
          note: "Restricts to companies YC currently marks as hiring. Pair with scrapeOpenJobs to get the roles themselves, otherwise you have the claim without the evidence." },
        { name: "nonprofit", type: "boolean", default: false },
        { name: "batch", type: "array", default: ["All Batches"],
          note: "Cohort filter. Values are full names — 'Winter 2026', 'Spring 2026' — NOT the short codes W26/S26 that solidcode uses. Narrowing to recent batches is the reliable way to get genuinely early-stage companies, because team size alone does not separate a new startup from a shrunken old one." },
        { name: "industries", type: "array", default: ["All industries"],
          note: "A CLOSED 11-VALUE TAXONOMY of YC's broad verticals, and there is NO technology axis in it — no AI, no ML, no SaaS, no developer tools. The full list is the enum on this field and nothing outside it is accepted. Do not reach for 'B2B' or 'Engineering, Product and Design' as a stand-in for a technology: on run df00b2cd that returned 100 legal rows of which none was an AI company. Use `queries` for the topic and leave this unset unless the mission genuinely names one of these verticals." },
        { name: "regions", type: "array", default: ["Anywhere"],
          note: "HQ region. 'United States of America' is the US value — not 'USA', not 'United States'." },
        { name: "minEmployeeSize", type: "string", enum: ["1+", "5+", "10+", "25+", "50+", "100+", "250+", "500+", "1000+"], default: "1+" ,
          note: "STRING ENUM, not a number. The newest YC batches are full of 0-2 person shells with no website, no description and nothing to qualify on; '5+' or '10+' removes them cheaply. Note the '+' suffix here — the max enum does not use it." },
        { name: "maxEmployeeSize", type: "string", enum: ["1+", "5", "10", "25", "50", "100", "250", "500", "1000+"], default: "1000+",
          note: "STRING ENUM, not a number — 150 is refused, '250' is not. DEFAULTS TO NO CEILING, so leaving it unset returns Deel (5,000), Flexport (3,000) and Rippling (2,500) alongside the startups. SET THIS whenever the mission or the workspace states a size ceiling: pick the smallest enum value at or above the real bound and let the exact figure be enforced later from enriched headcount. For a ceiling of 150 that is '250' — choosing '100' would silently drop every 100-150 company." },
        { name: "scrapeFounderDetails", type: "boolean", default: false,
          note: "Adds an HTTP request per company (concurrency 5) and slows the run noticeably. Only worth it when the mission actually needs founders." },
        { name: "scrapeOpenJobs", type: "boolean", default: false,
          note: "Adds an HTTP request per company and slows the run, but it is what turns 'YC says hiring' into named roles with titles and URLs. Any mission requiring hiring EVIDENCE needs this on, or downstream has nothing to verify against." },
        { name: "enrichEmails", type: "boolean", default: false },
        { name: "maxItems", type: "integer", default: 100,
          note: "PER-URL / per-filter-run cap, not a total. Free-tier accounts are capped at 100 regardless of what is set here." },
        { name: "monitoringMode", type: "boolean", default: false },
        { name: "maxConcurrency", type: "integer", default: 10 },
        { name: "minConcurrency", type: "integer", default: 1 },
        { name: "maxRequestRetries", type: "integer", default: 3 },
        { name: "proxy", type: "object", default: {"useApifyProxy": true} },
      ],
      // A COMPLETE input for a real mission \u2014 "AI startups in the US that are
      // hiring, under 150 people". Every field that decides relevance is
      // present: the topic in `queries`, the geography, the signal, and BOTH
      // size bounds. The previous example stopped at
      // `{mode, regions, isHiring, scrapeOpenJobs, maxItems}` and run df00b2cd
      // reproduced it exactly, omissions included.
      //
      // `industries` is deliberately ABSENT. The mission's subject is a
      // technology, and a technology cannot be said in that enum.
      example: {
        mode: "companies",
        queries: ["artificial intelligence", "AI agents"],
        regions: ["United States of America"],
        isHiring: true,
        scrapeOpenJobs: true,
        minEmployeeSize: "5+",
        maxEmployeeSize: "250",
        maxItems: 100,
      },
      selection_notes: [
        "TOPIC GOES IN `queries`, NEVER IN `industries`. `industries` is a closed list of 11 broad verticals with no technology axis; `queries` is a free-text search. A mission naming AI, robotics, devtools, climate or any other technology is unanswerable through `industries`, and substituting a vertical returns rows that are legal and irrelevant.",
        "SET `maxEmployeeSize` WHENEVER A CEILING EXISTS. It defaults to no ceiling, and the unfiltered directory is led by YC's largest graduates. Round UP to the nearest enum value and let enrichment enforce the exact bound.",
        "THIS ACTOR RETURNS TWO POPULATIONS. Unfiltered, the directory skews to famous multi-thousand-person graduates from 2011-2019 at one end and 1-4 person companies from the newest batch at the other. Size bounds, `batch`, or both are what get you the middle \u2014 the funded, staffed, genuinely hiring startups most missions mean.",
        "`tags` IS NOT A FILTER AND IS OFTEN EMPTY. Rows carry a `tags` array that includes things like 'Artificial Intelligence', but it cannot be filtered on, and on the newest batches it is frequently empty \u2014 so it is unreliable as post-hoc proof of topic. Ask the right question via `queries` rather than over-fetching and filtering after.",
      ],
      quality: { total_runs: 993, monthly_users: 35, success_rate_pct: 97.7, rating: 4.62,
        note: "NICHE (993 runs, 35 monthly users). Serves a specific cohort well but has far less real-world exposure than the LinkedIn actors \u2014 treat an unexpected empty result as a plausible filter problem rather than proof the cohort is empty." },
    },
    apify_yc_companies_solidcode: {
      verified_at: "2026-08-20",
      fields: [
        { name: "startUrls", type: "array", default: [] },
        { name: "searchQuery", type: "string",
          note: "FREE-TEXT search across the YC directory — this actor's equivalent of memo23's `queries`, but a SINGLE STRING rather than an array. Same rule: a technology or topic such as AI belongs here, because the `industries` enum has no technology axis." },
        { name: "batches", type: "array",
          enum: ["F25", "S25", "W25", "F24", "S24", "W24", "S23", "W23", "S22", "W22", "S21", "W21", "S20", "W20", "S19", "W19", "S18", "W18", "S17", "W17", "S16", "W16", "S15", "W15", "S14", "W14", "S13", "W13", "S12", "W12", "S11", "W11", "S10", "W10", "S09", "W09", "S08", "W08", "S07", "W07", "S06", "W06", "S05", "IK12"],
          default: [],
          note: "SHORT CODES — 'W25', 'S24' — NOT the full names memo23 uses ('Winter 2025'). Copying a batch value between the two YC actors will be refused. Note the latest cohort here is F25, so this actor cannot reach the 2026 batches memo23 returns." },
        { name: "status", type: "array", enum: ["Active", "Public", "Acquired", "Inactive"], default: [],
          note: "ARRAY of enum values. Sending the bare string \"Active\" was refused three times in production with apify_input_schema_error." },
        { name: "regions", type: "array",
          enum: ["United States of America", "Canada", "Latin America", "Europe", "United Kingdom", "Asia", "India", "Africa", "Middle East", "Oceania", "Remote"],
          default: [],
          note: "No 'Anywhere' value here — memo23 has one, this actor does not. Leave the array EMPTY for no region filter." },
        { name: "industries", type: "array",
          enum: ["B2B", "Consumer", "Education", "Fintech", "Government", "Healthcare", "Industrials", "Real Estate and Construction"],
          default: [],
          note: "EIGHT values, and the list DIFFERS from memo23's — there is no 'Engineering, Product and Design' and no 'Unspecified' here, so a value copied across actors can be refused. As with memo23 there is no technology axis; use `searchQuery` for a topic." },
        { name: "teamSize", type: "array", enum: ["1", "2-10", "11-50", "51-200", "201-500", "500+"], default: [],
          note: "RANGE STRINGS in an array — not the min/max enum pair memo23 uses. Select every band that overlaps the mission's bound: a ceiling of 150 means ['2-10','11-50','51-200'], because 51-200 straddles it and omitting it drops every 51-150 company." },
        { name: "isHiring", type: "boolean", default: false,
          note: "Stricter than memo23's: this actor re-checks that a role is genuinely advertised and keeps paging past companies whose YC hiring label is stale, so you are not charged for them." },
        { name: "includeFounders", type: "boolean", default: true,
          note: "Defaults ON here (memo23's founder toggle defaults off). YC publishes no founder emails, so `email` is always null however this is set." },
        { name: "includeJobs", type: "boolean", default: false,
          note: "Needed whenever the mission requires hiring EVIDENCE rather than a hiring flag." },
        { name: "maxResults", type: "integer", default: 100,
          note: "Total row cap, not per-URL — the opposite of memo23's `maxItems`. 0 means no cap." },
      ],
      example: {
        searchQuery: "artificial intelligence",
        status: ["Active"],
        regions: ["United States of America"],
        teamSize: ["2-10", "11-50", "51-200"],
        isHiring: true,
        includeJobs: true,
        maxResults: 100,
      },
      selection_notes: [
        "ITS FILTER VOCABULARY IS NOT memo23's. Free text is `searchQuery` (a string) not `queries` (an array); batches are short codes not full names; size is an array of range bands not a min/max enum pair; the row cap is `maxResults` not `maxItems`. Inputs copied from the sibling YC actor are refused.",
        "TOPIC GOES IN `searchQuery`. The `industries` enum is eight broad verticals with no technology axis, exactly as on memo23.",
        "IT CANNOT REACH THE NEWEST BATCHES. `batches` stops at F25, so for a mission wanting the very latest cohort memo23 is the only YC option.",
      ],
      quality: { total_runs: 278, monthly_users: 2, success_rate_pct: null, rating: null,
        note: "VERY LOW TRAFFIC (278 runs, 2 monthly users). Barely exercised and correspondingly more likely to reject an input or drift from its documented shape. Prefer an alternative where one exists." },
    },
  });
