// THE REVIEWED BUILD OF EVERY PIPELINE ACTOR, AND THE INPUT FIELDS IT ACCEPTS (V5 phase C).
//
// A run names its build (`build=<number>`), so a publisher's new version is never run unreviewed:
// a build Apify no longer has fails the start with a 4xx (nothing bought). The plan carries the
// build of each step, so the signed plan hash binds Actor + build + (for discovery) the input.
//
// `inputKeys` are the property names of that build's input schema, as read from Apify on
// 2026-11-21 (public `GET /v2/actor-builds/{id}` → `inputSchema`; free, read-only). The
// invoker refuses an input with any other key BEFORE a start: a misspelt filter is otherwise
// silently ignored by the Actor and the run bills for an unfiltered search.
// To review a new build: re-read the schema, update `build` and `inputKeys` together, re-run
// the simulator and the actorInputBinding / apifyRuns tests.

export interface ReviewedBuild {
  actorId: string;
  /** Apify build NUMBER (a tag such as `latest` would move under us). */
  build: string;
  reviewedAt: string;
  /** For an Actor with a long schema, the fields we send (each verified present in the build). */
  inputKeys: readonly string[];
}

const POSTS_KEYS = ["targetUrls", "maxPosts", "postedLimit", "postedLimitDate", "includeQuotePosts", "includeReposts", "scrapeReactions", "maxReactions",
  "scrapeComments", "maxComments", "commentsPostedLimit", "contextCountry"] as const;

export const ACTOR_BUILDS: Readonly<Record<string, ReviewedBuild>> = Object.freeze({
  apify_linkedin_company_details: { actorId: "harvestapi/linkedin-company", build: "0.0.46", reviewedAt: "2026-11-21", inputKeys: ["companies", "searches"] },
  apify_linkedin_profile_posts: { actorId: "harvestapi/linkedin-profile-posts", build: "0.0.86", reviewedAt: "2026-11-21", inputKeys: POSTS_KEYS },
  apify_linkedin_company_posts: { actorId: "harvestapi/linkedin-company-posts", build: "0.0.54", reviewedAt: "2026-11-21", inputKeys: POSTS_KEYS },
  apify_linkedin_job_search: { actorId: "harvestapi/linkedin-job-search", build: "0.0.62", reviewedAt: "2026-11-21",
    inputKeys: ["jobTitles", "locations", "maxItems", "company", "workplaceType", "employmentType", "experienceLevel", "salary", "under10Applicants", "easyApply",
      "postedLimit", "industryIds", "functionIds", "sortBy", "geoIds", "page"] },
  apify_linkedin_company_search: { actorId: "harvestapi/linkedin-company-search", build: "0.0.21", reviewedAt: "2026-11-21",
    inputKeys: ["scraperMode", "maxItems", "searchQuery", "locations", "industryIds", "companySize", "startPage", "takePages"] },
  // `version-0` resolved to 0.3.107 on 2026-11-21; the schema has 52 fields, these are the ones we send.
  apify_website_content: { actorId: "apify/website-content-crawler", build: "0.3.107", reviewedAt: "2026-11-21",
    inputKeys: ["startUrls", "crawlerType", "maxCrawlDepth", "maxCrawlPages", "maxResults", "saveMarkdown", "saveHtml", "removeCookieWarnings"] },
});

/** The reviewed build of an Actor key, or null when it has none (the run is refused). */
export const reviewedBuild = (actorKey: string): ReviewedBuild | null => ACTOR_BUILDS[actorKey] ?? null;

/** Keys in `input` that the reviewed build's schema does not have. Empty = acceptable. */
export function unknownInputKeys(actorKey: string, input: Record<string, unknown>): string[] {
  const b = reviewedBuild(actorKey);
  if (!b) return Object.keys(input);
  return Object.keys(input).filter((k) => !b.inputKeys.includes(k));
}
