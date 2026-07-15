// Frozen fixture for the planner-induced actor flip (live Q1
// q1-country-fix-20260715T072511Z, plan da79cba3-e87c-42ab-8ef8-844aeb740415).
//
// The user asked for FOUNDERS (person). orchestrate's planner rewrote the Scout
// step to mention "hiring signals for RevOps or Sales". run-agent routed off the
// rewritten Scout prose (not the original user instruction), so extractLeadDetails
// matched HIRING_HINT → mode="hiring" → apify_jobs, and 4 SALES JOB postings were
// persisted instead of founders.

/** The immutable, authoritative user request. */
export const ORIGINAL_USER_INSTRUCTION =
  "Using my ICP, find me 5 hot founders I should contact right now.";

/** The planner-rewritten Scout step instruction (non-authoritative descriptive prose). */
export const PLANNER_SCOUT_INSTRUCTION =
  "Search for 5-10 founders matching the active ICP, focusing on those showing hiring signals for RevOps or Sales.";

/** What the current production path (routing off the Scout prose) produces — WRONG. */
export const CURRENT_WRONG_ROUTE = {
  kind: "jobs",
  source_type: "hiring_signal",
  actor_key: "apify_jobs",
} as const;

/** The required route for a founder (person) request. */
export const REQUIRED_ROUTE = {
  target_entity: "person",
  kind: "people",
  actor_key: "apify_people_search",
} as const;

/** The four off-target rows persisted by the failed run (jobs, not founders).
 *  Recorded for the cleanup manifest — NEVER deleted or modified by this branch. */
export const FROZEN_WRONG_PERSISTED_ROWS = [
  { lead_type: "company", fit_score: 20, source_url: "https://www.linkedin.com/jobs/view/sales-representative-at-flagpoles-etc-4412229384" },
  { lead_type: "company", fit_score: 20, source_url: "https://www.linkedin.com/jobs/view/inside-sales-specialist-demand-side-management-at-xcel-energy-4431148792" },
  { lead_type: "company", fit_score: 28, source_url: "https://www.linkedin.com/jobs/view/inside-sales-specialist-at-pursuit-4436103505" },
  { lead_type: "company", fit_score: 28, source_url: "https://www.linkedin.com/jobs/view/sales-development-representative-at-level-data-4103454950" },
] as const;

export const FROZEN_FAILED_PLAN_ID = "da79cba3-e87c-42ab-8ef8-844aeb740415";
export const FROZEN_PROVIDER_RUN_ID = "6a8cec79-5df1-401c-baf8-8cb5b7d462ba";
