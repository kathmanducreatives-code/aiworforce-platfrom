// Phase 3 — input adapter for the LinkedIn Posts / Engagement actor
// (apify_linkedin_posts). The exact actor schema is operator-configured, so
// this builds a conservative, safe payload and NEVER forwards arbitrary
// user_input. Pure / import-free so it is unit-testable in Node + Deno.

export interface LinkedinEngagementInputArgs {
  query?: string | null;
  keywords?: string[] | null;
  topics?: string[] | null;
  max_results?: number | null;
  location?: string | null;
  roles?: string[] | null;
  companies?: string[] | null;
  user_input?: Record<string, unknown> | null;
}

const MAX_SAFE = 20;
const DEFAULT_MAX = 10;

// Only these keys from caller-supplied user_input are ever forwarded. Anything
// else (raw selectors, cookies, proxy config, arbitrary fields) is dropped.
const ALLOWED_USER_INPUT_KEYS = ["language", "postedLimit", "recency", "sortBy"] as const;

function clampMax(n: number | null | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_MAX;
  return Math.max(1, Math.min(MAX_SAFE, Math.floor(n)));
}

function cleanStrings(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return arr.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim());
}

/**
 * Build a safe Apify run payload for the LinkedIn engagement actor.
 * - max items clamped to [1, 20], default 10.
 * - search terms derived from keywords ?? topics ?? query (deduped).
 * - only a whitelist of user_input keys is forwarded.
 */
export function buildLinkedinEngagementInput(args: LinkedinEngagementInputArgs): Record<string, unknown> {
  const count = clampMax(args.max_results);

  const fromKeywords = cleanStrings(args.keywords);
  const fromTopics = cleanStrings(args.topics);
  const fromQuery = typeof args.query === "string" && args.query.trim() ? [args.query.trim()] : [];
  // Prefer explicit keywords, then topics, then the free-text query.
  const terms = Array.from(new Set([...fromKeywords, ...fromTopics, ...fromQuery]));
  const searchQueries = terms.length > 0 ? terms : (fromQuery.length > 0 ? fromQuery : []);

  const payload: Record<string, unknown> = {
    // Common field names across LinkedIn post actors — harmless if ignored.
    searchQueries,
    keywords: searchQueries.join(" ") || null,
    maxItems: count,
    maxPosts: count,
  };

  const companies = cleanStrings(args.companies);
  if (companies.length > 0) payload.companies = companies;
  if (typeof args.location === "string" && args.location.trim()) payload.location = args.location.trim();

  // Whitelisted passthrough only.
  const ui = args.user_input ?? {};
  for (const k of ALLOWED_USER_INPUT_KEYS) {
    const v = (ui as Record<string, unknown>)[k];
    if (v !== undefined && v !== null) payload[k] = v;
  }

  return payload;
}
