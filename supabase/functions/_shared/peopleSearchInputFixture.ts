// Frozen fixture for the HarvestAPI people-search input-quality failure.
// Source: live Q1 run q1-routing-fix-20260714T135027Z, plan
// 18ca455c-50be-471d-9e89-efa1f2d420cd — 3 actor runs, all succeeded, 0 items.
//
// All three attempts received the IDENTICAL payload below (searchQuery carried a
// natural-language AI instruction; no currentJobTitles / locations / takePages;
// no materially distinct retry strategy). Actor: harvestapi/linkedin-profile-search.

/** The Scout-step instruction that reached run-agent (AI-planner generated). */
export const FROZEN_Q1_SCOUT_INSTRUCTION =
  "Use apify_people_search to find 10-15 founders or co-founders of B2B SaaS and AI SaaS companies in the United States with 10-150 employees.";

/** The original end-user query. */
export const FROZEN_Q1_USER_INSTRUCTION =
  "Using my ICP, find me 5 hot founders I should contact right now.";

/** The generic input the current adapter received for the failed run. */
export const FROZEN_Q1_GENERIC_INPUT = {
  query: FROZEN_Q1_SCOUT_INSTRUCTION,
  location: null as string | null,
  role_keywords: [] as string[], // "founders" failed the \bfounder\b role regex
  max_results: 5,
} as const;

/** The exact malformed payload observed on all three live actor runs. */
export const FROZEN_MALFORMED_PAYLOAD = {
  profileScraperMode: "Full",
  searchQuery:
    "Use apify_people_search to find 10-15 founders or co-founders of B2B SaaS and AI SaaS companies in the United States with 10-150 employees.",
  maxItems: 5,
  startPage: 1,
} as const;

/** What all three live attempts shared (identical → no broadening). */
export const FROZEN_ATTEMPT_FACTS = {
  attempts: 3,
  all_succeeded: true,
  items_each: 0,
  approx_cost_per_run_usd: 0.1,
  identical_attempts: true,
  had_currentJobTitles: false,
  had_locations: false,
  had_takePages: false,
  searchQuery_contained_meta_instruction: true,
  searchQuery_contained_requested_count: true, // "10-15"
} as const;
