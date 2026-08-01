// OFFICIAL APIFY INPUT SCHEMAS, AS READ FROM THE PROVIDER.
//
// PR #122 shipped required-field rules for five capabilities. Only Crawlworks was
// re-read from Apify; the other four were inferred from our own compiler's output
// shape. That inference was wrong for two of them, in ways that would have let a
// bad payload through the very gate built to stop bad payloads:
//
//   * Glassdoor — `keywords` AND `location` are REQUIRED, and the result limit is
//     `limit`, not `maxItems`. The inferred rule required neither and accepted
//     `query` as an alias for `keywords`, which the actor does not recognise.
//   * ATS — requires `companies` or `presetLists`. The inferred rule required
//     nothing, so an ATS call with no company identity would have passed local
//     validation and run as unrestricted market discovery, which the product
//     contract forbids.
//   * YC — exposes `searchQuery`, not `query`, and has NO recency filter at all.
//   * Indeed — `datePosted` accepts ONLY "" | "1" | "3" | "7" | "14". The prose
//     enum ("last 24 hours", "3 days"...) shipped in PR #123 was rejected by the
//     live actor in production run b59b422b. See `indeedDatePostedBucket`.
//
// This module is the versioned record of what was actually verified, so the rules
// in `finalActorPayload.ts` and the compilers in `actorInputPlanner.ts` can be
// tested against provider truth rather than against each other.
//
// NO CREDENTIALS. Field names, types and enum values only — the same information
// the public actor page shows.

export const ACTOR_SCHEMA_FIXTURE_VERSION = "actor-schema-fixtures-1.0.0";

export interface ActorSchemaFixture {
  actorId: string;
  capabilityKey: string;
  /** ISO date the published input schema was read. */
  retrievedOn: string;
  source: string;
  /** Fields the actor rejects the run without. */
  required: string[];
  /** At least one member of each group is needed. */
  requiredAnyOf: string[][];
  /** Every field the schema documents. */
  supported: string[];
  /** Documented enum values, by field. */
  enums: Record<string, string[]>;
  /** The field that caps returned rows, and its documented maximum. */
  resultLimit: { field: string; max: number | null; default: number | null } | null;
  /** The field expressing posting recency, and the longest window it can express. */
  recency: { field: string; maxDays: number | null; kind: "enum" | "integer_days" | "seconds" | "none" };
  notes: string[];
}

/**
 * The five dynamic hiring-source actors.
 *
 * Crawlworks was verified in PR #122 and re-confirmed here; the other four were
 * verified for the first time on 2026-07-30.
 */
export const ACTOR_SCHEMA_FIXTURES: Record<string, ActorSchemaFixture> = {
  indeed_job_discovery: {
    actorId: "automation-lab/indeed-scraper",
    capabilityKey: "indeed_job_discovery",
    retrievedOn: "2026-07-30",
    source: "apify.com/automation-lab/indeed-scraper/input-schema",
    required: [],
    requiredAnyOf: [["query", "urls"]],
    supported: ["query", "location", "country", "maxItems", "jobType", "datePosted", "includeDescription", "urls", "maxRequestRetries"],
    enums: {
      jobType: ["fulltime", "parttime", "contract", "temporary", "internship"],
      // FOUR NUMERIC-STRING DAY BUCKETS, plus "" for no filter. Verified against
      // the LIVE actor on 2026-08-01: production run b59b422b was rejected with
      // `apify_input_schema_error` listing exactly "", "1", "3", "7", "14".
      datePosted: ["1", "3", "7", "14"],
      country: ["US", "UK", "CA", "AU", "IN", "DE", "FR", "NL", "BE", "CH", "AT", "IT", "ES", "BR", "MX", "JP", "SG", "HK"],
    },
    resultLimit: { field: "maxItems", max: null, default: 50 },
    recency: { field: "datePosted", maxDays: 14, kind: "enum" },
    notes: [
      "maxItems: 0 means unlimited — never send 0 for a bounded run.",
      "datePosted values are numeric day strings; \"\" means no recency filter.",
      "datePosted cannot express 30, 45 or 60 days. The 60-day policy is unenforceable provider-side here and must be applied after normalization.",
    ],
  },

  linkedin_job_discovery: {
    actorId: "crawlworks/linkedin-jobs-scraper",
    capabilityKey: "linkedin_job_discovery",
    retrievedOn: "2026-07-30",
    source: "apify.com/crawlworks/linkedin-jobs-scraper/input-schema",
    required: [],
    requiredAnyOf: [["searchUrls", "query"]],
    supported: [
      "searchUrls", "query", "location", "timePostedRange", "jobsToFetch", "enrichCompanyDetails",
      "fullTime", "partTime", "contract", "temporary", "volunteer", "internship",
      "internshipLevel", "entryLevel", "associate", "midSeniorLevel", "director", "executive",
      "onSite", "remote", "hybrid",
    ],
    enums: {},
    resultLimit: { field: "jobsToFetch", max: 1000, default: null },
    recency: { field: "timePostedRange", maxDays: 30, kind: "seconds" },
    notes: [
      "searchUrls accepts up to 3 URLs per run.",
      "timePostedRange is expressed in seconds; the documented ladder tops out at 30 days.",
    ],
  },

  glassdoor_job_discovery: {
    actorId: "valig/glassdoor-jobs-scraper",
    capabilityKey: "glassdoor_job_discovery",
    retrievedOn: "2026-07-30",
    source: "apify.com/valig/glassdoor-jobs-scraper/input-schema",
    // BOTH REQUIRED. The inferred rule required neither.
    required: ["keywords", "location"],
    requiredAnyOf: [],
    supported: ["keywords", "location", "daysOld", "easyApply", "remoteWorkType", "minRating", "radius", "employerSizes", "sortBy", "limit", "urlParam", "excludeJobIds"],
    enums: { sortBy: ["relevant_desc", "date_desc"] },
    resultLimit: { field: "limit", max: 1000, default: 100 },
    // The only actor of the five that can express the full 60-day policy directly.
    recency: { field: "daysOld", maxDays: null, kind: "integer_days" },
    notes: [
      "daysOld is a free integer, so 30/45/60 are all directly expressible.",
      "The limit field is `limit` — NOT maxItems and NOT jobsToFetch.",
      "minRating is 0.0-5.0.",
    ],
  },

  yc_job_discovery: {
    actorId: "parsebird/yc-jobs-scraper",
    capabilityKey: "yc_job_discovery",
    retrievedOn: "2026-07-30",
    source: "apify.com/parsebird/yc-jobs-scraper/input-schema",
    required: [],
    requiredAnyOf: [],
    supported: ["searchQuery", "roleFilter", "locationFilter", "maxResults"],
    enums: {
      roleFilter: ["software-engineer", "designer", "product-manager", "data-scientist", "sales", "marketing", "support", "operations", "recruiting", "science"],
    },
    resultLimit: { field: "maxResults", max: null, default: 100 },
    // NO recency field exists. A recency policy cannot be expressed here at all.
    recency: { field: "", maxDays: null, kind: "none" },
    notes: [
      "The query field is `searchQuery`. There is no `query` field.",
      "No recency filter exists — the 60-day rule is enforceable only after normalization.",
      "locationFilter matches the JOB's location, not company HQ.",
      "roleFilter is a fixed enum; `operations` and `sales` are the relevant members for a RevOps mission.",
    ],
  },

  ats_job_verification: {
    actorId: "bovi/greenhouse-lever-ashby-job-scraper",
    capabilityKey: "ats_job_verification",
    retrievedOn: "2026-07-30",
    source: "apify.com/bovi/greenhouse-lever-ashby-job-scraper/input-schema",
    required: [],
    // `companies` is what makes this company-scoped verification rather than
    // market discovery. `presetLists` is deliberately NOT accepted as an
    // alternative by our policy — see finalActorPayload.
    requiredAnyOf: [["companies", "presetLists"]],
    supported: ["companies", "presetLists", "titleKeyword", "locationKeyword", "remoteOnly", "maxJobsPerCompany", "includeDescriptions", "onlyNewSinceLastRun", "outputProfile", "reportMode", "keywords", "recentWindowDays"],
    enums: {
      outputProfile: ["full", "compact", "minimal"],
      "companies[].ats": ["greenhouse", "lever", "ashby", "recruitee", "smartrecruiters", "personio"],
      presetLists: ["top-tech", "ai-ml", "devtools", "fintech"],
    },
    resultLimit: { field: "maxJobsPerCompany", max: null, default: null },
    recency: { field: "recentWindowDays", maxDays: null, kind: "integer_days" },
    notes: [
      "companies[] items are { ats, company } where company is the career-board slug.",
      "presetLists would make this unrestricted discovery, which the product contract forbids for this capability.",
      "recentWindowDays applies to reportMode only.",
    ],
  },
};

export function schemaFixtureFor(capabilityKey: string): ActorSchemaFixture | null {
  return ACTOR_SCHEMA_FIXTURES[capabilityKey] ?? null;
}

/** Is this value one the provider actually documents for this field? */
export function isDocumentedEnumValue(capabilityKey: string, field: string, value: unknown): boolean {
  const fx = schemaFixtureFor(capabilityKey);
  const allowed = fx?.enums[field];
  if (!allowed) return true;            // no documented enum ⇒ nothing to violate
  if (value === "" || value == null) return true;  // "unset" is always safe
  return allowed.includes(String(value));
}

/** Every field name this actor documents. Used to reject invented fields. */
export function supportedFieldsFor(capabilityKey: string): string[] {
  return schemaFixtureFor(capabilityKey)?.supported ?? [];
}
