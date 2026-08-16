// THE APIFY INTELLIGENCE LAYER — what we KNOW about each Actor, and how we know it.
//
// ── WHY A REGISTRY AND NOT A "BEST ACTOR" CONSTANT ───────────────────────────
//
// There is no best Actor. There is an Actor that can answer THIS part of THIS
// request, with filters that exist, at a cost worth paying, freshly enough to
// matter. Which one that is changes with the question. So this file stores
// EVIDENCE — capability, adoption, rating, price, schema, defects — and lets
// the planner rank against the question, rather than hardcoding a winner that
// is wrong for most questions.
//
// ── EVERY RECORD HERE WAS VERIFIED AGAINST THE LIVE APIFY STORE ──────────────
//
// `verified_via` and `last_verified_at` say when and how. Nothing in this file
// was copied from a document or inferred from an Actor's name: each `actor_id`,
// price, rating, adoption figure, filter and enum was read from the Store API
// on the date recorded. That matters because the verification CHANGED what we
// registered — three of the Actors proposed for this layer did not survive it,
// and are recorded below as rejected rather than quietly omitted.
//
// ── THE DISTINCTION THAT ORGANISES EVERYTHING: WHAT GOES IN ──────────────────
//
// An Actor that takes a QUERY and returns companies can discover. An Actor that
// takes DOMAINS or PROFILE URLS and returns facts about them cannot — it can
// only enrich or corroborate something discovery already found. This is not a
// nuance; it is the difference between "find companies using Shopify" (which
// BuiltWith cannot do) and "does this company use Shopify" (which it does very
// well). `input_entities` records it, and the planner may not cross it.
//
// PURE. No network, provider, model or database access.

/** What an Actor consumes. See the header — this is the discovery boundary. */
export type ActorInputEntity = "query" | "domain" | "company_url" | "profile_url" | "company_name";

/** What an Actor can produce EVIDENCE for. Not what it is "about". */
export type ActorCapability =
  | "company_discovery"
  | "company_enrichment"
  | "hiring_signal"
  | "funding_signal"
  | "news_signal"
  | "social_activity"
  | "technology_signal"
  | "person_discovery"
  | "person_enrichment";

export type FreshnessClass =
  /** Changes rarely; a month-old answer is still true. */
  | "firmographic"
  /** Changes weekly; staleness materially misleads. */
  | "recent_signal"
  /** Point-in-time; only today's answer counts. */
  | "realtime";

/**
 * HOW MUCH WE TRUST THIS RECORD — not how good the Actor is.
 *
 * `verified_schema` means the input schema below was read from the Store API.
 * `field_tested` means we have additionally observed its OUTPUT on real runs
 * and recorded what it actually returns. The repo's `hiringActorCatalog` holds
 * that harder evidence for the Actors that have it; nothing here claims
 * field-tested status it has not earned.
 */
export type EvidenceLevel = "verified_schema" | "field_tested";

export interface ActorAdoption {
  /** Lifetime users on the Store. Low numbers are a real risk signal. */
  total_users: number;
  monthly_users: number;
  /** Null means NOBODY HAS RATED IT — which is not the same as unrated-but-fine. */
  rating: number | null;
  rating_count: number;
}

export interface ActorCostModel {
  model: "PAY_PER_EVENT" | "PER_RESULT" | "COMPUTE_UNITS";
  /** Charged before a single row arrives. A large one punishes small runs. */
  start_usd: number;
  per_result_usd: number;
  /** Anything else worth knowing before spending — gates, extras, minimums. */
  notes?: string;
}

export interface ActorDefect {
  id: string;
  summary: string;
  mitigation: string;
}

export interface ActorIntelligenceRecord {
  /** The Store's `username/name`. NEVER constructed, only read. */
  actor_id: string;
  actor_name: string;
  provider: string;
  source_url: string;

  input_entities: ActorInputEntity[];
  capabilities: ActorCapability[];
  best_for: string[];
  not_for: string[];

  /** Field names read from the live input schema. */
  supported_filters: string[];
  /** Enum values read verbatim from the live input schema. */
  verified_enums: Record<string, readonly string[]>;
  input_limits: Record<string, number | string>;
  /** Fields observed in output. Empty when only the schema has been verified. */
  output_fields: string[];

  cost: ActorCostModel;
  adoption: ActorAdoption;
  freshness: FreshnessClass;
  evidence_level: EvidenceLevel;

  last_verified_at: string;
  verified_via: "apify_store_api" | "apify_store_api_and_live_runs";
  /** Store's own last-modified date. A stale Actor is a risk regardless of rating. */
  actor_modified_at: string;

  known_defects: ActorDefect[];
  /** Actor ids to try instead, in order, when this one fails or is unsuitable. */
  fallback_actors: string[];
  /**
   * TRUE when this Actor's rows may NOT satisfy a qualification gate alone.
   * The single most important field: it is what stops a staffing firm entering
   * the funnel as a software company.
   */
  requires_enrichment: boolean;
  /**
   * OUR confidence in using this record to spend money, 0–1. Derived from
   * adoption, rating, evidence level and defect severity — not from the
   * Actor's own marketing.
   */
  confidence: number;
}

const VERIFIED = "2026-08-15";

/**
 * ACTORS CONSIDERED AND NOT REGISTERED, with the reason.
 *
 * Recorded rather than omitted, because "we looked and rejected it" and "we
 * never looked" are different states, and only one of them should stop someone
 * proposing the same Actor again next month. Every entry here was fetched from
 * the Store API on the date above.
 */
export const REJECTED_ACTORS: ReadonlyArray<{
  actor_id: string; reason: string; evidence: string;
}> = Object.freeze([
  {
    actor_id: "xtracto/google-news-scraper",
    reason: "no adoption evidence whatsoever",
    evidence: "2 total users, 1 monthly user, and no rating at all. " +
      "data_xplorer/google-news-scraper-fast answers the same question with " +
      "1657 users, 431 monthly and 4.9 from 5 ratings.",
  },
  {
    actor_id: "easyapi/google-news-scraper",
    reason: "start fee dominates the cost of a normal run",
    evidence: "$0.09 per Actor start against $0.005 per result: a 20-article " +
      "corroboration check costs $0.19, of which $0.09 buys nothing. " +
      "Rating is also the lowest of the candidates at 3.92 from 9.",
  },
  {
    actor_id: "crawlerbros/producthunt-scraper",
    reason: "no adoption evidence, and needs a credential we do not hold",
    evidence: "20 lifetime users, 4 monthly, no rating. Its schema also states " +
      "that a Product Hunt API token is REQUIRED for topic, userLaunches and " +
      "productDetail modes; without one only dailyLeaderboard works, 'with " +
      "limited fields (no description/makers/media)'. Product-launch discovery " +
      "therefore has no usable Actor in an unattended deployment.",
  },
  {
    actor_id: "mikolabs/google-search-results-scraper",
    reason: "not present in Store search results",
    evidence: "Named in the source catalog. A search for Google SERP Actors " +
      "returned five candidates and this was not among them. Not registered on " +
      "the strength of a document.",
  },
  {
    actor_id: "prodiger/google-search-scraper",
    reason: "not present in Store search results",
    evidence: "As above — named in the source catalog, absent from the Store " +
      "search. `apidojo/google-search-scraper` is registered instead.",
  },
  {
    actor_id: "harvestapi/linkedin-profile-scraper",
    reason: "not verified in this pass",
    evidence: "Named in the source catalog but not fetched from the Store API " +
      "here. It must not be registered on the strength of a document — the " +
      "same document also named the Actors rejected above.",
  },
  {
    actor_id: "datacach/yc-companies-detail-scraper",
    reason: "not verified in this pass",
    evidence: "One of three YC Actors named in the source catalog. " +
      "`haketa/ycombinator-companies-scraper` was verified and registered; the " +
      "repo's existing memo23 YC Actor remains the field-tested primary.",
  },
]);

/**
 * THE REGISTRY.
 *
 * Keyed by `actor_id` so a lookup cannot silently succeed on a near-miss name.
 */
export const APIFY_INTELLIGENCE: Readonly<Record<string, ActorIntelligenceRecord>> =
  Object.freeze({
    // ── SOCIAL ACTIVITY ──────────────────────────────────────────────────────
    "harvestapi/linkedin-post-search": {
      actor_id: "harvestapi/linkedin-post-search",
      actor_name: "Linkedin Post Search Scraper (No Cookies)",
      provider: "harvestapi",
      source_url: "https://apify.com/harvestapi/linkedin-post-search",
      // A QUERY GOES IN, so this one can genuinely find something nobody named.
      input_entities: ["query"],
      capabilities: ["social_activity", "hiring_signal", "funding_signal"],
      best_for: [
        "founder announcements nobody has indexed yet",
        "hiring intent stated in a post before a job is posted",
        "funding announcements from the company's own mouth",
      ],
      not_for: [
        "company discovery — a post proves a person said something, not that a company matches an ICP",
        "headcount, industry or any firmographic fact",
      ],
      supported_filters: [
        "searchQueries", "maxPosts", "postedLimit", "postedLimitDate", "sortBy",
        "authorUrls", "authorsCompanies", "mentioningMember", "mentioningCompany",
        "contentType", "authorsIndustryId", "authorKeywords", "profileScraperMode",
        "startPage", "scrapePages",
      ],
      verified_enums: {
        postedLimit: ["any", "1h", "24h", "week", "month", "3months", "6months", "year"],
        sortBy: ["relevance", "date"],
        contentType: ["all", "videos", "images", "jobs", "live_videos", "documents",
          "collaborative_articles"],
        profileScraperMode: ["short", "main"],
      },
      input_limits: { scrapePages: "each page is 100 posts" },
      output_fields: [],
      cost: {
        model: "PAY_PER_EVENT", start_usd: 0.00005, per_result_usd: 0.002,
        notes: "a query returning nothing still costs $0.001",
      },
      adoption: { total_users: 23217, monthly_users: 5249, rating: 4.94, rating_count: 14 },
      freshness: "recent_signal",
      evidence_level: "verified_schema",
      last_verified_at: VERIFIED,
      verified_via: "apify_store_api",
      actor_modified_at: "2026-08-13",
      known_defects: [
        {
          id: "post_search_is_not_discovery",
          summary: "Returns POSTS. The company behind a post may not exist as a " +
            "resolvable entity, and one post is not a company record.",
          mitigation: "Corroboration only. A post may support a signal a discovery " +
            "Actor already produced; it may never introduce a candidate on its own.",
        },
      ],
      fallback_actors: ["harvestapi/linkedin-company-posts"],
      requires_enrichment: true,
      confidence: 0.85,
    },

    "harvestapi/linkedin-company-posts": {
      actor_id: "harvestapi/linkedin-company-posts",
      actor_name: "LinkedIn Company Posts Scraper (No Cookies)",
      provider: "harvestapi",
      source_url: "https://apify.com/harvestapi/linkedin-company-posts",
      // URLS GO IN. This cannot discover; it deepens what discovery found.
      input_entities: ["company_url", "profile_url"],
      capabilities: ["social_activity", "hiring_signal"],
      best_for: [
        "what a KNOWN company has said recently",
        "confirming a hiring or expansion signal from the company's own feed",
      ],
      not_for: [
        "finding companies — it must be given the URLs it reads",
        "any question asked before identity resolution has run",
      ],
      supported_filters: [
        "targetUrls", "maxPosts", "postedLimit", "postedLimitDate",
        "includeQuotePosts", "includeReposts", "scrapeReactions", "maxReactions",
        "scrapeComments", "maxComments", "commentsPostedLimit", "contextCountry",
      ],
      verified_enums: {
        postedLimit: ["any", "1h", "24h", "week", "month", "3months", "6months", "year"],
        commentsPostedLimit: ["any", "1h", "24h", "week", "month"],
        contextCountry: ["any", "US", "GB", "DE", "FR"],
      },
      input_limits: { maxPosts: "0 means all posts" },
      output_fields: [],
      cost: {
        model: "PAY_PER_EVENT", start_usd: 0.00005, per_result_usd: 0.002,
        notes: "a URL with no posts still costs $0.001",
      },
      adoption: { total_users: 9503, monthly_users: 2999, rating: 5, rating_count: 3 },
      freshness: "recent_signal",
      evidence_level: "verified_schema",
      last_verified_at: VERIFIED,
      verified_via: "apify_store_api",
      actor_modified_at: "2026-08-08",
      known_defects: [
        {
          id: "company_posts_rating_thin",
          summary: "Rated 5.0 — from three ratings. Adoption is strong (2999 " +
            "monthly) but the rating itself carries little information.",
          mitigation: "Trust the usage figure, not the score.",
        },
      ],
      fallback_actors: [],
      requires_enrichment: true,
      confidence: 0.8,
    },

    "harvestapi/linkedin-profile-posts": {
      actor_id: "harvestapi/linkedin-profile-posts",
      actor_name: "LinkedIn Profile Posts Scraper (No Cookies)",
      provider: "harvestapi",
      source_url: "https://apify.com/harvestapi/linkedin-profile-posts",
      input_entities: ["profile_url", "company_url"],
      capabilities: ["social_activity", "hiring_signal", "funding_signal"],
      best_for: [
        "what a KNOWN founder has said recently",
        "founder hiring and expansion signals stated before a job is posted",
      ],
      not_for: [
        "finding companies or people — it must be given the URLs it reads",
        "any firmographic fact",
      ],
      supported_filters: [
        "targetUrls", "maxPosts", "postedLimit", "postedLimitDate",
        "includeQuotePosts", "includeReposts", "scrapeReactions", "maxReactions",
        "scrapeComments", "maxComments", "commentsPostedLimit", "contextCountry",
      ],
      verified_enums: {
        postedLimit: ["any", "1h", "24h", "week", "month", "3months", "6months", "year"],
        commentsPostedLimit: ["any", "1h", "24h", "week", "month"],
        contextCountry: ["any", "US", "GB", "DE", "FR"],
      },
      input_limits: { maxPosts: "0 means all posts" },
      output_fields: [],
      cost: {
        model: "PAY_PER_EVENT", start_usd: 0.00005, per_result_usd: 0.002,
        notes: "a URL with no posts still costs $0.001",
      },
      // THE BEST-ADOPTED ACTOR REGISTERED: 30204 lifetime, 8001 monthly, 4.9
      // from twenty ratings. Where an Actor's evidence is this strong it is
      // worth saying so, because most of this registry's entries are not.
      adoption: { total_users: 30204, monthly_users: 8001, rating: 4.9, rating_count: 20 },
      freshness: "recent_signal",
      evidence_level: "verified_schema",
      last_verified_at: VERIFIED,
      verified_via: "apify_store_api",
      actor_modified_at: "2026-08-08",
      known_defects: [
        {
          id: "profile_posts_needs_resolved_identity",
          summary: "Takes profile URLs. Nothing can be asked of it until " +
            "identity resolution has produced one.",
          mitigation: "Sequence it after identity, never as a discovery step.",
        },
      ],
      fallback_actors: ["harvestapi/linkedin-post-search"],
      requires_enrichment: true,
      confidence: 0.9,
    },

    // ── STARTUP DISCOVERY ────────────────────────────────────────────────────
    //
    // THE TWO ACTORS THE PIPELINE HAS ALWAYS DEPENDED ON, verified at last.
    // They were declared by `startup_company_discovery` long before this
    // registry existed, so every run to date has spent on them with no recorded
    // adoption, price or reliability evidence. What the verification found is
    // not reassuring, and is recorded here rather than softened.
    "memo23/y-combinator-scraper": {
      actor_id: "memo23/y-combinator-scraper",
      actor_name: "Y Combinator · YC · Jobs & Companies scraper",
      provider: "memo23",
      source_url: "https://apify.com/memo23/y-combinator-scraper",
      input_entities: ["query"],
      capabilities: ["company_discovery", "hiring_signal"],
      best_for: [
        "the YC cohort with its open-jobs array in one call",
        "the only registered discovery source that returns hiring evidence with the company",
      ],
      not_for: ["anything outside Y Combinator", "proving headcount — teamSize is self-reported"],
      supported_filters: ["mode", "regions", "industries", "batch", "isHiring",
        "minEmployeeSize", "maxEmployeeSize", "queries", "scrapeOpenJobs", "scrapeFounderDetails"],
      verified_enums: {},
      input_limits: { maxItems: "PER start-URL / per filter run — NOT a global cap" },
      output_fields: [],
      cost: { model: "PAY_PER_EVENT", start_usd: 0.008, per_result_usd: 0.001 },
      adoption: { total_users: 171, monthly_users: 38, rating: 4.62, rating_count: 2 },
      freshness: "firmographic",
      // THE ONLY FIELD-TESTED RECORD HERE. `hiringActorCatalog` carries defects
      // observed on real runs of this Actor, which no other entry can claim.
      evidence_level: "field_tested",
      last_verified_at: VERIFIED,
      verified_via: "apify_store_api_and_live_runs",
      actor_modified_at: "2026-08-08",
      known_defects: [
        {
          id: "memo23_yc_thin_adoption",
          summary: "171 lifetime users, 38 monthly, rated 4.62 by TWO people — " +
            "for the Actor every startup mission opens with. Its standing rests " +
            "on this repo's own live-run evidence, not on the community's.",
          mitigation: "Keep the field-tested defect list current; it is the only " +
            "real reliability evidence this Actor has.",
        },
      ],
      fallback_actors: ["haketa/ycombinator-companies-scraper"],
      requires_enrichment: true,
      confidence: 0.7,
    },

    "solidcode/ycombinator-scraper": {
      actor_id: "solidcode/ycombinator-scraper",
      actor_name: "Y Combinator Scraper",
      provider: "solidcode",
      source_url: "https://apify.com/solidcode/ycombinator-scraper",
      input_entities: ["query"],
      capabilities: ["company_discovery"],
      best_for: ["a second YC pass when the primary returned nothing"],
      not_for: ["anything the primary can answer — it duplicates YC at 2x the row price"],
      supported_filters: ["searchQuery", "status", "regions", "industries",
        "teamSize", "isHiring", "includeJobs", "includeFounders"],
      verified_enums: {},
      input_limits: { teamSize: 1, maxResults: "0 = uncapped (internal 10k limit)" },
      output_fields: [],
      cost: { model: "PAY_PER_EVENT", start_usd: 0.00005, per_result_usd: 0.002 },
      adoption: { total_users: 17, monthly_users: 2, rating: null, rating_count: 0 },
      freshness: "firmographic",
      evidence_level: "verified_schema",
      last_verified_at: VERIFIED,
      verified_via: "apify_store_api",
      actor_modified_at: "2026-08-14",
      known_defects: [
        {
          id: "solidcode_below_our_own_rejection_bar",
          summary: "17 lifetime users, 2 monthly, no rating. That is LESS " +
            "adoption than xtracto/google-news-scraper, which this registry " +
            "rejected outright on exactly that evidence — and this Actor is the " +
            "declared fallback for the pipeline's primary discovery capability.",
          mitigation: "It is already fallback-only and skipped unless the primary " +
            "returns nothing, which bounds the exposure. It should be replaced by " +
            "haketa or removed; keeping it is a decision, not an oversight.",
        },
      ],
      fallback_actors: ["haketa/ycombinator-companies-scraper"],
      requires_enrichment: true,
      confidence: 0.25,
    },

    "harvestapi/linkedin-company-search": {
      actor_id: "harvestapi/linkedin-company-search",
      actor_name: "LinkedIn Company Search Scraper (No Cookies)",
      provider: "harvestapi",
      source_url: "https://apify.com/harvestapi/linkedin-company-search",
      input_entities: ["query"],
      capabilities: ["company_discovery"],
      best_for: ["company candidates outside YC, with a LinkedIn identity URL"],
      not_for: [
        "concept queries — it matches company NAMES and reports a concept search as a successful empty run",
        "proving industry or employee size",
      ],
      supported_filters: ["searchQuery", "locations", "industryIds", "companySize", "scraperMode"],
      verified_enums: {},
      input_limits: { locations: 20, industryIds: 20, maxItems: 1000, takePages: 20 },
      output_fields: [],
      cost: { model: "PAY_PER_EVENT", start_usd: 0.001, per_result_usd: 0.004 },
      adoption: { total_users: 5924, monthly_users: 1417, rating: 5, rating_count: 4 },
      freshness: "firmographic",
      evidence_level: "field_tested",
      last_verified_at: VERIFIED,
      verified_via: "apify_store_api_and_live_runs",
      actor_modified_at: "2026-06-07",
      known_defects: [
        {
          id: "company_search_matches_names_not_concepts",
          summary: "Observed on live runs: a conceptual query returns a successful " +
            "EMPTY run, so the cost is real and the failure silent. Its size filter " +
            "disagreed with reality in four of eight observed rows.",
          mitigation: "Named companies or name-like queries only; size and industry " +
            "from enrichment, never from this Actor.",
        },
      ],
      fallback_actors: [],
      requires_enrichment: true,
      confidence: 0.8,
    },

    "harvestapi/linkedin-job-search": {
      actor_id: "harvestapi/linkedin-job-search",
      actor_name: "Advanced Linkedin Job Scraper (No Cookies)",
      provider: "harvestapi",
      source_url: "https://apify.com/harvestapi/linkedin-job-search",
      input_entities: ["query", "company_url"],
      capabilities: ["hiring_signal"],
      best_for: ["proving a named company has an open role, with a date and a title"],
      not_for: ["company discovery — a job posting is evidence about a company, not a company"],
      supported_filters: ["search", "location", "companyIds", "postedLimit",
        "workplaceType", "employmentType", "sortBy", "maxItems"],
      verified_enums: {},
      input_limits: {},
      output_fields: [],
      cost: { model: "PAY_PER_EVENT", start_usd: 0.001, per_result_usd: 0.001 },
      adoption: { total_users: 7553, monthly_users: 702, rating: 4.85, rating_count: 3 },
      freshness: "recent_signal",
      evidence_level: "field_tested",
      last_verified_at: VERIFIED,
      verified_via: "apify_store_api_and_live_runs",
      actor_modified_at: "2026-06-07",
      known_defects: [],
      fallback_actors: [],
      requires_enrichment: false,
      confidence: 0.85,
    },

    "haketa/ycombinator-companies-scraper": {
      actor_id: "haketa/ycombinator-companies-scraper",
      actor_name: "YCombinator Companies Scraper | 5,900+ YC Startup Directory",
      provider: "haketa",
      source_url: "https://apify.com/haketa/ycombinator-companies-scraper",
      input_entities: ["query"],
      capabilities: ["company_discovery", "hiring_signal"],
      best_for: [
        "YC discovery driven by a KEYWORD across name, one-liner, description, industry and tags",
        "geography far finer than the incumbent YC source offers — 76 named regions and countries",
        "filtering YC by funding stage, batch, status and hiring flag in one call",
      ],
      not_for: [
        "anything outside the Y Combinator directory",
        "proving headcount or industry — both are YC's own self-reported values",
      ],
      supported_filters: [
        "query", "batches", "statuses", "industries", "regions", "stages",
        "hiringOnly", "topCompaniesOnly", "maxRecords", "hitsPerPage",
      ],
      verified_enums: {
        statuses: ["Active", "Acquired", "Public", "Inactive"],
        industries: ["B2B", "Consumer", "Fintech", "Healthcare", "Education",
          "Government", "Industrials", "Real Estate and Construction", "Unspecified"],
        stages: ["Seed", "Early", "Growth"],
      },
      input_limits: { maxRecords: "0 means no limit", hitsPerPage: 1000 },
      output_fields: [],
      cost: { model: "PAY_PER_EVENT", start_usd: 0.00005, per_result_usd: 0.002 },
      adoption: { total_users: 96, monthly_users: 29, rating: null, rating_count: 0 },
      freshness: "firmographic",
      evidence_level: "verified_schema",
      last_verified_at: VERIFIED,
      verified_via: "apify_store_api",
      actor_modified_at: "2026-08-09",
      known_defects: [
        {
          id: "haketa_yc_unrated",
          summary: "96 lifetime users, 29 monthly, and no rating at all — despite " +
            "having the richest YC filter set of anything examined. Capability " +
            "and reliability evidence point in opposite directions here.",
          mitigation: "Not a primary. The repo's field-tested memo23 YC source " +
            "keeps that role; this is the alternative to reach for when a " +
            "mission needs a keyword or a region memo23 cannot express.",
        },
      ],
      fallback_actors: [],
      requires_enrichment: true,
      confidence: 0.45,
    },

    // ── WEB CORROBORATION ────────────────────────────────────────────────────
    "apidojo/google-search-scraper": {
      actor_id: "apidojo/google-search-scraper",
      actor_name: "Google Search Results Scraper (SERP)",
      provider: "apidojo",
      source_url: "https://apify.com/apidojo/google-search-scraper",
      input_entities: ["query"],
      capabilities: ["news_signal", "company_enrichment"],
      best_for: [
        "confirming a company exists and resolving its real domain",
        "a last-resort check when no structured source covers the claim",
      ],
      not_for: [
        "company discovery — a SERP returns PAGES, and ranking is not an ICP",
        "any structured firmographic field",
      ],
      supported_filters: [
        "startUrls", "searchTerms", "countryCode", "languageCode", "maxItems",
        "maxPagesPerQuery", "mobileResults",
      ],
      verified_enums: {
        // Truncated to what the planner has any use for; the live enum is the
        // full ISO country list and is validated against the schema at compile
        // time, not against this excerpt.
        languageCode: ["ar", "bg", "ca", "cs", "da", "de", "el", "en", "es", "et",
          "fi", "fr", "hr", "hu", "id", "is", "it", "iw", "ja", "ko", "lt", "lv",
          "nl", "no", "pl", "pt", "ro", "ru", "sk", "sl", "sr", "sv", "tr",
          "zh-CN", "zh-TW"],
      },
      input_limits: { maxPagesPerQuery: "Google returns ~200 results per search" },
      output_fields: [],
      cost: {
        model: "PAY_PER_EVENT", start_usd: 0, per_result_usd: 0.0002,
        notes: "$0.002 per QUERY including the first 10 results, then $0.0002 per extra item",
      },
      adoption: { total_users: 944, monthly_users: 215, rating: 3.9, rating_count: 11 },
      freshness: "realtime",
      evidence_level: "verified_schema",
      last_verified_at: VERIFIED,
      verified_via: "apify_store_api",
      actor_modified_at: "2026-08-16",
      known_defects: [
        {
          id: "serp_pricing_reported_inconsistently",
          summary: "The Store's search endpoint reports PAY_PER_EVENT at $0.002 " +
            "per query; the detail endpoint reported `model: FREE` on the same " +
            "day, while the description still states the per-query price. The " +
            "two endpoints disagree.",
          mitigation: "Budget against the per-query figure, which is the " +
            "conservative reading. Re-verify before relying on it at volume.",
        },
        {
          id: "serp_lowest_rated_registered",
          summary: "3.9 from 11 ratings — the lowest score of anything registered, " +
            "and from enough ratings to mean something, unlike the 5.0s here.",
          mitigation: "Corroboration only, never a source of record.",
        },
      ],
      fallback_actors: ["s-r/free-google-search-results-serp---only-0-25-per-1-000-results"],
      requires_enrichment: true,
      confidence: 0.55,
    },

    // ── FUNDING ──────────────────────────────────────────────────────────────
    "memo23/crunchbase-scraper": {
      actor_id: "memo23/crunchbase-scraper",
      actor_name: "Crunchbase — 100K+ Instant Company DB, Funding Monitor",
      provider: "memo23",
      source_url: "https://apify.com/memo23/crunchbase-scraper",
      input_entities: ["query", "company_url", "company_name"],
      capabilities: ["funding_signal", "company_discovery", "company_enrichment"],
      best_for: [
        "investor discovery by stage, focus area and deal count",
        "company rows filtered by country, headcount band and operating status",
        "new-funding monitoring across repeated runs of the same input",
      ],
      not_for: [
        "funding AMOUNTS, dates or investor lists without a user-supplied session cookie",
        "any run where cost per row matters — it is the most expensive Actor registered",
      ],
      supported_filters: [
        "investorDatabase", "investorQuery", "investorType", "investorStage",
        "investorFocusArea", "investorCountry", "investorMinDeals",
        "instantDatabase", "dbQuery", "dbCountry", "dbEmployeeRange",
        "dbOperatingStatus", "startUrls", "fundingMonitor", "maxItems",
        "maxCacheAgeDays",
      ],
      verified_enums: {
        investorType: ["Venture Capital Investor", "Seed / Early-Stage VC", "Accelerator",
          "Angel Investor", "Government / Grant Program", "Debt / Bank"],
        investorStage: ["Pre Seed Round", "Seed Round", "Series A", "Series B", "Series C",
          "Series D", "Venture Round", "Convertible Note", "Angel Round", "Grant",
          "Debt Financing", "Private Equity Round", "Corporate Round"],
        dbEmployeeRange: ["1-10", "11-50", "51-100", "101-250", "251-500", "501-1000",
          "1001-5000", "5001-10000", "10001+"],
        dbOperatingStatus: ["active", "closed"],
      },
      input_limits: { maxItems: 1000 },
      output_fields: [],
      cost: {
        model: "PAY_PER_EVENT", start_usd: 0.01, per_result_usd: 0.008,
        notes: "4x the per-row cost of any other registered Actor. 100 rows is $0.81.",
      },
      adoption: { total_users: 80, monthly_users: 35, rating: null, rating_count: 0 },
      freshness: "firmographic",
      evidence_level: "verified_schema",
      last_verified_at: VERIFIED,
      verified_via: "apify_store_api",
      actor_modified_at: "2026-08-08",
      known_defects: [
        {
          id: "crunchbase_funding_is_cookie_gated",
          summary: "THE FUNDING FIELDS ARE NOT AVAILABLE BY DEFAULT. The Store " +
            "schema states that the amount, announced date and investors are " +
            "gated, and unlock only in 'LOGGED-IN MODE' with a Crunchbase " +
            "session cookie pasted from a real browser. Anonymous mode is " +
            "described by the vendor as 'signal-only', and is also capped at " +
            "15 results per search.",
          mitigation: "A mission that requires a funding AMOUNT cannot be served " +
            "by this Actor in an unattended deployment. Treat anonymous output " +
            "as 'a round happened', never as 'a round of $X happened'.",
        },
        {
          id: "crunchbase_no_rating_and_low_adoption",
          summary: "80 lifetime users, 35 monthly, and ZERO ratings. There is no " +
            "community evidence about its reliability at all.",
          mitigation: "Confidence is set accordingly. Do not make it a primary " +
            "source; corroborate anything it returns.",
        },
      ],
      fallback_actors: ["data_xplorer/google-news-scraper-fast"],
      requires_enrichment: true,
      confidence: 0.4,
    },

    // ── NEWS ─────────────────────────────────────────────────────────────────
    "data_xplorer/google-news-scraper-fast": {
      actor_id: "data_xplorer/google-news-scraper-fast",
      actor_name: "Google News Scraper (Pay Per Event)",
      provider: "data_xplorer",
      source_url: "https://apify.com/data_xplorer/google-news-scraper-fast",
      input_entities: ["query"],
      capabilities: ["news_signal", "funding_signal"],
      best_for: [
        "corroborating a funding or expansion claim from a second, independent source",
        "recent company news where the company is already named",
      ],
      not_for: [
        "company discovery — a news query returns ARTICLES, and an article is not a company",
        "anything requiring structured firmographics",
      ],
      supported_filters: [
        "keywords", "topics", "topicUrls", "maxArticles", "timeframe",
        "region_language", "decodeUrls", "extractDescriptions", "extractImages",
      ],
      verified_enums: {},
      input_limits: {},
      output_fields: [],
      cost: {
        model: "PAY_PER_EVENT", start_usd: 0, per_result_usd: 0.004,
        notes: "no start fee, which is what makes small corroboration runs viable",
      },
      adoption: { total_users: 1657, monthly_users: 431, rating: 4.9, rating_count: 5 },
      freshness: "realtime",
      evidence_level: "verified_schema",
      last_verified_at: VERIFIED,
      verified_via: "apify_store_api",
      actor_modified_at: "2026-08-15",
      known_defects: [
        {
          id: "news_name_collision",
          summary: "A keyword search matches any article containing the words. " +
            "Two companies sharing a name share their news.",
          mitigation: "Corroboration only, and only against a company already " +
            "identified by domain or LinkedIn URL.",
        },
      ],
      fallback_actors: ["crawlerbros/google-news-scraper"],
      requires_enrichment: true,
      confidence: 0.75,
    },

    // ── TECHNOLOGY ───────────────────────────────────────────────────────────
    "builtwith/builtwith-official-technology-scraper": {
      actor_id: "builtwith/builtwith-official-technology-scraper",
      actor_name: "BuiltWith Official Technology Scraper",
      provider: "builtwith",
      source_url: "https://apify.com/builtwith/builtwith-official-technology-scraper",
      // DOMAINS GO IN. This is the clearest case of the boundary in the header.
      input_entities: ["domain"],
      capabilities: ["technology_signal", "company_enrichment"],
      best_for: [
        "proving that a KNOWN company runs a given technology",
        "verifying a competitor-technology claim against the company's own site",
      ],
      not_for: [
        "technology-stack DISCOVERY — it cannot answer 'find companies using Shopify'. " +
          "Its only meaningful input is a list of domains you already have.",
        "competitor discovery by technology, for the same reason",
      ],
      supported_filters: ["startDomains", "maxRequestsPerCrawl"],
      verified_enums: {},
      input_limits: { maxRequestsPerCrawl: 10000000 },
      output_fields: [],
      cost: { model: "PAY_PER_EVENT", start_usd: 0, per_result_usd: 0.002 },
      adoption: { total_users: 556, monthly_users: 107, rating: 5, rating_count: 1 },
      freshness: "firmographic",
      evidence_level: "verified_schema",
      last_verified_at: VERIFIED,
      verified_via: "apify_store_api",
      actor_modified_at: "2026-03-20",
      known_defects: [
        {
          id: "builtwith_is_enrichment_not_discovery",
          summary: "The live input schema has exactly two fields: `startDomains` " +
            "and `maxRequestsPerCrawl`. There is no query, no technology filter " +
            "and no reverse lookup. It answers 'what does this domain run', never " +
            "'who runs this technology'.",
          mitigation: "Registered for enrichment only. The scenario matrix must " +
            "not offer it for any discovery scenario.",
        },
        {
          id: "builtwith_stalest_registered_actor",
          summary: "Last modified 2026-03-20 — five months before verification, " +
            "and the oldest of anything registered here. Rated 5.0 from a single rating.",
          mitigation: "Re-verify before relying on it for a new mission shape.",
        },
      ],
      fallback_actors: [],
      requires_enrichment: false,
      confidence: 0.6,
    },
  });

// ── ACCESSORS ────────────────────────────────────────────────────────────────

export function actorIntelligence(actorId: string): ActorIntelligenceRecord | null {
  return APIFY_INTELLIGENCE[actorId] ?? null;
}

/** Every registered Actor that can produce evidence of this kind. */
export function actorsWithCapability(c: ActorCapability): ActorIntelligenceRecord[] {
  return Object.values(APIFY_INTELLIGENCE).filter((a) => a.capabilities.includes(c));
}

/**
 * Actors that can DISCOVER — the ones a query alone can drive.
 *
 * This is the boundary from the header, enforced in one place. An Actor whose
 * only inputs are domains or URLs cannot start a search, however much its
 * capability list overlaps with what the mission wants.
 */
export function discoveryCapableActors(): ActorIntelligenceRecord[] {
  return Object.values(APIFY_INTELLIGENCE).filter((a) =>
    a.input_entities.includes("query") && a.capabilities.includes("company_discovery"));
}

/**
 * Is this record too old to spend against?
 *
 * Knowledge about an Actor decays: schemas change, Actors are abandoned, prices
 * move. A record nobody has re-verified is a guess wearing a verification date.
 */
export const STALE_AFTER_DAYS = 90;

export function recordIsStale(
  r: ActorIntelligenceRecord, now: Date = new Date(),
): boolean {
  const verified = Date.parse(`${r.last_verified_at}T00:00:00Z`);
  if (!Number.isFinite(verified)) return true;
  return (now.getTime() - verified) / 86_400_000 > STALE_AFTER_DAYS;
}

/**
 * The estimated cost of asking this Actor for `rows` rows.
 *
 * The start fee is why this is not `rows × per_result`: an Actor charging $0.09
 * to start and $0.005 a row costs more for a 20-row corroboration check than
 * one charging $0.004 a row and nothing to start — by a factor of four. That
 * comparison is invisible to a per-row price list, and it is the reason
 * `easyapi/google-news-scraper` is in `REJECTED_ACTORS`.
 */
export function estimatedCostUsd(r: ActorIntelligenceRecord, rows: number): number {
  return r.cost.start_usd + (r.cost.per_result_usd * Math.max(0, rows));
}

/** The registry as a model-readable briefing. No actor_id is ever invented from it. */
export function intelligenceBriefing(): Array<Record<string, unknown>> {
  return Object.values(APIFY_INTELLIGENCE).map((a) => ({
    actor_id: a.actor_id,
    input_entities: a.input_entities,
    capabilities: a.capabilities,
    best_for: a.best_for,
    not_for: a.not_for,
    supported_filters: a.supported_filters,
    verified_enums: a.verified_enums,
    input_limits: a.input_limits,
    freshness: a.freshness,
    cost_per_result_usd: a.cost.per_result_usd,
    cost_start_usd: a.cost.start_usd,
    adoption: a.adoption,
    confidence: a.confidence,
    requires_enrichment: a.requires_enrichment,
    known_defects: a.known_defects.map((d) => ({ id: d.id, summary: d.summary })),
  }));
}
