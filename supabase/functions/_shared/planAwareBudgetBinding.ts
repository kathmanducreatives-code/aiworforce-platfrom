// PLAN-AWARE BUDGET BINDING — the production caller `planAwareActionBudget`
// never had.
//
// The budget itself shipped tested and correct in `leadStrategyFeedbackOwner`,
// and the quota controller grew an `actionBudget?:` seam for it, but nothing in
// run-agent ever supplied one. Every production run therefore still stopped on
// the blind `maxRounds: 3 / maxJobsCalls: 3` limit — a run with four unused
// exact packs and two untried sources ended at round three, and a run whose
// every source produced noise still paid for three.
//
// This module is the adapter between what the sequential-source bridge can
// observe (packs consumed, sources finished, per-round funnel quality) and the
// input the budget expects. It decides nothing: `planAwareActionBudget` still
// owns the arithmetic and `HARD_PROVIDER_CALL_CEILING` still binds above it.

import { planAwareActionBudget, type PlanAwareBudget, type PlanAwareBudgetInput } from "./leadStrategyFeedbackOwner.ts";
import type { QueryPack } from "./intelligence/leads/leadQueryPacks.ts";
import type { AdaptivePackState } from "./intelligence/leads/leadAdaptiveRuntime.ts";

/** A pack is EXACT while it is initially eligible and not a broadening tier. */
export function isExactPack(pack: QueryPack): boolean {
  return pack.initially_eligible === true && (pack.broadening_level ?? 0) <= 0;
}

export interface PackUsage {
  unusedExactPacks: number;
  unusedAdjacentPacks: number;
}

/**
 * How much of the validated plan is still unspent.
 *
 * A pack counts as consumed once ANY capability has sent it to a provider —
 * re-running the same titles on the next source is a different action and is
 * accounted for by the unused-source term, not by this one.
 */
export function unusedPackCounts(
  packs: readonly QueryPack[],
  packState: AdaptivePackState | null | undefined,
): PackUsage {
  const consumed = new Set<string>();
  for (const ids of Object.values(packState?.completed_by_capability ?? {})) {
    for (const id of ids ?? []) consumed.add(id);
  }
  let exact = 0;
  let adjacent = 0;
  for (const p of packs) {
    if (consumed.has(p.pack_id)) continue;
    if (isExactPack(p)) exact++;
    else adjacent++;
  }
  return { unusedExactPacks: exact, unusedAdjacentPacks: adjacent };
}

/**
 * Per-source quality in the budget's own -1 (noise) .. 1 (precise) scale.
 *
 * Derived from the round funnel the controller already reports, so no new
 * measurement and no new provider call is introduced. A source that returned
 * rows but qualified no company is noise; one that produced contact-ready leads
 * is precise; a source that returned nothing at all is neutral-negative rather
 * than damning, because an empty result is not evidence about the next source.
 */
export function sourceQualityScore(round: {
  rawRows: number;
  newUniqueCompanies: number;
  companiesQualified: number;
  newEligibleLeads: number;
}): number {
  if (round.rawRows <= 0) return -0.25;
  if (round.newEligibleLeads > 0) return 1;
  if (round.companiesQualified > 0) return 0.25;
  if (round.newUniqueCompanies > 0) return -0.6;
  return -1;
}

/** Everything the binding needs to answer the controller, in one value. */
export interface PlanBudgetSnapshot {
  unusedExactPacks: number;
  unusedAdjacentPacks: number;
  unusedSources: number;
  remainingQuota: number;
  remainingBudgetUsd: number;
  actionsSpent: number;
  sourceQuality: Record<string, number>;
}

export function planAwareBudgetInputFrom(snapshot: PlanBudgetSnapshot): PlanAwareBudgetInput {
  return {
    unusedExactPacks: Math.max(0, snapshot.unusedExactPacks),
    unusedAdjacentPacks: Math.max(0, snapshot.unusedAdjacentPacks),
    unusedSources: Math.max(0, snapshot.unusedSources),
    remainingQuota: Math.max(0, snapshot.remainingQuota),
    remainingBudgetUsd: Math.max(0, snapshot.remainingBudgetUsd),
    actionsSpent: Math.max(0, snapshot.actionsSpent),
    sourceQuality: snapshot.sourceQuality,
  };
}

/** The reason reported before any round has been observed. */
export const PLAN_BUDGET_PENDING_REASON = "pending_first_round";

/**
 * Build the `actionBudget` function the quota controller calls at the top of
 * every round.
 *
 * BEFORE the first round there is no observation, so the budget must not stop
 * anything — the first action is always allowed. Once a round has completed the
 * real budget answers, and quota, money, repeated low-quality sources and the
 * hard ceiling can each end the run.
 */
export function createPlanAwareActionBudget(
  readSnapshot: () => PlanBudgetSnapshot | null,
): () => PlanAwareBudget {
  return () => {
    const snapshot = readSnapshot();
    if (!snapshot) {
      return { allowed: 1, remaining: 1, exhausted: false, reason: PLAN_BUDGET_PENDING_REASON };
    }
    return planAwareActionBudget(planAwareBudgetInputFrom(snapshot));
  };
}
