// VERSIONED, PROVIDER-INDEPENDENT BROADENING PLAN + typed planner interface +
// deterministic fallback planner.
//
// An AI may PROPOSE strategy. It never invokes a provider, never sets a limit or a
// budget, and never touches a hard constraint. Everything it returns is typed data
// that must survive deterministic validation before a single paid call happens.
//
// Actor-native JSON deliberately does NOT appear here — the plan stays
// provider-independent and is translated by the existing actor adapters.

import type { HardConstraints, SoftConstraints, SourcingConstraints } from "./sourcingConstraints.ts";
import { approvedTitlesFor, getJobFamily } from "./jobFamilyRegistry.ts";
import { canonicalJson, shortHash } from "./planHash.ts";
import type { BottleneckKind, FunnelSummary } from "./sourcingBottleneck.ts";

export const BROADENING_PLAN_SCHEMA_VERSION = "1.0.0";
export const DETERMINISTIC_PLANNER_VERSION = "deterministic-1.0.0";
export const VALIDATOR_VERSION = "broadening-validator-1.0.0";
export const COST_POLICY_VERSION = "cost-policy-1.0.0";

export type PlanSource =
  | "deterministic_only" | "ai_approved" | "ai_rejected_fallback_used" | "ai_unavailable_fallback_used";

export interface RoundPlan {
  round_number: number;
  goal: string;
  /** Provider-independent title queries — validated before use. */
  title_queries: string[];
  posting_window_days: number | null;
  raw_job_limit: number;
  company_selection_limit: number;
  people_lookup_limit: number;
  people_per_company: number;
  approved_actor_keys: string[];
  proposed_changes: string[];
  risk: "low" | "medium" | "high";
  rationale: string;
  expected_bottleneck_impact: BottleneckKind | "unknown";
  strategy_hash?: string;
}

export interface BroadeningPlan {
  schema_version: string;
  planner_version: string;
  validator_version: string;
  cost_policy_version: string;
  source: PlanSource;
  intent_fingerprint: string;
  hard_constraint_hash: string;
  rationale: string;
  rounds: RoundPlan[];
  plan_hash?: string;
}

// ------------------------------------------------------ planner interface ----

/** EXACTLY what a planner may see. No raw provider text — see sanitizePlannerInput. */
export interface PlannerInput {
  intent_summary: {
    job_family_key: string | null;
    requested_titles: string[];
    geography: string | null;
    company_vertical: string | null;
    requested_person_roles: string[];
  };
  quota: { requested: number; eligible: number; remaining: number };
  last_round: FunnelSummary | null;
  bottleneck: BottleneckKind | null;
  attempted_strategies: string[];
  approved_capabilities: { actor_keys: string[]; adjacent_titles_allowed: boolean };
  remaining_budget: number;
}

export interface PlannerProposal {
  title_queries: string[];
  goal?: string;
  rationale?: string;
  risk?: "low" | "medium" | "high";
  expected_bottleneck_impact?: BottleneckKind | "unknown";
  /** Anything else a model returns is ignored by construction. */
  [k: string]: unknown;
}

/** Injected; a live model call is NEVER made by this module. */
export type BroadeningPlannerFn = (input: PlannerInput) => Promise<PlannerProposal | null>;

// ------------------------------------------------- deterministic planner ----

/**
 * The fallback that always exists: exact titles → registry synonyms → registry
 * adjacent → coverage only. An unknown family stops after the exact titles, which
 * is what produces an honest `search_exhausted` instead of an invented expansion.
 */
export function deterministicRoundPlan(
  constraints: SourcingConstraints,
  round: number,
  bottleneck: BottleneckKind | null,
): RoundPlan | null {
  const { hard, soft } = constraints;
  const def = getJobFamily(hard.jobFamilyKey);
  const titles = new Set<string>(hard.requestedTitles);

  let goal = "exact requested titles";
  let changes: string[] = [];
  if (round >= 2 && def && soft.titleVariantsAllowed) {
    for (const s of def.synonyms) titles.add(s);
    goal = "approved same-family synonyms";
    changes = ["added_registry_synonyms"];
  }
  if (round >= 3 && def && soft.adjacentTitlesAllowed) {
    for (const a of def.adjacent) titles.add(a);
    goal = "approved adjacent titles + wider coverage";
    changes = ["added_registry_adjacent", "increased_coverage"];
  }
  // Nothing new to try → let the controller report honest exhaustion.
  if (round >= 2 && titles.size === hard.requestedTitles.length && !changes.length) return null;

  // Coverage widening is a SOFT change and is bounded by the soft constraints.
  const coverageBoost = round >= 3 || bottleneck === "people_coverage" || bottleneck === "insufficient_raw_jobs";
  return {
    round_number: round,
    goal,
    title_queries: [...titles],
    posting_window_days: soft.postingWindowDays,
    raw_job_limit: soft.maxRawJobs,
    company_selection_limit: soft.maxCompanies + (coverageBoost ? 5 : 0),
    people_lookup_limit: soft.maxPeopleLookups + (coverageBoost ? 4 : 0),
    people_per_company: soft.peoplePerCompany,
    approved_actor_keys: [...soft.approvedActorKeys],
    proposed_changes: changes,
    risk: "low",
    rationale: `deterministic ${goal}`,
    expected_bottleneck_impact: bottleneck ?? "unknown",
  };
}

export async function buildInitialPlan(constraints: SourcingConstraints, intentFingerprint: string): Promise<BroadeningPlan> {
  const first = deterministicRoundPlan(constraints, 1, null)!;
  first.strategy_hash = await shortHash({ titles: first.title_queries.slice().sort(), round: 1 });
  const plan: BroadeningPlan = {
    schema_version: BROADENING_PLAN_SCHEMA_VERSION,
    planner_version: DETERMINISTIC_PLANNER_VERSION,
    validator_version: VALIDATOR_VERSION,
    cost_policy_version: COST_POLICY_VERSION,
    source: "deterministic_only",
    intent_fingerprint: intentFingerprint,
    hard_constraint_hash: constraints.hardHash,
    rationale: "initial deterministic round from the requested titles",
    rounds: [first],
  };
  plan.plan_hash = await shortHash({ ...plan, plan_hash: undefined });
  return plan;
}

/** Everything the planner is allowed to know — typed summaries only. */
export function sanitizePlannerInput(
  constraints: SourcingConstraints,
  quota: { requested: number; eligible: number; remaining: number },
  lastRound: FunnelSummary | null,
  bottleneck: BottleneckKind | null,
  attempted: string[],
  remainingBudget: number,
): PlannerInput {
  return {
    intent_summary: {
      job_family_key: constraints.hard.jobFamilyKey,
      requested_titles: [...constraints.hard.requestedTitles],
      geography: constraints.hard.geography,
      company_vertical: constraints.hard.companyVertical,
      requested_person_roles: [...constraints.hard.requestedPersonRoles],
    },
    quota,
    last_round: lastRound,          // numeric/categorical counters ONLY
    bottleneck,
    attempted_strategies: [...attempted],
    approved_capabilities: {
      actor_keys: [...constraints.soft.approvedActorKeys],
      adjacent_titles_allowed: constraints.soft.adjacentTitlesAllowed,
    },
    remaining_budget: remainingBudget,
  };
}

/** Titles a planner could ever legitimately propose for this request. */
export function plannerApprovedTitleUniverse(hard: HardConstraints, soft: SoftConstraints): string[] {
  const def = getJobFamily(hard.jobFamilyKey);
  if (!def) return [...hard.requestedTitles];
  const universe = [...hard.requestedTitles, ...def.exact, ...def.synonyms];
  if (soft.adjacentTitlesAllowed) universe.push(...approvedTitlesFor(def));
  return [...new Set(universe)];
}

export function planFingerprint(plan: BroadeningPlan): string {
  return canonicalJson({ s: plan.schema_version, h: plan.hard_constraint_hash, r: plan.rounds.map((r) => r.title_queries) });
}
