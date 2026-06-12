// Phase 3 — input adapters for the LinkedIn engagement actors.
//   apify_linkedin_posts          → harvestapi/linkedin-post-search  (keyword/topic search)
//   apify_linkedin_profile_posts  → harvestapi/linkedin-profile-posts (posts from given URLs)
// Pure / import-free so both are unit-testable in Node + Deno. Builds the
// actor's official payload shape and NEVER forwards arbitrary user_input.

const MAX_SAFE = 20;
const DEFAULT_MAX = 10;

type PostedLimit = "24h" | "week" | "month" | "3months" | "6months" | "year";
type SortBy = "relevance" | "date";

export interface LinkedinPostSearchArgs {
  query?: string | null;
  keywords?: string[] | null;
  topics?: string[] | null;
  max_results?: number | null;
  location?: string | null;
  roles?: string[] | null;
  companies?: string[] | null;
  user_input?: Record<string, unknown> | null;
}

export interface LinkedinProfilePostsArgs {
  targetUrls?: string[] | null;
  profile_urls?: string[] | null;
  company_urls?: string[] | null;
  max_results?: number | null;
  user_input?: Record<string, unknown> | null;
}

export interface ProfilePostsResult {
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: string;
  clarification?: string;
}

function clampMax(n: number | null | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_MAX;
  return Math.max(1, Math.min(MAX_SAFE, Math.floor(n)));
}

function cleanStrings(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return arr.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim());
}

const POSTED_LIMITS: PostedLimit[] = ["24h", "week", "month", "3months", "6months", "year"];
function coercePostedLimit(v: unknown, fallback: PostedLimit): PostedLimit {
  return POSTED_LIMITS.includes(v as PostedLimit) ? (v as PostedLimit) : fallback;
}
function coerceSortBy(v: unknown, fallback: SortBy): SortBy {
  return v === "relevance" || v === "date" ? v : fallback;
}

// Extract LinkedIn company public identifiers from company URLs, e.g.
// https://linkedin.com/company/acme → "acme".
function companyPublicIds(urls: string[]): string[] {
  const ids: string[] = [];
  for (const u of urls) {
    const m = u.match(/linkedin\.com\/company\/([A-Za-z0-9_\-%.]+)/i);
    if (m) ids.push(decodeURIComponent(m[1]));
  }
  return ids;
}

/**
 * apify_linkedin_posts (keyword/topic post search).
 * - searchQueries from keywords ?? topics ?? query (deduped)
 * - maxPosts clamped to [1,20], default 10
 * - comments limited by default (scrapeComments:true, maxComments:5)
 * - reactions OFF by default
 * - only whitelisted user_input overrides are honored
 */
export function buildLinkedinEngagementInput(args: LinkedinPostSearchArgs): Record<string, unknown> {
  const maxPosts = clampMax(args.max_results);
  const ui = (args.user_input ?? {}) as Record<string, unknown>;

  const terms = Array.from(new Set([
    ...cleanStrings(args.keywords),
    ...cleanStrings(args.topics),
    ...(typeof args.query === "string" && args.query.trim() ? [args.query.trim()] : []),
  ]));

  const companies = cleanStrings(args.companies);
  const companyIds = companyPublicIds(companies);

  const payload: Record<string, unknown> = {
    searchQueries: terms,
    scrapeComments: typeof ui.scrapeComments === "boolean" ? ui.scrapeComments : true,
    maxComments: typeof ui.maxComments === "number" ? Math.max(0, Math.min(20, Math.floor(ui.maxComments))) : 5,
    scrapeReactions: typeof ui.scrapeReactions === "boolean" ? ui.scrapeReactions : false,
    maxReactions: typeof ui.maxReactions === "number" ? Math.max(0, Math.min(20, Math.floor(ui.maxReactions))) : 0,
    postedLimit: coercePostedLimit(ui.postedLimit, "week"),
    sortBy: coerceSortBy(ui.sortBy, "date"),
    maxPosts,
    startPage: typeof ui.startPage === "number" ? Math.max(1, Math.floor(ui.startPage)) : 1,
  };

  const targetUrls = cleanStrings((args.user_input as any)?.targetUrls);
  if (targetUrls.length > 0) payload.targetUrls = targetUrls;
  if (companyIds.length > 0) payload.authorsCompanyPublicIdentifiers = companyIds;

  return payload;
}

/**
 * apify_linkedin_profile_posts (posts from specific profile/company URLs).
 * Returns { ok:false, clarification } when no target URLs are supplied —
 * the caller should ask for URLs instead of running the actor.
 */
export function buildLinkedinProfilePostsInput(args: LinkedinProfilePostsArgs): ProfilePostsResult {
  const ui = (args.user_input ?? {}) as Record<string, unknown>;
  const urls = Array.from(new Set([
    ...cleanStrings(args.targetUrls),
    ...cleanStrings(args.profile_urls),
    ...cleanStrings(args.company_urls),
    ...cleanStrings((args.user_input as any)?.targetUrls),
  ])).filter((u) => /linkedin\.com\//i.test(u));

  if (urls.length === 0) {
    return {
      ok: false,
      error: "missing_target_urls",
      clarification:
        "Which LinkedIn profile or company page should I pull recent posts from? Paste one or more LinkedIn URLs.",
    };
  }

  const payload: Record<string, unknown> = {
    targetUrls: urls,
    maxPosts: clampMax(args.max_results),
    scrapeComments: typeof ui.scrapeComments === "boolean" ? ui.scrapeComments : true,
    maxComments: typeof ui.maxComments === "number" ? Math.max(0, Math.min(20, Math.floor(ui.maxComments))) : 5,
    scrapeReactions: typeof ui.scrapeReactions === "boolean" ? ui.scrapeReactions : false,
    maxReactions: typeof ui.maxReactions === "number" ? Math.max(0, Math.min(20, Math.floor(ui.maxReactions))) : 0,
    postedLimit: coercePostedLimit(ui.postedLimit, "month"),
    startPage: typeof ui.startPage === "number" ? Math.max(1, Math.floor(ui.startPage)) : 1,
  };
  return { ok: true, payload };
}
