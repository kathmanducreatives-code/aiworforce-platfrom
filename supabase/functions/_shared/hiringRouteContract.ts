// THE VALIDATED HIRING ROUTE — GPT proposes, Agentory disposes.
//
// The old default was broad-job-first: run country-wide Indeed/Glassdoor/LinkedIn
// job searches, then reject unsuitable companies afterwards. For a tight ICP that
// is backwards — it pays for thousands of rows to discard nearly all of them, and
// it hands Company Brain weak provider company fields instead of real evidence.
//
// This module lets the EXISTING strategist choose one of three bounded routes and
// then validates that choice deterministically. GPT has authority over WHICH
// route and in WHAT order; it has no authority to invent a source, exceed a
// verified Actor limit, or reach a broad job board without a recorded reason.
//
// Pure. No I/O, no model calls.

import { HIRING_ACTOR_CATALOG } from "./hiringActorCatalog.ts";

export type HiringRoute =
  | "startup_company_first"
  | "general_company_first"
  | "broad_job_fallback";

/** Why a broad job board was allowed. A fallback with no reason is a bug. */
export type FallbackReason =
  | "primary_source_unavailable"
  | "primary_source_no_candidates"
  | "no_identities_resolved"
  | "insufficient_company_fit_passes"
  | "insufficient_hiring_matches"
  | "remaining_quota_justifies_round"
  | "user_requested_broad_coverage";

export const FALLBACK_REASONS: readonly FallbackReason[] = [
  "primary_source_unavailable", "primary_source_no_candidates", "no_identities_resolved",
  "insufficient_company_fit_passes", "insufficient_hiring_matches",
  "remaining_quota_justifies_round", "user_requested_broad_coverage",
];

/** Discovery sources each route may use, in the order they are allowed. */
export const ROUTE_SOURCES: Readonly<Record<HiringRoute, readonly string[]>> = Object.freeze({
  startup_company_first: ["apify_yc_companies_memo23", "apify_yc_companies_solidcode"],
  general_company_first: ["apify_linkedin_company_search"],
  broad_job_fallback: ["apify_jobs", "apify_indeed_jobs", "apify_glassdoor_jobs",
    "apify_linkedin_jobs_crawlworks", "apify_indeed_jobs_automation_lab"],
});

/** Every company-first route enriches before it qualifies. Not optional. */
export const ENRICHMENT_ACTOR = "apify_linkedin_company_details";
export const HIRING_VERIFICATION_ACTOR = "apify_linkedin_job_search";
export const FOUNDER_ACTOR = "apify_linkedin_company_employees";
export const FOUNDER_FALLBACK_ACTOR = "apify_people_search";

export interface RouteRequest {
  /** What GPT asked for. Recorded even when repaired. */
  route: string;
  source_order?: string[];
  role_pack_order?: string[];
  fallback_reason?: string | null;
}

export interface ValidatedRoute {
  ok: true;
  requested_route: string;
  validated_route: HiringRoute;
  /** Sources in the order they will actually execute. */
  validated_source_order: string[];
  role_pack_order: string[];
  enrichment_required: boolean;
  fallback_reason: FallbackReason | null;
  /** Non-empty when the request was changed. Persisted for audit. */
  repairs: string[];
}

export interface RouteRejection {
  ok: false;
  requested_route: string;
  errors: string[];
}

export type RouteResolution = ValidatedRoute | RouteRejection;

const ROUTES: readonly HiringRoute[] =
  ["startup_company_first", "general_company_first", "broad_job_fallback"];

/**
 * Startup intent, read from the user's own words.
 *
 * Deliberately narrow: these words describe a COMPANY STAGE. Generic industry or
 * geography language is not startup intent and belongs on the general route.
 */
const STARTUP_MARKERS = [
  "yc", "y combinator", "ycombinator", "startup", "start-up", "early stage",
  "early-stage", "seed stage", "seed-stage", "venture backed", "venture-backed",
  "pre-seed", "series a", "founding team",
];

/** SaaS alone is not startup intent — plenty of SaaS companies are enterprises. */
export function inferRouteFromRequest(userRequest: string | null | undefined): HiringRoute {
  const t = (userRequest ?? "").toLowerCase();
  if (STARTUP_MARKERS.some((m) => t.includes(m))) return "startup_company_first";
  return "general_company_first";
}

/**
 * Validate and compile GPT's route choice.
 *
 * REPAIRS, never silent substitutions: an unknown route falls back to the
 * request-inferred one and says so; an out-of-route source is dropped and named.
 * The one thing that is never repaired is a broad-job fallback with no reason —
 * that returns an error, because inventing a justification for spending money on
 * a job board is exactly the decision a human should see.
 */
export function validateHiringRoute(
  req: RouteRequest,
  ctx: { userRequest?: string | null; roundIndex?: number } = {},
): RouteResolution {
  const repairs: string[] = [];
  const errors: string[] = [];

  let route = req.route as HiringRoute;
  if (!ROUTES.includes(route)) {
    const inferred = inferRouteFromRequest(ctx.userRequest);
    repairs.push(`unknown_route_replaced:${req.route}->${inferred}`);
    route = inferred;
  }

  // A BROAD JOB BOARD NEEDS A REASON. This is the rule that stops the old
  // behaviour creeping back in as a "temporary" default.
  let fallback: FallbackReason | null = null;
  if (route === "broad_job_fallback") {
    const r = req.fallback_reason as FallbackReason | undefined | null;
    if (!r || !FALLBACK_REASONS.includes(r)) {
      errors.push(
        `broad_job_fallback requires a structured fallback_reason (one of: ${FALLBACK_REASONS.join(", ")}); ` +
        `got ${r ? `"${r}"` : "none"}`,
      );
    } else {
      fallback = r;
    }
  } else if (req.fallback_reason) {
    repairs.push(`fallback_reason_ignored_on_non_fallback_route:${req.fallback_reason}`);
  }

  if (errors.length) return { ok: false, requested_route: req.route, errors };

  // SOURCE ORDER: GPT may order the route's own sources; it may not add others.
  const allowed = ROUTE_SOURCES[route];
  const requested = req.source_order ?? [];
  const kept: string[] = [];
  for (const s of requested) {
    if (!allowed.includes(s)) { repairs.push(`source_not_in_route_dropped:${s}`); continue; }
    if (kept.includes(s)) { repairs.push(`duplicate_source_dropped:${s}`); continue; }
    kept.push(s);
  }
  for (const s of allowed) if (!kept.includes(s)) kept.push(s);

  // memo23 is primary on the startup route; solidcode is fallback ONLY. If GPT
  // ordered them the other way, the order is corrected and the change recorded.
  if (route === "startup_company_first") {
    const primary = "apify_yc_companies_memo23";
    if (kept[0] !== primary) {
      repairs.push(`solidcode_is_fallback_only_reordered:${kept.join(">")}`);
      kept.splice(kept.indexOf(primary), 1);
      kept.unshift(primary);
    }
  }

  return {
    ok: true,
    requested_route: req.route,
    validated_route: route,
    validated_source_order: kept,
    role_pack_order: (req.role_pack_order ?? []).filter((p) => typeof p === "string"),
    // Broad-job companies still get enriched — the fallback changes WHERE
    // candidates come from, never whether they must be proven.
    enrichment_required: true,
    fallback_reason: fallback,
    repairs,
  };
}

/** The persisted route record. Requested vs validated vs executed, never merged. */
export interface RouteExecutionRecord {
  requested_route: string;
  validated_route: HiringRoute;
  executed_route: HiringRoute | null;
  requested_source_order: string[];
  validated_source_order: string[];
  executed_source_order: string[];
  fallback_reason: FallbackReason | null;
  repairs: string[];
  enrichment_required: boolean;
}

export function newRouteExecutionRecord(
  v: ValidatedRoute, requestedOrder: string[],
): RouteExecutionRecord {
  return {
    requested_route: v.requested_route,
    validated_route: v.validated_route,
    executed_route: null,
    requested_source_order: requestedOrder,
    validated_source_order: v.validated_source_order,
    executed_source_order: [],
    fallback_reason: v.fallback_reason,
    repairs: v.repairs,
    enrichment_required: v.enrichment_required,
  };
}

/**
 * Record that a source actually ran.
 *
 * The executed order is appended from real execution, never copied from the
 * plan — that is what makes "the runtime silently rebuilt a different order"
 * detectable instead of invisible.
 */
export function recordExecutedSource(rec: RouteExecutionRecord, actorKey: string): void {
  if (!rec.executed_source_order.includes(actorKey)) rec.executed_source_order.push(actorKey);
  if (rec.executed_route === null) rec.executed_route = rec.validated_route;
}

/** Did execution follow the validated plan? Surfaced in task diagnostics. */
export function routeDrift(rec: RouteExecutionRecord): string[] {
  const drift: string[] = [];
  for (const s of rec.executed_source_order) {
    if (!rec.validated_source_order.includes(s)) drift.push(`executed_unplanned_source:${s}`);
  }
  const plannedPrefix = rec.validated_source_order
    .filter((s) => rec.executed_source_order.includes(s));
  if (plannedPrefix.join(">") !== rec.executed_source_order.filter(
    (s) => rec.validated_source_order.includes(s)).join(">")) {
    drift.push("executed_order_differs_from_validated_order");
  }
  return drift;
}

/**
 * The Actor-limitation briefing GPT must SEE — not merely be hashed over.
 *
 * Built from the merged capability catalog so it cannot drift from the cards.
 */
export function actorLimitationBriefing(): Array<{ actor_key: string; actor_id: string; limits: string[] }> {
  return Object.values(HIRING_ACTOR_CATALOG).map((c) => ({
    actor_key: c.actor_key,
    actor_id: c.actor_id,
    limits: [
      // Hard input limits belong in the briefing too: GPT plans batch sizes, so
      // "at most 10 companies per call" has to be visible when it plans, not
      // discovered when the compiler rejects the plan.
      ...Object.entries(c.input_limits).map(([k, v]) => `limit: ${k} = ${v}`),
      ...c.not_for.map((x) => `not_for: ${x}`),
      ...c.known_defects.map((d) => `defect: ${d.summary} => ${d.mitigation}`),
      ...(c.requires_enrichment_before_qualification
        ? ["enrichment is MANDATORY before Company Brain qualification"] : []),
    ],
  }));
}
