// THE ROUND CONTROLLER'S MEMORY, AND THE RULES THAT END A RUN.
//
// A request for 100 that finds 18 in one search is not a finished run, and a
// request for 100 that finds 63 across three rounds is not a run that should
// invent 37 more. Both of those are decided here.
//
// EVERYTHING IN THIS FILE IS A COUNT OR A REASON. It holds no provider, no
// model, no Actor and no credential, so the arithmetic that decides "is another
// round worth it" is unit-testable without a network.
//
// THE COUNTS ARE KEPT APART ON PURPOSE. `delivered_opportunity_count` is not
// `qualified_count`, and neither is `founder_unlocked_count`. Collapsing them is
// how "87 delivered" becomes "87 qualified leads" in a summary, and how a
// request for 100 opportunities turns into 100 people lookups nobody bought.

export const MULTI_ROUND_VERSION = "multi-round-sourcing-v1" as const;

/** The default ceiling. Three rounds, unless a caller lowers it. */
export const DEFAULT_MAX_ROUNDS = 3;
export const MAX_REQUESTED_OPPORTUNITIES = 100;

/**
 * Honest endings only.
 *
 * `completed` means the requested number was actually reached. Everything else
 * names what stopped the run, so a shortfall is never dressed up as success.
 */
export type MultiRoundTerminalReason =
  | "completed"
  | "quota_not_met"
  | "search_exhausted"
  | "budget_exhausted"
  | "deadline_reached"
  | "round_limit_reached"
  | "provider_failure"
  | "model_limit_reached"
  | "invalid_round_plan"
  | "cancelled";

export type RoundStrategyType = "exact" | "adjacent" | "final_broadening";

/** What one round actually did. Persisted, and read by the next planner. */
export interface RoundRecord {
  round: number;
  strategy_type: RoundStrategyType;
  capabilities: string[];
  search_concepts: string[];
  signal_families: string[];
  company_types: string[];
  employee_range: { min: number | null; max: number | null };
  provider_operations: string[];
  discovered: number;
  /** Discovered MINUS everything already seen in an earlier round. */
  new_companies: number;
  hard_gated: number;
  eligible: number;
  new_evaluated_companies: number;
  qualified: number;
  review: number;
  watch: number;
  new_delivered_opportunities: number;
  provider_cost_units: number;
  model_cost_units: number;
}

export interface MultiRoundCounts {
  requested_opportunity_count: number;
  delivered_opportunity_count: number;
  qualified_count: number;
  review_count: number;
  watch_count: number;
  /** ALWAYS ZERO from sourcing. Stage 3 is the only thing that raises these. */
  founder_unlocked_count: number;
  contact_unlocked_count: number;
  contact_ready_count: number;
  remaining_shortfall: number;
}

export interface MultiRoundState {
  version: typeof MULTI_ROUND_VERSION;
  requested_opportunity_count: number;
  round_number: number;
  max_rounds: number;

  discovered_company_count: number;
  unique_company_count: number;
  eligible_company_count: number;
  evaluated_company_count: number;

  qualified_count: number;
  review_count: number;
  watch_count: number;

  delivered_opportunity_count: number;
  remaining_shortfall: number;

  provider_cost_units_used: number;
  model_cost_units_used: number;

  deadline_state: "ample" | "limited" | "reserve_reached";

  round_history: RoundRecord[];
  exhausted_capabilities: string[];
  exhausted_search_concepts: string[];

  terminal_reason: MultiRoundTerminalReason | null;
}

export function newMultiRoundState(i: {
  requestedCount: number;
  maxRounds?: number;
}): MultiRoundState {
  // CLAMPED HERE, ONCE. A mission asking for 10,000 opportunities is a mission
  // asking for 100; nothing downstream has to re-check it.
  const requested = Math.max(1, Math.min(
    MAX_REQUESTED_OPPORTUNITIES, Math.floor(i.requestedCount) || 1));
  return {
    version: MULTI_ROUND_VERSION,
    requested_opportunity_count: requested,
    round_number: 0,
    max_rounds: Math.max(1, Math.min(DEFAULT_MAX_ROUNDS, i.maxRounds ?? DEFAULT_MAX_ROUNDS)),
    discovered_company_count: 0,
    unique_company_count: 0,
    eligible_company_count: 0,
    evaluated_company_count: 0,
    qualified_count: 0,
    review_count: 0,
    watch_count: 0,
    delivered_opportunity_count: 0,
    remaining_shortfall: requested,
    provider_cost_units_used: 0,
    model_cost_units_used: 0,
    deadline_state: "ample",
    round_history: [],
    exhausted_capabilities: [],
    exhausted_search_concepts: [],
    terminal_reason: null,
  };
}

/** The strategy a given round number is allowed to use. */
export function strategyForRound(round: number): RoundStrategyType {
  return round <= 1 ? "exact" : round === 2 ? "adjacent" : "final_broadening";
}

/**
 * Fold a completed round into the state.
 *
 * Cumulative totals come from the POOL, not from summing rounds: a company
 * discovered in round 1 and re-discovered in round 3 must not count twice, and
 * summing per-round numbers is exactly how it would.
 */
export function recordRound(
  state: MultiRoundState,
  record: RoundRecord,
  pool: {
    unique_companies: number;
    eligible: number;
    evaluated: number;
    qualified: number;
    review: number;
    watch: number;
    delivered: number;
  },
): MultiRoundState {
  const delivered = Math.max(0, pool.delivered);
  return {
    ...state,
    round_number: record.round,
    round_history: [...state.round_history, record],
    discovered_company_count: state.discovered_company_count + record.discovered,
    unique_company_count: pool.unique_companies,
    eligible_company_count: pool.eligible,
    evaluated_company_count: pool.evaluated,
    qualified_count: pool.qualified,
    review_count: pool.review,
    watch_count: pool.watch,
    delivered_opportunity_count: delivered,
    // NEVER NEGATIVE, and never hidden. A run that over-delivers reports zero
    // shortfall rather than a negative one.
    remaining_shortfall: Math.max(0, state.requested_opportunity_count - delivered),
    provider_cost_units_used: state.provider_cost_units_used + record.provider_cost_units,
    model_cost_units_used: state.model_cost_units_used + record.model_cost_units,
  };
}

/** The public count block. Kept separate so nothing can quietly conflate them. */
export function countsOf(state: MultiRoundState): MultiRoundCounts {
  return {
    requested_opportunity_count: state.requested_opportunity_count,
    delivered_opportunity_count: state.delivered_opportunity_count,
    qualified_count: state.qualified_count,
    review_count: state.review_count,
    watch_count: state.watch_count,
    // SOURCING NEVER UNLOCKS ANYONE. Stated as a hard zero rather than omitted,
    // so "delivered" can never be read as "contactable".
    founder_unlocked_count: 0,
    contact_unlocked_count: 0,
    contact_ready_count: 0,
    remaining_shortfall: state.remaining_shortfall,
  };
}

// ───────────────────────────────────────────── search-concept exhaustion ──

export type ExhaustionReason =
  | "no_results"
  | "only_duplicates"
  | "all_hard_gated"
  | "provider_reported_no_more"
  | "equivalent_concept_already_tried";

export interface SearchConceptRecord {
  concept: string;
  concept_hash: string;
  round_first_used: number;
  result_count: number;
  unique_new_count: number;
  eligible_new_count: number;
  delivered_new_count: number;
  exhausted: boolean;
  exhausted_reason: ExhaustionReason | null;
}

/** Stable, case- and order-insensitive identity for a search concept. */
export function conceptHash(concept: string): string {
  const norm = String(concept ?? "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).sort().join(" ");
  let h = 5381;
  for (let i = 0; i < norm.length; i++) h = ((h << 5) + h + norm.charCodeAt(i)) >>> 0;
  return `concept:${h.toString(16)}`;
}

/**
 * Did this concept earn another use?
 *
 * A concept that returned rows but nothing NEW is exhausted just as surely as
 * one that returned nothing — re-running it costs a provider call to rediscover
 * companies already in the pool. "Everything it found was hard-gated" is the
 * third case: the rows were real and every one of them contradicted the
 * mission, which is a statement about the concept, not about the gate.
 */
export function assessConcept(i: {
  concept: string;
  round: number;
  resultCount: number;
  uniqueNew: number;
  eligibleNew: number;
  deliveredNew: number;
  providerReportedNoMore?: boolean;
}): SearchConceptRecord {
  const reason: ExhaustionReason | null =
    i.resultCount === 0 ? "no_results"
      : i.uniqueNew === 0 ? "only_duplicates"
      : i.eligibleNew === 0 ? "all_hard_gated"
      : i.providerReportedNoMore ? "provider_reported_no_more"
      : null;
  return {
    concept: i.concept,
    concept_hash: conceptHash(i.concept),
    round_first_used: i.round,
    result_count: i.resultCount,
    unique_new_count: i.uniqueNew,
    eligible_new_count: i.eligibleNew,
    delivered_new_count: i.deliveredNew,
    exhausted: reason !== null,
    exhausted_reason: reason,
  };
}

/** Concepts already tried, by hash — so an equivalent rewording is caught. */
export function isConceptExhausted(
  concept: string, exhausted: readonly string[],
): boolean {
  return exhausted.includes(conceptHash(concept));
}

// ─────────────────────────────────────────────────────── round metrics ──

export interface RoundQualityMetrics {
  round: number;
  discovered: number;
  unique_added: number;
  hard_gated: number;
  evaluated: number;
  qualified: number;
  review: number;
  watch: number;
  delivered: number;
  duplicate_rate: number;
  qualification_rate: number;
  cost_units: number;
  model_units: number;
  opportunities_per_cost_unit: number;
}

const ratio = (n: number, d: number) => d > 0 ? Number((n / d).toFixed(4)) : 0;

export function roundMetrics(r: RoundRecord): RoundQualityMetrics {
  return {
    round: r.round,
    discovered: r.discovered,
    unique_added: r.new_companies,
    hard_gated: r.hard_gated,
    evaluated: r.new_evaluated_companies,
    qualified: r.qualified,
    review: r.review,
    watch: r.watch,
    delivered: r.new_delivered_opportunities,
    duplicate_rate: ratio(r.discovered - r.new_companies, r.discovered),
    qualification_rate: ratio(r.qualified, r.new_evaluated_companies),
    cost_units: r.provider_cost_units,
    model_units: r.model_cost_units,
    opportunities_per_cost_unit:
      ratio(r.new_delivered_opportunities, r.provider_cost_units),
  };
}

// ─────────────────────────────────────────────────────── stop conditions ──

export interface RoundLimits {
  /** Server-resolved provider cost ceiling. Never supplied by a client. */
  maxProviderCostUnits: number;
  /** Server-resolved model-operation ceiling. */
  maxModelOperations: number;
  /** True once the deadline reserve is reached. */
  deadlineReserveReached: boolean;
  /** True when the caller has cancelled. */
  cancelled?: boolean;
  /** A provider failure that ended the last round. */
  providerFailed?: boolean;
}

export interface RoundDecision {
  start: boolean;
  /** Set whenever `start` is false. Never null on a stop. */
  terminal_reason: MultiRoundTerminalReason | null;
  detail: string;
}

/**
 * May another round begin?
 *
 * ORDER MATTERS. Cancellation and hard limits are checked before quota, so a
 * run that hit its budget on the same round it reached its target reports the
 * target — and a run that reached neither reports the limit it actually hit
 * rather than a generic shortfall.
 *
 * The last two conditions are the ones that stop a pointless round: a previous
 * round that added no eligible company will not be followed by another equally
 * broad one, because the evidence says the pool is out of reach of this search.
 */
export function decideNextRound(
  state: MultiRoundState, limits: RoundLimits,
): RoundDecision {
  const stop = (r: MultiRoundTerminalReason, detail: string): RoundDecision =>
    ({ start: false, terminal_reason: r, detail });

  if (limits.cancelled) return stop("cancelled", "the workflow was cancelled");

  // TARGET FIRST among the non-cancellation reasons: reaching the number the
  // user asked for is the only ending that may be called `completed`.
  if (state.delivered_opportunity_count >= state.requested_opportunity_count) {
    return stop("completed",
      `delivered ${state.delivered_opportunity_count} of ` +
      `${state.requested_opportunity_count} requested`);
  }

  if (limits.providerFailed) {
    return stop("provider_failure", "the previous round's provider failed");
  }
  if (state.provider_cost_units_used >= limits.maxProviderCostUnits) {
    return stop("budget_exhausted",
      `provider budget ${state.provider_cost_units_used}/${limits.maxProviderCostUnits}`);
  }
  if (state.model_cost_units_used >= limits.maxModelOperations) {
    return stop("model_limit_reached",
      `model operations ${state.model_cost_units_used}/${limits.maxModelOperations}`);
  }
  if (limits.deadlineReserveReached) {
    return stop("deadline_reached", "the checkpoint reserve was reached");
  }
  if (state.round_number >= state.max_rounds) {
    return stop("round_limit_reached",
      `${state.round_number} of ${state.max_rounds} rounds used, ` +
      `${state.remaining_shortfall} short`);
  }

  const last = state.round_history[state.round_history.length - 1];
  if (last) {
    // A ROUND THAT ADDED NOTHING ELIGIBLE IS EVIDENCE, NOT BAD LUCK. Following
    // it with another equally broad round spends the same money for the same
    // answer.
    if (last.new_companies === 0) {
      return stop("search_exhausted",
        `round ${last.round} discovered ${last.discovered} companies and none were new`);
    }
    if (last.eligible === 0 && last.new_companies > 0) {
      return stop("search_exhausted",
        `round ${last.round} added ${last.new_companies} companies and none survived the gates`);
    }
  }

  return { start: true, terminal_reason: null, detail: "shortfall remains and limits allow another round" };
}

/**
 * The ending to persist when no further round runs.
 *
 * A run that stopped for a limit but still met its target reports `completed`;
 * one that stopped without reaching it and has no more specific reason reports
 * `quota_not_met` rather than pretending.
 */
export function finalTerminalReason(
  state: MultiRoundState, decision: RoundDecision,
): MultiRoundTerminalReason {
  if (state.delivered_opportunity_count >= state.requested_opportunity_count) {
    return "completed";
  }
  return decision.terminal_reason && decision.terminal_reason !== "completed"
    ? decision.terminal_reason : "quota_not_met";
}
