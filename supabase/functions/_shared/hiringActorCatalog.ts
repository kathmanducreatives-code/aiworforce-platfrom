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
  | "founder_discovery"
  /**
   * Enrich ONE already-identified person, and — only when the user has paid for
   * it — look up their business email.
   *
   * Deliberately not `founder_discovery`. Discovery answers "who is the buyer
   * at this company?" and takes a company. Enrichment answers "what else do we
   * know about THIS person?" and takes a profile. Collapsing them is what let a
   * `contact_unlock` charge two credits to re-run a founder search.
   */
  | "contact_enrichment"
  /**
   * Discover companies BY a funding event, and carry that event as evidence.
   *
   * Deliberately not `company_discovery`. A funding source does not return "a
   * company" — it returns a dated ROUND that happens to name one, and the round
   * is the evidence. Treating the two as the same purpose is what let a YC
   * directory scraper be declared the provider of `funding_event`.
   */
  | "funding_discovery"
  /** Read posts from a LinkedIn identity you already hold. Verification. */
  | "social_verification"
  /** Find posts by TOPIC, before any identity is known. Discovery. */
  | "social_discovery"
  /** Dated, sourced news articles — the substrate for expansion and launches. */
  | "news_signal"
  /** What a domain you already have actually runs. Verification only. */
  | "technology_verification";

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
  /**
   * The FIXED population this Actor can return, when it has one.
   *
   * A cohort-scoped Actor is not merely better at its cohort — it is incapable
   * of returning anything else. `memo23/y-combinator-scraper` reads the Y
   * Combinator directory; asked for German industrial-automation integrators it
   * does not return worse results, it returns YC companies, and every gate
   * downstream then correctly rejects a pool that was never the right one.
   *
   * This is a CAPABILITY FACT, which is why it lives on the card rather than in
   * a routing branch. `validateDiscoveryStrategy` reads it to refuse a mission
   * the Actor cannot serve and hands the reason back to the planner, exactly as
   * it does for `not_for`.
   *
   * Absent means unrestricted — the Actor searches an open index.
   */
  cohort_scope?: { id: string; label: string };
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

/**
 * `harvestapi/linkedin-profile-scraper` — a THIRD spelling of the same concept.
 *
 * Verified against the live Store schema on 2026-08-23: enum, pricing and event
 * names read from the Actor itself, not from a document. The three people
 * Actors express one idea in three incompatible vocabularies:
 *
 *   company-employees   "Short ($4 per 1k)" | "Full ($8 per 1k)" | "Full + email search ($12 per 1k)"
 *   profile-search      "Short"             | "Full"             | "Full + email search"
 *   profile-scraper     "Profile details no email ($4 per 1k)"   | "Profile details + email search ($10 per 1k)"
 *
 * An unrecognised value does not error on the platform — it falls back to the
 * Actor's default, which is the expensive one. That is why each compiler
 * validates against its OWN set and says which sibling's set was mistakenly
 * used.
 */
export const PROFILE_SCRAPER_MODES = [
  "Profile details no email ($4 per 1k)",
  "Profile details + email search ($10 per 1k)",
] as const;

/** The one mode that performs an email lookup on the enrichment Actor. */
export const PROFILE_SCRAPER_EMAIL_MODE =
  "Profile details + email search ($10 per 1k)" as const;

/**
 * Any mode that performs email lookup.
 *
 * ── WHAT THIS LIST MEANS, AND WHERE IT DOES NOT APPLY ──────────────────────
 *
 * Forbidden in the DISCOVERY layer: finding a person and buying their contact
 * details are separate, separately-priced, separately-consented actions, and an
 * email-search mode switched on during discovery silently converts a search
 * into a purchase for everyone in the result set.
 *
 * `contact_enrichment` is the deliberate exception. It runs against ONE already
 * known profile, only after the user pressed Find Contact Details, and it is
 * the only place `PROFILE_SCRAPER_EMAIL_MODE` may be set. Its compiler enforces
 * that with an explicit authorisation flag rather than by omission.
 */
export const EMAIL_ENRICHMENT_MODES: readonly string[] = [
  "Full + email search ($12 per 1k)", "Full + email search",
  PROFILE_SCRAPER_EMAIL_MODE,
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

// ── FUNDING (datahyena/company-funding-rounds) ──────────────────────────────
// Copied verbatim from the LIVE input schema read from the Apify Store API on
// 2026-08-22. The four stages the vendor marks "(no coverage yet)" are included
// because the schema accepts them — accepting a value and returning rows for it
// are different facts, and the card's `known_defects` records the difference.

export const FUNDING_ROUND_STAGES = [
  "pre-seed", "seed", "angel", "series-a", "series-b", "series-c", "series-d",
  "series-e", "series-f", "series-g", "series-h", "growth", "extension",
  "bridge", "convertible", "debt", "grant", "other", "unknown",
  "series-i", "safe", "pre-ipo", "secondary", "pipe",
] as const;

/** Stages the vendor's own schema labels as having no coverage yet. */
export const FUNDING_STAGES_WITHOUT_COVERAGE =
  ["series-i", "safe", "pre-ipo", "secondary", "pipe"] as const;

/** ISO-3166 alpha-2, exactly as the schema enumerates them. `unknown` is real. */
export const FUNDING_COUNTRIES = [
  "AE", "AR", "AT", "AU", "BD", "BE", "BR", "BS", "CA", "CH", "CL", "CN", "CO",
  "CY", "CZ", "DE", "DK", "EE", "EG", "ES", "FI", "FR", "GB", "GR", "HK", "HU",
  "ID", "IE", "IL", "IN", "IT", "JP", "KE", "KR", "LT", "LU", "LV", "MX", "MY",
  "NG", "NL", "NO", "NZ", "PH", "PK", "PL", "PT", "RO", "RU", "SA", "SE", "SG",
  "TH", "TR", "TW", "UA", "US", "VN", "ZA", "unknown",
] as const;

/** High-level sectors. Broader than the LinkedIn-style industry groups. */
export const FUNDING_VERTICALS = [
  "ai", "fintech", "saas", "devtools", "healthcare", "climate", "robotics",
  "cybersecurity", "logistics", "commerce", "data", "crypto", "media",
  "education", "marketing", "telecom", "realestate", "hardware", "gaming",
  "space", "unknown",
] as const;

export const FUNDING_EMPLOYEE_BUCKETS = [
  "1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000",
  "5001-10000", "10001+",
] as const;

// ── SOCIAL / NEWS / TECHNOLOGY ──────────────────────────────────────────────
// Read verbatim from the LIVE Store input schemas on 2026-08-22.

/** Shared by all three harvestapi post Actors. Note `any` is a real member. */
export const POST_POSTED_LIMITS =
  ["any", "1h", "24h", "week", "month", "3months", "6months", "year"] as const;
/** The comment filter enum is SHORTER on the two URL-fed Actors. */
export const COMMENT_POSTED_LIMITS = ["any", "1h", "24h", "week", "month"] as const;
export const POST_SEARCH_SORT_BY = ["relevance", "date"] as const;
export const POST_PROFILE_SCRAPER_MODES = ["short", "main"] as const;
export const POST_CONTEXT_COUNTRIES = ["any", "US", "GB", "DE", "FR"] as const;
export const POST_CONTENT_TYPES = [
  "all", "videos", "images", "jobs", "live_videos", "documents",
  "collaborative_articles",
] as const;

export const NEWS_TIMEFRAMES = ["1h", "1d", "7d", "30d", "1y", "all"] as const;
export const NEWS_TOPICS = [
  "WORLD", "NATION", "BUSINESS", "TECHNOLOGY", "ENTERTAINMENT", "SPORTS",
  "SCIENCE", "HEALTH",
] as const;
/** A small, verified subset of the 80-value region enum. Extend as needed. */
export const NEWS_REGION_LANGUAGES = [
  "US:en", "GB:en", "CA:en", "AU:en", "IE:en", "IN:en", "SG:en", "ZA:en",
  "DE:de", "AT:de", "CH:de", "FR:fr", "BE:fr", "CH:fr", "ES:es", "IT:it",
  "NL:nl", "SE:sv", "NO:no", "PL:pl", "PT:pt-150", "BR:pt-419",
] as const;

const VERIFIED = "2026-08-01";
/** Live Store schemas read for the Phase 5 signal Actors. Output NOT observed. */
const SIGNAL_SCHEMA_VERIFIED = "2026-08-22";
/** Schema read from the Apify Store API; OUTPUT not yet observed on a live run. */
const FUNDING_SCHEMA_VERIFIED = "2026-08-22";
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
      { id: "yc_industries_is_coarse_and_over_narrows",
        summary:
          "`industries` accepts every value in the enum but is a COARSE top-level " +
          "bucket, and combining it with regions + isHiring commonly returns ZERO " +
          "rows. Verified live 2026-08-19: industries:['Engineering, Product and " +
          "Design'] + regions:['United States of America'] + isHiring:true returned " +
          "0 companies, twice. The enum says what the schema ACCEPTS, not what " +
          "returns data.",
        mitigation:
          "Omit `industries` unless the mission is squarely one bucket. The cohort " +
          "is small enough to filter on tags, oneLiner and subindustry after the " +
          "fact, and a zero-row discovery cannot be repaired downstream.",
        evidence_ref: "live end-to-end run 2026-08-19" },
    ],
    requires_enrichment_before_qualification: true,
    // THE POPULATION THIS ACTOR IS, not the population it prefers. It reads the
    // Y Combinator directory and can return nothing else, so a mission for
    // manufacturers, agencies or integrators is not served worse here — it is
    // not served at all.
    cohort_scope: { id: "y_combinator", label: "the Y Combinator company directory" },
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
    // THE POPULATION THIS ACTOR IS, not the population it prefers. It reads the
    // Y Combinator directory and can return nothing else, so a mission for
    // manufacturers, agencies or integrators is not served worse here — it is
    // not served at all.
    cohort_scope: { id: "y_combinator", label: "the Y Combinator company directory" },
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

  // ── FUNDING DISCOVERY ─────────────────────────────────────────────────────
  //
  // ── WHY THIS ACTOR AND NOT CRUNCHBASE ─────────────────────────────────────
  //
  // Four candidates were evaluated against the live Store schemas on 2026-08-22.
  //
  //   memo23/crunchbase-scraper — the incumbent the Phase 0 audit named. Its own
  //     schema settles it: `crunchbaseCookie` "unlocks the gated funding AMOUNT,
  //     announced DATE and INVESTORS on Discover results, lifts the
  //     15-results-per-search cap". Anonymous mode therefore returns no date and
  //     no amount, capped at 15 rows — and a funding event WITHOUT A DATE is not
  //     funding evidence, it is a rumour. Discovery also requires a pre-built
  //     `/discover/funding_rounds/HASH` URL, which no planner can construct.
  //
  //   davidsharadbhatt/crunchbase-company-scraper — the strongest social proof
  //     (991 users, 4.83/16) and real date-range + round-type filters. Rejected
  //     as PRIMARY on evidence shape: one row per COMPANY carrying "latest
  //     funding date", not one row per ROUND. The binding between a round, its
  //     date, its amount and its investors is what makes funding provable, and a
  //     company-level row loosens it. Its `headquartersLocation` is also free
  //     text with a documented ambiguity warning, against an enum here.
  //
  //   jungle_synthesizer/crunchbase-pro-companies-scraper — right shape
  //     (row-per-round) but carries `crunchbaseCookies`, a $0.10 start fee, a
  //     1.0/1 rating, and two mandatory free-text survey fields.
  //
  // datahyena wins on the one axis that matters most here: it returns the
  // EVIDENCE, one row per funding event, with the amount ungated.
  apify_funding_rounds_datahyena: {
    actor_key: "apify_funding_rounds_datahyena",
    actor_id: "datahyena/company-funding-rounds",
    purposes: ["funding_discovery"],
    supported_filters: [
      "since", "round", "verticals", "industryGroup", "industryGroups",
      "naicsCode", "minAmountUsd", "maxAmountUsd", "country", "countries",
      "employeeBuckets", "maxItems", "cursor",
    ],
    verified_enums: {
      round: FUNDING_ROUND_STAGES,
      countries: FUNDING_COUNTRIES,
      country: FUNDING_COUNTRIES,
      verticals: FUNDING_VERTICALS,
      employeeBuckets: FUNDING_EMPLOYEE_BUCKETS,
    },
    input_limits: {
      maxItems: "billed PER RECORD RETURNED — the single cost multiplier here",
      since: "YYYY-MM-DD or ISO-8601; the recency filter, and the only one",
    },
    // From the vendor's own field list. NOT yet observed on a live run — see
    // `confidence` and the first known defect.
    // OBSERVED on run 0XchPqe0cJpx0Yc2T, 18 rows. Company fields are NESTED
    // under `company`, which the first normalizer got wrong.
    outputs: [
      "id", "round", "amountUsd", "amountUsdCents", "amountOriginalCurrency",
      "amountOriginalCents", "announcedAt", "discoveredAt",
      "company.name", "company.domain", "company.description",
      "company.linkedinUrl", "company.linkedinHandle", "company.hqCity",
      "company.hqCountry.{code,name}", "company.industryGroup",
      "company.industrySubTags[]", "company.verticals[]",
      "company.employeeCountBucket", "company.foundedYear",
      "company.businessModel", "company.naicsCode",
      "investors[].{id,name}", "sources[].url",
    ],
    best_for: [
      "discovering companies BY a recent funding round",
      "a dated funding event with stage, amount and investors in one row",
      "date-bounded funding windows via `since`",
      "sector-scoped funding discovery across 21 verticals and 59 countries",
    ],
    not_for: [
      // The single most important limitation, and the reason funding
      // VERIFICATION stays unsupported after this phase.
      "verifying funding for a company set you already have — there is no " +
        "company, domain or URL input, so absence of a row proves nothing",
      "funding history — it returns announced rounds, not a company's full record",
      "private or unannounced rounds",
      "proving a company's CURRENT stage — a round is an event, not a status",
    ],
    cost_model: {
      tier: "BRONZE",
      start_usd: 0.00005,
      per_result_usd: 0.045,
      events_usd: { "actor-start": 0.00005, result: 0.045 },
      cost_multiplier_fields: ["maxItems (one charge per record returned)"],
    },
    normalizer_key: "datahyena_funding_round",
    // The Store publishes no build version for this Actor; `modifiedAt` is the
    // only version fact it exposes, so that is what the card records.
    schema_build: "store-modified-2026-08-20",
    last_verified_at: "2026-08-22",
    // RAISED FROM `low` AFTER RUN 0XchPqe0cJpx0Yc2T. The output was observed on
    // 18 real rows and the core evidence fields are fully populated: announced
    // date, company name, investors and source articles were present on 18 of
    // 18. Not `high`, because the provider's own company RESOLUTION was wrong on
    // at least two rows — see `datahyena_company_identity_collision`.
    confidence: "medium",
    known_defects: [
      { id: "datahyena_company_identity_collision",
        summary:
          "THE PROVIDER RESOLVES THE WRONG COMPANY. Run 0XchPqe0cJpx0Yc2T " +
          "attached an Australian fintech round (investors Airtree, Square Peg) " +
          "to `constantinople.ca` — a Montreal performing-arts ensemble — with " +
          "industryGroup 'Performing Arts'. A biotech, Gossamer Bio, was tagged " +
          "industryGroup 'Retail' with verticals ['commerce'].",
        mitigation:
          "The ROUND is trustworthy; the company attached to it is not. Never " +
          "accept the provider's domain, industry or verticals as identity or " +
          "ICP evidence — `requires_enrichment_before_qualification` is true for " +
          "exactly this reason, and identity must be re-resolved before any gate " +
          "reads it.",
        evidence_ref: "run 0XchPqe0cJpx0Yc2T, items 12 and 4" },
      { id: "datahyena_field_fill_rates",
        summary:
          "OBSERVED FILL RATES over 18 rows: announcedAt 100%, company.name " +
          "100%, investors 100%, sources 100%, company.domain 94%, amountUsd " +
          "89%, hqCountry 89%, company.linkedinUrl 83%, round 67%, verticals " +
          "61%, employeeCountBucket 28%.",
        mitigation:
          "The evidence gate (name + announced date) costs nothing in recall at " +
          "100% fill. But `round` is NULL on a third of rows, so a mission " +
          "filtering on stage silently loses them, and employeeCountBucket is " +
          "too sparse to gate size on.",
        evidence_ref: "run 0XchPqe0cJpx0Yc2T, 18 rows" },
      { id: "datahyena_amount_varies_by_source",
        summary:
          "Announced amounts disagree between sources. One row reported " +
          "amountUsd 250,000,000 while its own TechCrunch citation said $200 " +
          "million; another reported 150,000,000 against a source saying 'up to " +
          "$250 million'.",
        mitigation:
          "Report the amount WITH its source article and never as a precise " +
          "figure. This is what the card means by an announced amount being a " +
          "report rather than an audit.",
        evidence_ref: "run 0XchPqe0cJpx0Yc2T, Starcloud and Gossamer Bio rows" },
      { id: "datahyena_stage_coverage_gaps",
        summary:
          "The schema's own enum titles mark five stages as having no coverage " +
          "yet: series-i, safe, pre-ipo, secondary, pipe. The filter ACCEPTS " +
          "them and returns nothing.",
        mitigation:
          "Requesting one of these is a silent zero-row run. The compiler warns, " +
          "and a mission asking only for them must be reported as unserved " +
          "rather than as 'no companies found'.",
        evidence_ref: "input schema enumTitles, 2026-08-22" },
      { id: "datahyena_missing_dimensions",
        summary:
          "The vendor documents that about a fifth of companies have no industry " +
          "on record and about a quarter have no HQ country. Filtering on either " +
          "dimension SILENTLY EXCLUDES those deals.",
        mitigation:
          "Add the `unknown` member alongside any industry or country filter " +
          "when the mission's constraint is soft; omit the filter entirely when " +
          "recall matters more than precision.",
        evidence_ref: "input schema field descriptions, 2026-08-22" },
      { id: "datahyena_low_adoption",
        summary:
          "48 total users, 36 monthly, 4 ratings (4.78 avg). The retention ratio " +
          "is strong but the absolute sample is small, so reliability is inferred " +
          "from very little evidence.",
        mitigation:
          "Prefer it for the evidence it uniquely provides; do not plan a large " +
          "spend against it before a live verification run.",
        evidence_ref: "Apify Store stats, 2026-08-22" },
      { id: "datahyena_amount_is_reported_not_audited",
        summary:
          "Amounts are normalized to USD from announcements. An announced figure " +
          "is what an outlet reported, not an audited number.",
        mitigation:
          "Report the amount with its source article; never present it as a " +
          "verified financial fact.",
        evidence_ref: "vendor README, 2026-08-22" },
    ],
    // A funding round names the company and carries its own evidence, but the
    // ICP claim — industry, size, business model — is still the provider's own
    // tagging and must be settled by enrichment like every other source.
    requires_enrichment_before_qualification: true,
  },

  // ── SOCIAL: THE TWO URL-FED POST ACTORS ───────────────────────────────────
  //
  // ── THE MOST IMPORTANT FACT ABOUT THIS PAIR ───────────────────────────────
  //
  // `linkedin-company-posts` and `linkedin-profile-posts` have IDENTICAL input
  // schemas, verified field by field on 2026-08-22. Both take `targetUrls`, and
  // both accept a `/company/` URL and an `/in/` URL interchangeably — the
  // company Actor's own prefill lists Satya Nadella's profile.
  //
  // So the company/person boundary CANNOT come from which Actor is called. Two
  // Actors that do the same thing cannot enforce a distinction between them.
  // The boundary is the URL SHAPE, and it is enforced in the compilers
  // (`compileCompanyPostsInput` refuses `/in/`, `compileProfilePostsInput`
  // refuses `/company/`) and asserted in `socialEvidence.test.ts`.
  //
  // Both are carded anyway, because the SCOPE they are declared for is what the
  // evidence table and the unlock boundary read — and the profile one is
  // unlock-gated while the company one is not.
  apify_linkedin_company_posts: {
    actor_key: "apify_linkedin_company_posts",
    actor_id: "harvestapi/linkedin-company-posts",
    purposes: ["social_verification"],
    supported_filters: [
      "targetUrls", "maxPosts", "postedLimit", "postedLimitDate",
      "includeQuotePosts", "includeReposts", "scrapeComments", "maxComments",
      "commentsPostedLimit", "scrapeReactions", "maxReactions", "contextCountry",
    ],
    verified_enums: {
      postedLimit: POST_POSTED_LIMITS,
      commentsPostedLimit: COMMENT_POSTED_LIMITS,
      contextCountry: POST_CONTEXT_COUNTRIES,
    },
    input_limits: {
      maxPosts: "PER target URL. 0 means ALL posts — never send 0",
      targetUrls: "one company LinkedIn URL per target; identity must be resolved first",
    },
    // OBSERVED on run 34dB6dpHJr34h8bIr, 8 rows, 139 distinct fields.
    outputs: [
      "linkedinUrl", "shareLinkedinUrl", "type", "content",
      "postedAt.{date,timestamp,postedAgoText}",
      "author.{name,linkedinUrl,type,universalName,companyId,info}",
      "engagement.{likes,comments,shares,reactions[]}",
      "article.{title,link,description}", "postImages[]", "postVideo",
      "repost.*", "query.targetUrl",
    ],
    best_for: [
      "reading what a COMPANY page published, once its LinkedIn URL is known",
      "date-bounded company activity via postedLimit / postedLimitDate",
      "company-authored topic evidence — launches, expansion, hiring pushes",
    ],
    not_for: [
      "finding companies — it consumes URLs and cannot search",
      "leadership posts; an /in/ URL here is a PERSON and is refused by the compiler",
      "proving a topic by engagement — comments here are engagement RECEIVED on " +
        "the company's posts, authored by other people, not statements by the company",
    ],
    cost_model: {
      tier: "BRONZE", start_usd: 0.00005, per_result_usd: 0.002,
      events_usd: {
        "actor-start": 0.00005, post: 0.002, comment: 0.002, reaction: 0.002,
        "zero-result-query": 0.001,
      },
      cost_multiplier_fields: [
        "maxPosts (per target URL)", "maxComments (per post, billed separately)",
        "maxReactions (per post, billed separately)",
      ],
    },
    normalizer_key: "linkedin_post",
    schema_build: "store-modified-2026-08-08",
    last_verified_at: "2026-08-22",
    // RAISED after run 34dB6dpHJr34h8bIr: 8 of 8 rows carried a post URL, an ISO
    // date, full text and a typed author. Not `high` — one company, one run.
    confidence: "medium",
    known_defects: [
      { id: "company_posts_field_names_differ_from_docs",
        summary:
          "THE DOCUMENTED SHAPE IS NOT THE REAL SHAPE. The post URL is " +
          "`linkedinUrl`, not `postUrl`; `postedAt` is an OBJECT " +
          "{date,timestamp,postedAgoText}, not a string; `engagement.reactions` " +
          "is an ARRAY of {type,count} breakdowns while the scalar total is " +
          "`engagement.likes`. A row carries 139 distinct fields.",
        mitigation:
          "The normalizer reads the observed names. Written from the README it " +
          "produced a null URL and null date for every row, so `is_evidence` was " +
          "false on all 8 — a capability that silently returned nothing.",
        evidence_ref: "run 34dB6dpHJr34h8bIr, 8 rows" },
      { id: "company_posts_author_info_is_not_a_headline",
        summary:
          "`author.info` holds \"1,649,614 followers\" for a company page — a " +
          "follower count, not a headline.",
        mitigation:
          "The normalizer reads `info` as a headline only when the author is a " +
          "PERSON, so a follower count can never be presented as a job title.",
        evidence_ref: "run 34dB6dpHJr34h8bIr, Stripe rows" },
      { id: "company_posts_author_url_has_posts_suffix",
        summary:
          "`author.linkedinUrl` is returned as `.../company/stripe/posts`, not " +
          "the bare company URL.",
        mitigation:
          "The subject check matches on the `/company/` path segment, so the " +
          "suffix is tolerated. Identity matching must normalise it before use.",
        evidence_ref: "run 34dB6dpHJr34h8bIr" },
      { id: "company_posts_accepts_person_urls",
        summary: "THE SCHEMA DOES NOT ENFORCE SCOPE. `targetUrls` accepts /in/ " +
          "profile URLs as readily as /company/ URLs — the prefill ships both.",
        mitigation: "`compileCompanyPostsInput` refuses any non-/company/ URL, so " +
          "the scope boundary is enforced in code rather than hoped for.",
        evidence_ref: "input schema prefill, 2026-08-22" },
      { id: "company_posts_zero_result_billing",
        summary: "A target URL with no posts is still billed, at $0.001 per " +
          "0-result query.",
        mitigation: "Resolve identity before calling; never speculatively probe URLs.",
        evidence_ref: "pricing events, 2026-08-22" },
      { id: "company_posts_maxposts_zero_is_unbounded",
        summary: "maxPosts: 0 means ALL posts, not none — an unbounded spend.",
        mitigation: "The compiler requires a positive integer and caps it.",
        evidence_ref: "input schema description, 2026-08-22" },
    ],
    requires_enrichment_before_qualification: false,
  },

  apify_linkedin_profile_posts: {
    actor_key: "apify_linkedin_profile_posts",
    actor_id: "harvestapi/linkedin-profile-posts",
    purposes: ["social_verification"],
    supported_filters: [
      "targetUrls", "maxPosts", "postedLimit", "postedLimitDate",
      "includeQuotePosts", "includeReposts", "scrapeComments", "maxComments",
      "commentsPostedLimit", "scrapeReactions", "maxReactions", "contextCountry",
    ],
    verified_enums: {
      postedLimit: POST_POSTED_LIMITS,
      commentsPostedLimit: COMMENT_POSTED_LIMITS,
      contextCountry: POST_CONTEXT_COUNTRIES,
    },
    input_limits: {
      maxPosts: "PER target URL. 0 means ALL posts — never send 0",
      targetUrls: "one PERSON profile URL per target; requires an identified leader",
    },
    // OBSERVED on run 8Ks7TvqIiejDct5ha, 6 rows, 122 distinct fields.
    outputs: [
      "linkedinUrl", "type", "content",
      "postedAt.{date,timestamp,postedAgoText}",
      "author.{name,linkedinUrl,type,publicIdentifier,profileId,id,info,website}",
      "engagement.{likes,comments,shares,reactions[]}",
      "article.{title,link,description}", "repost.*", "query.targetUrl",
    ],
    best_for: [
      "reading what an IDENTIFIED PERSON published, once their profile URL is known",
      "leadership-authored intent signals, date-bounded",
    ],
    not_for: [
      "finding people — it consumes profile URLs and cannot search",
      "company posts; a /company/ URL here is refused by the compiler",
      "any use before the person has been identified through an accepted unlock",
    ],
    cost_model: {
      tier: "BRONZE", start_usd: 0.00005, per_result_usd: 0.002,
      events_usd: {
        "actor-start": 0.00005, post: 0.002, comment: 0.002, reaction: 0.002,
        "zero-result-query": 0.001,
      },
      cost_multiplier_fields: [
        "maxPosts (per target URL)", "maxComments (per post, billed separately)",
      ],
    },
    normalizer_key: "linkedin_post",
    schema_build: "store-modified-2026-08-08",
    last_verified_at: "2026-08-22",
    // RAISED after run 8Ks7TvqIiejDct5ha: 6 of 6 rows carried a post URL, an ISO
    // date, full text, and a person identity with a stable member id. Not
    // `high` — one profile, one run, and the near-duplicate behaviour below.
    confidence: "medium",
    known_defects: [
      { id: "profile_posts_author_type_is_profile_not_person",
        summary:
          "The provider labels a person `author.type: \"profile\"`, not " +
          "\"person\". The company Actor returns \"company\" on the same field.",
        mitigation:
          "`authorTypeFromUrl` accepts both spellings, and the URL shape wins " +
          "over the label in every case.",
        evidence_ref: "run 8Ks7TvqIiejDct5ha" },
      { id: "profile_posts_author_url_carries_tracking_param",
        summary:
          "A person's `author.linkedinUrl` arrives as " +
          "`/in/hnshah?miniProfileUrn=urn:li:fsd_profile:ACoAAA…`. The query " +
          "string rotates, so the same person can appear under two URLs.",
        mitigation:
          "The normalizer strips the query string, and identity keys on " +
          "`author.profileId` (the opaque ACoAAA… member urn) rather than the URL.",
        evidence_ref: "run 8Ks7TvqIiejDct5ha" },
      { id: "profile_posts_info_is_the_headline_and_names_the_employer",
        summary:
          "For a PERSON, `author.info` is the headline and carries both role and " +
          "employer — observed: \"CEO @ Crazy Egg (est. 2005), building tools " +
          "teams use to make marketing decisions.\" For a COMPANY the same field " +
          "held a follower count.",
        mitigation:
          "Read as a headline only for person authors. It is a SELF-WRITTEN " +
          "claim: useful to propose a role and employer, never to verify one — " +
          "employer verification remains the existing people-stage contract.",
        evidence_ref: "run 8Ks7TvqIiejDct5ha" },
      { id: "profile_posts_near_duplicate_reposts_of_same_campaign",
        summary:
          "Two of six rows were near-identical promotions of the same event, " +
          "posted a day apart with different post ids and slightly reworded text.",
        mitigation:
          "Dedupe on post id, never on text. For an intent signal, treat repeated " +
          "promotion of one thing as ONE piece of evidence rather than several.",
        evidence_ref: "run 8Ks7TvqIiejDct5ha, items 1 and 2" },
      { id: "profile_posts_identical_to_company_actor",
        summary: "Its input schema is byte-for-byte the same shape as " +
          "linkedin-company-posts, and it accepts /company/ URLs too. The two " +
          "Actors are not distinguished by capability.",
        mitigation: "Scope is enforced by the compiler on the URL, and this Actor " +
          "is the unlock-gated one in the evidence table.",
        evidence_ref: "input schema comparison, 2026-08-22" },
      { id: "profile_posts_requires_prior_identity",
        summary: "It cannot find a person. A profile URL must already exist, and " +
          "producing one is the unlock-gated people stage.",
        mitigation: "Never scheduled by a plan; reachable only after an accepted " +
          "founder unlock.",
        evidence_ref: "input schema: targetUrls only, 2026-08-22" },
    ],
    requires_enrichment_before_qualification: false,
  },

  // ── SOCIAL: TOPIC DISCOVERY ───────────────────────────────────────────────
  apify_linkedin_post_search: {
    actor_key: "apify_linkedin_post_search",
    actor_id: "harvestapi/linkedin-post-search",
    purposes: ["social_discovery"],
    supported_filters: [
      "searchQueries", "maxPosts", "postedLimit", "postedLimitDate", "sortBy",
      "authorUrls", "authorsCompanies", "authorKeywords", "authorsIndustryId",
      "mentioningMember", "mentioningCompany", "contentType",
      "profileScraperMode", "scrapeComments", "maxComments",
      "commentsPostedLimit", "commentsProfileScraperMode", "scrapeReactions",
      "maxReactions", "startPage", "scrapePages",
    ],
    verified_enums: {
      postedLimit: POST_POSTED_LIMITS,
      commentsPostedLimit: POST_POSTED_LIMITS,
      sortBy: POST_SEARCH_SORT_BY,
      profileScraperMode: POST_PROFILE_SCRAPER_MODES,
      commentsProfileScraperMode: POST_PROFILE_SCRAPER_MODES,
      contentType: POST_CONTENT_TYPES,
    },
    input_limits: {
      maxPosts: "PER search query. 0 means ALL posts — never send 0",
      scrapePages: "each page is 100 posts and each post is billed",
    },
    // OBSERVED on run 6YHiwmXEcP933uqst, 28 items, 206 distinct fields.
    // POSTS AND COMMENTS ARE SEPARATE ITEMS, discriminated by `type`.
    outputs: [
      "type ('post' | 'comment') — the discriminator",
      "POST: id, linkedinUrl, content, postedAt.{date,timestamp}, " +
        "author.{name,linkedinUrl,type,info,publicIdentifier,profileId}, " +
        "engagement.{likes,comments,shares}, query.search",
      "COMMENT: id, postId, linkedinUrl (deep permalink), commentary, " +
        "createdAt (flat ISO), actor.{id,name,linkedinUrl,position,type,author}, " +
        "engagement.{likes,comments}, query.post (the PARENT post URL)",
    ],
    best_for: [
      "finding posts by TOPIC before any company or person is known",
      "Boolean full-text search with date bounds and relevance/date sorting",
      // The capability that makes comment evidence real.
      "comments WITH commenter profile metadata, which is what makes " +
        "\"who commented on this topic\" answerable at all",
      "narrowing authors by headline keywords, company, or industry id",
    ],
    not_for: [
      "proving a signal about a SPECIFIC company you already hold — use the " +
        "URL-fed Actors for that; a topic search may simply miss them",
      "treating an author's headline as verified employment — a headline is " +
        "self-reported and is not employer evidence",
      "collapsing company and person authorship: `author.type` decides the " +
        "subject, and the normalizer keeps them apart",
    ],
    cost_model: {
      tier: "BRONZE", start_usd: 0.00005, per_result_usd: 0.002,
      events_usd: {
        "actor-start": 0.00005, post: 0.002, comment: 0.002, reaction: 0.002,
        "main-profile": 0.002, "full-profile": 0.004, "zero-result-query": 0.001,
      },
      cost_multiplier_fields: [
        "maxPosts (per search query)",
        "maxComments (per post, billed separately at the same price as a post)",
        "profileScraperMode=main / full profile enrichment, billed per profile",
      ],
    },
    normalizer_key: "linkedin_post",
    schema_build: "store-modified-2026-08-19",
    last_verified_at: "2026-08-22",
    // RAISED after run 6YHiwmXEcP933uqst. The retrieval works and the comment
    // evidence is genuinely rich — but the SIGNAL-TO-NOISE is poor enough that
    // `high` would misrepresent it. See the comment-noise defect.
    confidence: "medium",
    known_defects: [
      { id: "post_search_comments_are_separate_items_with_a_different_shape",
        summary:
          "COMMENTS ARE NOT NESTED. They arrive as separate dataset rows with " +
          "`type: \"comment\"`, and almost every field differs from a post: the " +
          "author is `actor` not `author`, the headline is `actor.position` not " +
          "`author.info`, the text is `commentary` not `content`, and the date is " +
          "a flat `createdAt` string rather than a `postedAt` object. One run " +
          "with maxPosts 6 returned 5 posts and 23 comments in one flat dataset.",
        mitigation:
          "`splitPostSearchRows` discriminates on `type` before normalising, and " +
          "`normalizeSocialComment` reads the comment shape. Read as posts, all " +
          "23 comments would have normalised to nulls and been billed anyway.",
        evidence_ref: "run 6YHiwmXEcP933uqst, 28 items" },
      { id: "post_search_comment_noise_is_the_dominant_failure_mode",
        summary:
          "COMMENT QUALITY IS BIMODAL. Of 23 observed comments, roughly a quarter " +
          "carried real signal — one founder wrote \"three email campaigns " +
          "earlier this summer, not a single reply... I still can't tell you if " +
          "that's channel, list quality, or us\" — while the rest were " +
          "congratulation noise (\"say it louder\", \"this is seriously " +
          "useful!!\"), self-promotional links, or near-identical AI-written " +
          "engagement bait: two different accounts posted the same observation " +
          "about \"1 positive reply per 53 emails\" in nearly the same words.",
        mitigation:
          "A comment is a CANDIDATE, never intent. The model must read each one " +
          "for meaning, and near-duplicate comments across accounts must be " +
          "treated as one low-value signal rather than corroboration.",
        evidence_ref: "run 6YHiwmXEcP933uqst" },
      { id: "post_search_commenters_are_mostly_sellers_not_buyers",
        summary:
          "A B2B problem query surfaces the people who SELL the solution. " +
          "Observed commenter headlines included \"Cold Email Specialist\", " +
          "\"B2B Lead Generation & Outbound Specialist\" and \"Sales Automation " +
          "for Agencies\" — practitioners marketing themselves on a thread about " +
          "the problem they sell against.",
        mitigation:
          "This is exactly why ICP fit is judged SEPARATELY from intent. Someone " +
          "discussing the problem fluently is often a competitor, and signal " +
          "alone must never promote a candidate.",
        evidence_ref: "run 6YHiwmXEcP933uqst" },
      { id: "post_search_commenter_url_is_clean_but_the_author_url_is_not",
        summary:
          "A COMMENTER's `actor.linkedinUrl` is a clean `/in/handle`. A POST " +
          "author's `author.linkedinUrl` carries a rotating `miniProfileUrn` " +
          "query parameter. The same person can therefore appear under two " +
          "different URLs depending on which row they came from.",
        mitigation:
          "Both normalizers strip the query string, and identity keys on the " +
          "opaque `ACoAAA…` member id, which is stable across both shapes.",
        evidence_ref: "run 6YHiwmXEcP933uqst" },
      { id: "post_search_actor_author_flag_marks_the_op",
        summary:
          "`actor.author` is a boolean marking whether the commenter is the " +
          "post's own author replying in their thread.",
        mitigation:
          "Carried as `is_post_author`. An author replying to their own post is " +
          "not third-party engagement and should not be counted as one.",
        evidence_ref: "run 6YHiwmXEcP933uqst" },
      { id: "post_search_comments_billed_per_item",
        summary: "Comments are billed at the SAME price as posts. maxPosts 50 with " +
          "maxComments 10 is up to 550 billable items, not 50.",
        mitigation: "The compiler caps posts and comments separately and states " +
          "the multiplied worst case in the cost estimate.",
        evidence_ref: "pricing events, 2026-08-22" },
      { id: "post_search_author_headline_is_not_employment",
        summary: "`authorKeywords` matches the author's self-written headline. A " +
          "headline saying CEO is a claim by that person, not verified employment.",
        mitigation: "A person-subject claim from this Actor is corroboration. " +
          "Employer verification remains the existing people-stage contract.",
        evidence_ref: "input schema field description, 2026-08-22" },
      { id: "post_search_relevance_is_not_topicality",
        summary: "LinkedIn full-text relevance decides what matches, not a topic " +
          "model. A post can match a query without being about the topic.",
        mitigation: "The topic qualifier is re-checked against post text during " +
          "qualification; a search match alone never satisfies a topic requirement.",
        evidence_ref: "vendor README, 2026-08-22" },
    ],
    requires_enrichment_before_qualification: true,
  },

  // ── NEWS ──────────────────────────────────────────────────────────────────
  apify_google_news: {
    actor_key: "apify_google_news",
    actor_id: "data_xplorer/google-news-scraper-fast",
    purposes: ["news_signal"],
    supported_filters: [
      "keywords", "topics", "topicUrls", "maxArticles", "timeframe",
      "region_language", "decodeUrls", "extractDescriptions", "extractImages",
    ],
    verified_enums: {
      timeframe: NEWS_TIMEFRAMES,
      topics: NEWS_TOPICS,
      region_language: NEWS_REGION_LANGUAGES,
    },
    input_limits: {
      maxArticles: "PER keyword or topic. 0 means NO LIMIT — never send 0",
      timeframe: "applies to KEYWORD searches only; topic pages ignore it",
    },
    // OBSERVED on run ak9nBcyYkolVrLQhM, 12 rows. The field is `url`, not
    // `link`, and `source` is a plain string.
    outputs: [
      "title", "url", "source", "publishedAt", "publishedTimestamp", "image",
      "description (ONLY when extractDescriptions is on)",
      "metadata.{keyword,sourceType,timeframe,scrapeTimestamp}",
    ],
    best_for: [
      "dated, sourced articles naming a company — the substrate for expansion " +
        "and product-launch evidence",
      "per-company verification by searching the company name plus a topic term",
      "Google News operators: quoted exact match, OR, -exclusion, site: filters",
    ],
    not_for: [
      "structured events — it returns ARTICLES, and the claim inside one is " +
        "prose that a later stage must read",
      "company identity — an article names a company in text, and a name is not " +
        "an identity; matching must be on domain or LinkedIn URL",
      "proving anything from a headline alone; the claim needs the article",
      "recency finer than its timeframe buckets (1h, 1d, 7d, 30d, 1y, all)",
    ],
    cost_model: {
      tier: "BRONZE", start_usd: 0, per_result_usd: 0.004,
      events_usd: { result: 0.004 },
      cost_multiplier_fields: ["maxArticles (per keyword AND per topic)"],
    },
    normalizer_key: "google_news_article",
    schema_build: "store-modified-2026-08-03",
    last_verified_at: "2026-08-22",
    // DELIBERATELY LEFT `low`. The transport works — 12 of 12 rows had a
    // decoded URL, a source and an ISO date — but the RELEVANCE was poor, and
    // for a signal source relevance is the capability. See the defect below.
    confidence: "low",
    known_defects: [
      { id: "news_keyword_matching_is_literal_not_semantic",
        summary:
          "THE HEADLINE FINDING. A phrase search for expansion language returned, " +
          "in 12 rows: a payments company \"expanding deeper into AI\" (an " +
          "acquisition, metaphorical), a court system \"expanding into family " +
          "courts\" (not a company at all), and two genuine office openings. " +
          "Roughly half the rows were not the signal requested.",
        mitigation:
          "A keyword hit is a CANDIDATE ARTICLE, never expansion evidence. The " +
          "article's own claim must be read and matched to the company before it " +
          "counts — which is why this capability produces an article rather than " +
          "a verdict, and why `extractDescriptions` is forced on.",
        evidence_ref: "run ak9nBcyYkolVrLQhM, 12 rows" },
      { id: "news_description_requires_a_flag",
        summary:
          "`description` is absent entirely unless `extractDescriptions` is set. " +
          "The first run returned none, so the claim text — the evidence — was " +
          "missing from every row.",
        mitigation:
          "The compiler forces `extractDescriptions: true`. It costs run time " +
          "and no money, since billing is per result rather than per field.",
        evidence_ref: "run ak9nBcyYkolVrLQhM" },
      { id: "news_field_is_url_not_link",
        summary: "The article field is `url`; `source` is a plain string, not an object.",
        mitigation: "Normalizer reads the observed names; both forms are tolerated.",
        evidence_ref: "run ak9nBcyYkolVrLQhM" },
      { id: "news_name_match_is_not_identity",
        summary: "An article names a company in prose. Two companies sharing a " +
          "name share their news, and the scenario matrix already records this.",
        mitigation: "Never attach an article to a company on name alone. The " +
          "normalizer records the matched name and leaves identity to the " +
          "existing company-identity contract.",
        evidence_ref: "discoveryScenarioMatrix.recent_company_news" },
      { id: "news_google_urls_need_decoding",
        summary: "Links are Google News redirects unless `decodeUrls` is on, and " +
          "the vendor states decoding significantly slows the run.",
        mitigation: "Enabled by the compiler: an undecodable source URL is a " +
          "citation nobody can check.",
        evidence_ref: "input schema description, 2026-08-22" },
      { id: "news_timeframe_ignored_on_topics",
        summary: "`timeframe` applies to keyword searches only; topic pages return " +
          "their own curated results at whatever age they choose.",
        mitigation: "The compiler warns when a topic is used with a timeframe, and " +
          "recency is re-checked from `publishedAt` rather than trusted.",
        evidence_ref: "input schema description, 2026-08-22" },
    ],
    requires_enrichment_before_qualification: true,
  },

  // ── TECHNOLOGY ────────────────────────────────────────────────────────────
  apify_builtwith_technology: {
    actor_key: "apify_builtwith_technology",
    actor_id: "builtwith/builtwith-official-technology-scraper",
    purposes: ["technology_verification"],
    supported_filters: ["startDomains", "maxRequestsPerCrawl"],
    verified_enums: {},
    input_limits: {
      startDomains: "root domains only; the schema enforces a domain pattern",
      maxRequestsPerCrawl: "defaults to 10,000,000 — always set it explicitly",
    },
    // OBSERVED on run PD0F1XtytK3Z7juwM. EXACTLY TWO top-level keys, and
    // categories are nested inside each technology rather than at the top.
    outputs: ["domain", "techs[].{name,tag,categories[],link}"],
    best_for: [
      "confirming what a domain you ALREADY HAVE actually runs",
    ],
    not_for: [
      // The finding that has survived every audit pass unchanged.
      "finding companies BY technology — the entire input is two fields, " +
        "`startDomains` and `maxRequestsPerCrawl`. There is no query field and " +
        "no reverse lookup, so 'who uses Shopify' is not a question it can take",
      "companies whose domain is unknown",
      "adoption DATES — it reports what is detected now, not when it began",
    ],
    cost_model: {
      tier: "BRONZE", start_usd: 0, per_result_usd: 0.002,
      events_usd: { result: 0.002 },
      cost_multiplier_fields: ["startDomains (one result per domain)"],
    },
    normalizer_key: "builtwith_technology",
    schema_build: "store-modified-2026-03-20",
    last_verified_at: "2026-08-22",
    // RAISED after run PD0F1XtytK3Z7juwM: both domains returned rich, correct
    // detections. Not `high` — two domains is a small sample.
    confidence: "medium",
    known_defects: [
      { id: "builtwith_categories_are_nested_per_technology",
        summary:
          "There is no top-level `categories`. Each entry in `techs[]` carries " +
          "its own `categories[]`, and reading the top level returned nothing — " +
          "losing the field that answers an AI-adoption question, since \"AI\" " +
          "appears there rather than in the technology name.",
        mitigation:
          "The normalizer flattens and dedupes nested categories.",
        evidence_ref: "run PD0F1XtytK3Z7juwM" },
      { id: "builtwith_high_volume_per_domain",
        summary:
          "OBSERVED 120 technologies for notion.so and 260 for stripe.com, " +
          "across 22 distinct tags and 130-223 distinct categories.",
        mitigation:
          "Billing is per DOMAIN, so volume is free in money and heavy in " +
          "payload. Match against the requested technology rather than storing " +
          "the whole stack.",
        evidence_ref: "run PD0F1XtytK3Z7juwM" },
      { id: "builtwith_no_reverse_lookup",
        summary: "domain in, technologies out. There is no way to ask which " +
          "domains run a given technology.",
        mitigation: "Declared VERIFICATION-only in the evidence table, so a " +
          "technology requirement can never plan discovery through it.",
        evidence_ref: "input schema: exactly two fields, 2026-08-22" },
      { id: "builtwith_no_adoption_date",
        summary: "A detection is a present-tense fact. It carries no start date, " +
          "so 'recently adopted X' cannot be answered.",
        mitigation: "Recency qualifiers on a technology signal are reported as " +
          "unhonoured rather than silently satisfied.",
        evidence_ref: "input schema: no date field, 2026-08-22" },
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

  // ── CONTACT ENRICHMENT (ONE KNOWN PERSON, USER-AUTHORISED) ────────────────
  //
  // THE ACTOR THIS SYSTEM PREVIOUSLY REFUSED TO REGISTER.
  //
  // `apifyIntelligenceRegistry` listed it under REJECTED with the reason "not
  // verified in this pass — it must not be registered on the strength of a
  // document". That was the right call then and the fix is not to relax it: the
  // enum, both pricing events and the four input shapes below were read from the
  // live Store schema on 2026-08-23, which is a free metadata call and not a run.
  //
  // WHY IT IS A DIFFERENT ACTOR FROM THE TWO ABOVE. Those two SEARCH — they take
  // a company or a query and return people who might be the buyer. This one does
  // not search at all. It takes profiles that are already known and returns more
  // about them. That is why it is the only Actor allowed to run an email lookup:
  // the person was already chosen, by a user, who pressed a priced button.
  apify_linkedin_profile_enrichment: {
    actor_key: "apify_linkedin_profile_enrichment",
    actor_id: "harvestapi/linkedin-profile-scraper",
    purposes: ["contact_enrichment"],
    supported_filters: ["urls", "publicIdentifiers", "profileIds", "profileScraperMode"],
    verified_enums: { profileScraperMode: PROFILE_SCRAPER_MODES },
    // No documented ceiling on the target list; the cost ceiling is the caller's.
    input_limits: { urls: 1000, publicIdentifiers: 1000, profileIds: 1000 },
    outputs: ["id", "publicIdentifier", "firstName", "lastName", "headline",
      "linkedinUrl", "location", "email", "experience[...]", "education[...]",
      "skills[...]"],
    best_for: [
      "enriching ONE person already resolved by decision-maker discovery",
      "business email lookup, when and only when the user has authorised it",
    ],
    not_for: [
      "finding a decision maker — it does not search, it takes profiles",
      "guaranteeing an email; the lookup often returns nothing and that is a real answer",
      "phone numbers — this Actor returns none, and no registered Actor does",
    ],
    // Read from the live schema: PAY_PER_EVENT, BRONZE, and NO actor-start fee.
    // Two events only, and the difference between them is the whole product
    // decision this capability exists to expose.
    cost_model: { tier: "BRONZE", start_usd: 0, per_result_usd: 0.004,
      events_usd: {
        "profile-details": 0.004,
        "profile-details-with-email": 0.01,
      }, minimum_total_usd: 0 },
    normalizer_key: "linkedin_person",
    schema_build: "store-2026-08-23", last_verified_at: "2026-08-23", confidence: "high",
    known_defects: [
      { id: "profile_scraper_third_mode_enum",
        summary: "profileScraperMode is a THIRD incompatible vocabulary — 'Profile details no email ($4 per 1k)' / 'Profile details + email search ($10 per 1k)'. Neither sibling Actor's value is valid here, and an unrecognised value falls back to the Actor default rather than erroring.",
        mitigation: "Use PROFILE_SCRAPER_MODES. compileHarvestProfileScraperInput names which sibling's enum was used by mistake.",
        evidence_ref: "apify store schema 2026-08-23" },
      { id: "profile_scraper_email_is_best_effort",
        summary: "The email-search mode is a LOOKUP, not a guarantee. A run that finds nothing still bills the $10/1k event.",
        mitigation: "Persist an explicit not_found state. Never infer an address from a name and a domain.",
        evidence_ref: "apify store schema 2026-08-23 — event is 'Profile details + email search', not 'email found'" },
      { id: "profile_scraper_no_phone",
        summary: "No phone number is returned, in either mode. Nothing in the registered catalog returns one.",
        mitigation: "Contact enrichment must not be described to a user as buying a phone number.",
        evidence_ref: "apify store schema 2026-08-23 — output carries no phone field" },
      { id: "profile_scraper_needs_a_known_person",
        summary: "Requires urls, publicIdentifiers or profileIds. With none of the three it has no target and returns nothing at full price.",
        mitigation: "Refuse to compile without a target. company-employees returns the opaque ACwAAA member id, which belongs in profileIds, not urls.",
        evidence_ref: "apify store schema 2026-08-23 — 'Provide at least one of the 3 fields'" },
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
