// VERIFIED HIRING-ACTOR CATALOG — what each Actor can and cannot be trusted for.
//
// Every value here was observed in LIVE Actor metadata, schemas or output during
// the 2026-08-01 benchmark (`experiments/hiring-actor-benchmark-2026-08-01/`).
// Nothing is copied from Actor documentation: the benchmark found seven places
// where documentation and runtime disagreed, and runtime won each time.
//
// ── WHY A SECOND CATALOG ─────────────────────────────────────────────────────
// `actorRegistry.ts` answers "which Actor do I call for this source_type".
// This answers a different question the workflow needs BEFORE it calls anything:
// *what may I conclude from what comes back*. A card carries the Actor's
// LIMITS — the fields it cannot supply, the filters that are not proof, the
// enums that differ from its sibling Actor. Those belong next to the capability,
// not in a comment on a call site.
//
// This module REGISTERS nothing and ROUTES nothing. It is a read-only catalog.
// Source routing is unchanged by this PR.

export type ActorPurpose =
  | "company_discovery"
  | "company_enrichment"
  | "hiring_verification"
  | "founder_discovery";

export type ActorConfidence = "high" | "medium" | "low";

/** A defect observed in live runtime, with what a caller must do about it. */
export interface KnownDefect {
  id: string;
  summary: string;
  /** What the caller MUST do. Enforced in the input layer where possible. */
  mitigation: string;
  /** Benchmark artifact that evidences it. */
  evidence_ref: string;
}

export interface ActorCostModel {
  /** Prices resolved at the BRONZE tier of the benchmark account. */
  tier: "BRONZE";
  start_usd: number;
  per_result_usd: number | null;
  /** Named per-event prices where the Actor charges by event kind. */
  events_usd?: Record<string, number>;
  minimum_total_usd?: number;
  /**
   * Inputs that MULTIPLY the result count. `maxItems` does not always mean
   * "at most this many rows" — on job-search it is per title PER location.
   */
  cost_multiplier_fields?: string[];
}

export interface HiringActorCard {
  actor_key: string;
  actor_id: string;
  purposes: ActorPurpose[];
  /** Filters the LIVE schema accepts. Presence here is not proof of accuracy. */
  supported_filters: string[];
  /** Enum values copied verbatim from the live input schema. */
  verified_enums: Record<string, readonly string[]>;
  input_limits: Record<string, number | string>;
  /** Fields observed in live output. Absent field => absent from this list. */
  outputs: string[];
  best_for: string[];
  not_for: string[];
  cost_model: ActorCostModel;
  /** Which normalizer converts this Actor's rows. */
  normalizer_key: string;
  schema_build: string;
  last_verified_at: string;
  confidence: ActorConfidence;
  known_defects: KnownDefect[];
  /**
   * TRUE when this Actor's output may NOT satisfy a Company Brain hard gate on
   * its own. The workflow must enrich first. This is the single most important
   * field in the catalog — it is what stops a staffing firm entering the funnel
   * as a software company.
   */
  requires_enrichment_before_qualification: boolean;
}

// ── VERIFIED ENUMS ───────────────────────────────────────────────────────────
// Exported individually because the input layer validates against them and the
// two profile enums below are a known foot-gun.

export const JOB_POSTED_LIMITS = ["1h", "24h", "week", "month"] as const;
export const JOB_WORKPLACE_TYPES = ["remote", "hybrid", "office"] as const;
export const JOB_EMPLOYMENT_TYPES =
  ["full-time", "part-time", "contract", "internship", "temporary"] as const;
export const JOB_SORT_BY = ["date", "relevance"] as const;

export const COMPANY_SIZE_BANDS = [
  "1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+",
] as const;
export const COMPANY_SCRAPER_MODES = ["short", "full"] as const;

/**
 * THE TWO SHORT ENUMS ARE NOT THE SAME STRING.
 *
 * company-employees embeds the PRICE in the enum value; profile-search does not.
 * Sending one Actor's value to the other is silently accepted and falls back to
 * that Actor's own default — which is the expensive Full mode. This is exactly
 * what `harvestApiPeople.buildHarvestApiCompanyEmployeesInput` does today
 * (it validates against the profile-search set). Left unchanged in this PR;
 * see `known_defects` on the company-employees card.
 */
export const COMPANY_EMPLOYEES_SCRAPER_MODES = [
  "Short ($4 per 1k)", "Full ($8 per 1k)", "Full + email search ($12 per 1k)",
] as const;
export const PROFILE_SEARCH_SCRAPER_MODES = ["Short", "Full", "Full + email search"] as const;

/** Any mode that performs email lookup. Forbidden by every compiler here. */
export const EMAIL_ENRICHMENT_MODES: readonly string[] = [
  "Full + email search ($12 per 1k)", "Full + email search",
];

export const YC_MEMO23_MODES = ["jobs", "companies"] as const;
export const YC_MEMO23_INDUSTRIES = [
  "All industries", "B2B", "Consumer", "Healthcare", "Fintech",
  "Engineering, Product and Design", "Industrials", "Education",
  "Real Estate and Construction", "Government", "Unspecified",
] as const;
export const YC_MEMO23_MIN_SIZES =
  ["1+", "5+", "10+", "25+", "50+", "100+", "250+", "500+", "1000+"] as const;
export const YC_MEMO23_MAX_SIZES =
  ["1+", "5", "10", "25", "50", "100", "250", "500", "1000+"] as const;

export const YC_SOLIDCODE_STATUSES = ["Active", "Public", "Acquired", "Inactive"] as const;
export const YC_SOLIDCODE_TEAM_SIZES =
  ["1", "2-10", "11-50", "51-200", "201-500", "500+"] as const;
export const YC_SOLIDCODE_INDUSTRIES = [
  "B2B", "Consumer", "Education", "Fintech", "Government", "Healthcare",
  "Industrials", "Real Estate and Construction",
] as const;
export const YC_SOLIDCODE_REGIONS = [
  "United States of America", "Canada", "Latin America", "Europe",
  "United Kingdom", "Asia", "India", "Africa", "Middle East", "Oceania", "Remote",
] as const;

const VERIFIED = "2026-08-01";
const EV = "experiments/hiring-actor-benchmark-2026-08-01";

export const HIRING_ACTOR_CATALOG: Readonly<Record<string, HiringActorCard>> = Object.freeze({
  // ── YC DISCOVERY (PRIMARY) ────────────────────────────────────────────────
  apify_yc_companies_memo23: {
    actor_key: "apify_yc_companies_memo23",
    actor_id: "memo23/y-combinator-scraper",
    purposes: ["company_discovery", "hiring_verification"],
    supported_filters: ["mode", "regions", "industries", "batch", "isHiring",
      "minEmployeeSize", "maxEmployeeSize", "queries", "scrapeOpenJobs", "scrapeFounderDetails"],
    verified_enums: {
      mode: YC_MEMO23_MODES, industries: YC_MEMO23_INDUSTRIES,
      minEmployeeSize: YC_MEMO23_MIN_SIZES, maxEmployeeSize: YC_MEMO23_MAX_SIZES,
    },
    input_limits: { maxItems: "PER start-URL / per filter run — NOT a global cap" },
    outputs: ["id", "name", "slug", "website", "batch", "teamSize", "industry",
      "subindustry", "regions", "allLocations", "isHiring", "openJobs[]",
      "longDescription", "oneLiner", "status", "stage", "tags", "topCompany"],
    best_for: ["YC-cohort candidate discovery", "YC hiring status",
      "YC open jobs with YC's own role taxonomy"],
    not_for: ["LinkedIn company identity", "exact employee size",
      "RevOps / GTM Ops hiring coverage"],
    cost_model: { tier: "BRONZE", start_usd: 0.008, per_result_usd: 0.001,
      events_usd: { "apify-actor-start": 0.008, "apify-default-dataset-item": 0.001, "additional-data": 0.0001 },
      cost_multiplier_fields: ["maxItems (per URL / per filter run)"] },
    normalizer_key: "memo23_yc_company",
    schema_build: "0.0.21", last_verified_at: VERIFIED, confidence: "medium",
    known_defects: [
      { id: "memo23_no_linkedin_url",
        summary: "No LinkedIn company URL field exists anywhere in the output.",
        mitigation: "linkedin_company_url stays null. Resolve identity separately before any LinkedIn-keyed step.",
        evidence_ref: `${EV}/final_recommendation.md#2` },
      { id: "memo23_team_size_stale",
        summary: "teamSize is self-reported and stale — ShipBob returned teamSize 1; observed range 0-210 under a 1+ floor.",
        mitigation: "Advisory only. Never satisfies an employee-count gate.",
        evidence_ref: `${EV}/raw_outputs/run1_memo23_yc.json` },
      { id: "memo23_no_revops_coverage",
        summary: "102 live open jobs contained zero Sales/Revenue/GTM Ops roles (50 were engineering).",
        mitigation: "Do not plan an ops-role mission on the YC route alone.",
        evidence_ref: `${EV}/final_recommendation.md#2` },
    ],
    requires_enrichment_before_qualification: true,
  },

  // ── YC DISCOVERY (FALLBACK) ───────────────────────────────────────────────
  apify_yc_companies_solidcode: {
    actor_key: "apify_yc_companies_solidcode",
    actor_id: "solidcode/ycombinator-scraper",
    purposes: ["company_discovery"],
    supported_filters: ["searchQuery", "status", "regions", "industries",
      "teamSize", "isHiring", "includeJobs", "includeFounders"],
    verified_enums: {
      status: YC_SOLIDCODE_STATUSES, teamSize: YC_SOLIDCODE_TEAM_SIZES,
      industries: YC_SOLIDCODE_INDUSTRIES, regions: YC_SOLIDCODE_REGIONS,
    },
    input_limits: { teamSize: 1, maxResults: "0 = uncapped (internal 10k limit)" },
    outputs: ["companyId", "name", "slug", "website", "linkedin", "crunchbase",
      "twitter", "github", "country", "location", "yearFounded", "teamSize",
      "industries", "founders[]", "jobs[]", "openJobsCount", "status", "batch"],
    best_for: ["fallback YC discovery", "richer identity fields than memo23 (linkedin, crunchbase, yearFounded)"],
    not_for: ["multi-band size filtering", "primary discovery"],
    cost_model: { tier: "BRONZE", start_usd: 0.00005, per_result_usd: 0.002 },
    normalizer_key: "solidcode_yc_company",
    schema_build: "1.0.5", last_verified_at: VERIFIED, confidence: "low",
    known_defects: [
      { id: "solidcode_multi_teamsize_silent_empty",
        summary: "teamSize is documented multi-select but ANDs its values: any 2+ values returns ZERO rows, reported as 'No companies matched your filters'.",
        mitigation: "HARD RULE — at most one teamSize value per call. Fan out one identified call per band. Enforced in compileSolidcodeYcInput.",
        evidence_ref: `${EV}/final_recommendation.md#2 (probes D vs F)` },
      { id: "solidcode_linkedin_often_null",
        summary: "The `linkedin` field was null on every observed row.",
        mitigation: "Treat as optional; never assume identity is present.",
        evidence_ref: `${EV}/raw_outputs/probeC_solidcode.json` },
    ],
    requires_enrichment_before_qualification: true,
  },

  // ── GENERAL DISCOVERY — CANDIDATES ONLY ───────────────────────────────────
  apify_linkedin_company_search: {
    actor_key: "apify_linkedin_company_search",
    actor_id: "harvestapi/linkedin-company-search",
    purposes: ["company_discovery"],
    supported_filters: ["searchQuery", "locations", "industryIds", "companySize", "scraperMode"],
    verified_enums: { scraperMode: COMPANY_SCRAPER_MODES, companySize: COMPANY_SIZE_BANDS },
    input_limits: { locations: 20, industryIds: 20, maxItems: 1000, takePages: 20 },
    outputs: ["id", "name", "linkedinUrl", "website", "description",
      "employeeCount (full mode only)", "employeeCountRange", "industries (full mode)",
      "industry (short mode)", "companyType", "locations", "specialities", "tagline"],
    best_for: ["generating LinkedIn company CANDIDATES with identity URLs"],
    not_for: ["ICP qualification", "semantic/concept search",
      "proving industry", "proving employee size"],
    cost_model: { tier: "BRONZE", start_usd: 0.001, per_result_usd: 0.002,
      events_usd: { "apify-actor-start": 0.001, "short-company": 0.002, "full-company": 0.004 } },
    normalizer_key: "linkedin_company_candidate",
    schema_build: "0.0.17", last_verified_at: VERIFIED, confidence: "medium",
    known_defects: [
      { id: "company_search_query_is_name_match",
        summary: "searchQuery matches company NAMES, not concepts. 'B2B software platform' returned 1 company literally named that.",
        mitigation: "Never pass a concept phrase. Compiler warns on multi-word conceptual queries.",
        evidence_ref: `${EV}/final_recommendation.md#3` },
      { id: "company_search_size_filters_wrong_field",
        summary: "companySize filters employeeCountRange, which contradicts employeeCount by up to 23x (Cisco Networking Academy: 4642 actual, tagged 51-200). 4/8 precision observed.",
        mitigation: "Size filter is a hint. Only enriched employeeCount may satisfy a size gate.",
        evidence_ref: `${EV}/final_recommendation.md#3` },
      { id: "company_search_industry_unreliable",
        summary: "industryIds:['4'] (Software Development) returned TechCrunch, Entrepreneur Media and Swooped — Swooped's true industry is 104 Staffing and Recruiting.",
        mitigation: "Provider industry is never proof. Enrichment supplies the authoritative industry id.",
        evidence_ref: `${EV}/final_recommendation.md#3` },
      { id: "company_search_short_mode_no_headcount",
        summary: "employeeCount is null in short mode, so the size filter cannot be verified in the cheap mode.",
        mitigation: "Use enrichment, not full mode, when headcount must be trusted.",
        evidence_ref: `${EV}/raw_outputs/run3_company_search.json` },
    ],
    requires_enrichment_before_qualification: true,
  },

  // ── MANDATORY ENRICHMENT ──────────────────────────────────────────────────
  apify_linkedin_company_details: {
    actor_key: "apify_linkedin_company_details",
    actor_id: "harvestapi/linkedin-company",
    purposes: ["company_enrichment"],
    supported_filters: ["companies", "searches"],
    verified_enums: {},
    input_limits: {},
    outputs: ["id", "name", "linkedinUrl", "website", "description", "employeeCount",
      "employeeCountRange", "industries[{id,name,hierarchy}]", "companyType",
      "locations", "specialities", "followerCount", "peopleStats", "foundedOn"],
    best_for: ["authoritative exact employeeCount", "authoritative industry id + hierarchy",
      "canonical LinkedIn identity", "correcting company-search's unreliable filters"],
    not_for: ["foundedOn (null on 2 of 3 observed companies)", "discovery"],
    cost_model: { tier: "BRONZE", start_usd: 0.00005, per_result_usd: 0.004,
      minimum_total_usd: 0.004 },
    normalizer_key: "linkedin_company_enriched",
    schema_build: "0.0.37", last_verified_at: VERIFIED, confidence: "high",
    known_defects: [
      { id: "company_details_founded_on_null",
        summary: "foundedOn was null for 2 of 3 companies.",
        mitigation: "Optional. Never required evidence.",
        evidence_ref: `${EV}/raw_outputs/run8_linkedin_company.json` },
      { id: "company_details_range_contradicts_count",
        summary: "employeeCountRange still contradicts the exact employeeCount on enriched rows.",
        mitigation: "Normalizer keeps them in separate fields; range is advisory only.",
        evidence_ref: `${EV}/field_mapping_matrix.md` },
    ],
    requires_enrichment_before_qualification: false,
  },

  // ── HIRING VERIFICATION ───────────────────────────────────────────────────
  apify_linkedin_job_search: {
    actor_key: "apify_linkedin_job_search",
    actor_id: "harvestapi/linkedin-job-search",
    purposes: ["hiring_verification"],
    supported_filters: ["company", "jobTitles", "locations", "postedLimit",
      "workplaceType", "employmentType", "sortBy", "industryIds"],
    verified_enums: {
      postedLimit: JOB_POSTED_LIMITS, workplaceType: JOB_WORKPLACE_TYPES,
      employmentType: JOB_EMPLOYMENT_TYPES, sortBy: JOB_SORT_BY,
    },
    input_limits: { company: 10, industryIds: 20,
      maxItems: "PER jobTitle PER location — multiplies total rows and cost" },
    outputs: ["id", "title", "linkedinUrl", "company{id,name,linkedinUrl,website}",
      "location", "workplaceType", "postedDate", "descriptionText", "employmentType",
      "experienceLevel", "jobFunctions", "applicantTrackingSystem"],
    best_for: ["verifying hiring INSIDE a known company set — zero cross-company leakage observed"],
    not_for: ["exact role matching", "treating the posting company as the employer"],
    cost_model: { tier: "BRONZE", start_usd: 0.001, per_result_usd: 0.001,
      events_usd: { "actor-start": 0.001, job: 0.001 }, minimum_total_usd: 0.002,
      cost_multiplier_fields: ["maxItems x jobTitles x locations"] },
    normalizer_key: "linkedin_job",
    schema_build: "0.0.55", last_verified_at: VERIFIED, confidence: "medium",
    known_defects: [
      { id: "job_search_fuzzy_titles",
        summary: "jobTitles is a fuzzy search. 'Sales Operations Manager' returned 'Enterprise Account Manager (Aviation)' and 'Operation Manager Trainee'. Zero exact pack matches in packs A and B.",
        mitigation: "MANDATORY deterministic post-filter — see hiringRolePackFilter.ts.",
        evidence_ref: `${EV}/raw_outputs/run4_ctrl_packA_unrestricted.json` },
      { id: "job_search_aggregator_employer",
        summary: "The posting company is not necessarily the employer. Two 'Swooped' postings described entirely different businesses.",
        mitigation: "Run aggregator evidence extraction before treating a posting as company hiring intent.",
        evidence_ref: `${EV}/raw_outputs/run5_jobsearch_B_revenue_ops.json` },
      { id: "job_search_duplicate_rows",
        summary: "25% duplicate rows within a single pack (8 rows, 6 unique titles).",
        mitigation: "Deduplicate on job id during normalization.",
        evidence_ref: `${EV}/raw_outputs/run5_jobsearch_C_gtm_ops.json` },
    ],
    requires_enrichment_before_qualification: false,
  },

  // ── FOUNDER DISCOVERY (PRIMARY) ───────────────────────────────────────────
  apify_linkedin_company_employees: {
    actor_key: "apify_linkedin_company_employees",
    actor_id: "harvestapi/linkedin-company-employees",
    purposes: ["founder_discovery"],
    supported_filters: ["companies", "jobTitles", "locations", "seniorityLevelIds",
      "profileScraperMode", "companyBatchMode", "maxItemsPerCompany"],
    verified_enums: {
      profileScraperMode: COMPANY_EMPLOYEES_SCRAPER_MODES,
      companyBatchMode: ["all_at_once", "one_by_one"],
    },
    input_limits: { companies: 1000, jobTitles: 50 },
    outputs: ["id", "firstName", "lastName", "linkedinUrl", "location", "openProfile",
      "premium", "currentPositions[{title,companyName,companyLinkedinUrl,current,tenureAtCompany,startedOn}]"],
    best_for: ["founder/CEO discovery with a PER-COMPANY cap", "current-employer evidence"],
    not_for: ["exact title precision (2 of 10 rows were off-target)", "vanity LinkedIn URLs"],
    cost_model: { tier: "BRONZE", start_usd: 0.02, per_result_usd: 0.003,
      events_usd: { "actor-start": 0.02, "short-profile": 0.003, "full-profile": 0.008,
        "full-profile-with-email": 0.012 }, minimum_total_usd: 0.05 },
    normalizer_key: "linkedin_person",
    schema_build: "0.0.144", last_verified_at: VERIFIED, confidence: "high",
    known_defects: [
      { id: "company_employees_distinct_short_enum",
        summary: "profileScraperMode values embed the price ('Short ($4 per 1k)') and differ from profile-search's ('Short'). An unrecognised value silently falls back to the expensive Full default. harvestApiPeople.buildHarvestApiCompanyEmployeesInput validates against the profile-search set today, so Short is currently unreachable there.",
        mitigation: "Use COMPANY_EMPLOYEES_SCRAPER_MODES. Existing builder left unchanged in this PR — behaviour change belongs to the workflow PR.",
        evidence_ref: `${EV}/final_recommendation.md#9` },
      { id: "company_employees_opaque_profile_url",
        summary: "linkedinUrl is the opaque ACwAAA... member-id form, never a vanity slug.",
        mitigation: "Deduplicate people on the stable `id`, never on URL.",
        evidence_ref: `${EV}/raw_outputs/run6_company_employees.json` },
      { id: "company_employees_fuzzy_titles",
        summary: "jobTitles is fuzzy — a Finance Intern and a Seed Investor were returned for Founder/CEO queries.",
        mitigation: "Deterministic founder-role evidence, never the query, decides.",
        evidence_ref: `${EV}/final_recommendation.md#4` },
    ],
    requires_enrichment_before_qualification: false,
  },

  // ── FOUNDER DISCOVERY (FALLBACK) ──────────────────────────────────────────
  apify_people_search: {
    actor_key: "apify_people_search",
    actor_id: "harvestapi/linkedin-profile-search",
    purposes: ["founder_discovery"],
    supported_filters: ["currentCompanies", "currentJobTitles", "locations",
      "companyHeadcount", "searchQuery", "profileScraperMode"],
    verified_enums: { profileScraperMode: PROFILE_SEARCH_SCRAPER_MODES },
    input_limits: { currentCompanies: 50, currentJobTitles: 50 },
    outputs: ["id", "firstName", "lastName", "linkedinUrl", "location",
      "profileIdInSearch", "currentPositions[...]"],
    best_for: ["people search not scoped to a company list", "fallback founder discovery"],
    not_for: ["per-company result caps (none exists)", "small cheap runs"],
    cost_model: { tier: "BRONZE", start_usd: 0, per_result_usd: 0.004,
      events_usd: { "search-page": 0.1, "full-profile": 0.004, "full-profile-with-email": 0.01 },
      minimum_total_usd: 0.1 },
    normalizer_key: "linkedin_person",
    schema_build: "0.0.249", last_verified_at: VERIFIED, confidence: "high",
    known_defects: [
      { id: "profile_search_no_per_company_cap",
        summary: "No maxItemsPerCompany — a 'max five founders per company' rule is unenforceable here.",
        mitigation: "Prefer company-employees whenever a per-company bound is required.",
        evidence_ref: `${EV}/final_recommendation.md#4` },
      { id: "profile_search_high_minimum",
        summary: "$0.10 minimum per run (search-page event) regardless of row count — ~2x company-employees at benchmark scale for identical recall (10/10 same people).",
        mitigation: "Fallback only.",
        evidence_ref: `${EV}/final_recommendation.md#4` },
    ],
    requires_enrichment_before_qualification: false,
  },
});

export function hiringActorCard(key: string): HiringActorCard | null {
  return HIRING_ACTOR_CATALOG[key] ?? null;
}

export function actorsForPurpose(purpose: ActorPurpose): HiringActorCard[] {
  return Object.values(HIRING_ACTOR_CATALOG).filter((c) => c.purposes.includes(purpose));
}

/** Cards whose output may never satisfy a Brain hard gate unenriched. */
export function actorsRequiringEnrichment(): string[] {
  return Object.values(HIRING_ACTOR_CATALOG)
    .filter((c) => c.requires_enrichment_before_qualification)
    .map((c) => c.actor_key);
}
