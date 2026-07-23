// Apify budget estimation + spend gating.
//
// The upper cost boundary must be computable BEFORE any live call, from the
// bounded provider limits alone. The run soft-stops at $4.50 and never
// intentionally exceeds the $5.00 hard cap. All numbers are pessimistic (upper
// bound), so a real run costs no more than the estimate.

import {
  APIFY_HARD_CAP_USD,
  APIFY_SOFT_STOP_USD,
  type ApifyLimits,
} from "./types.ts";

export type PricingUnit = "per_result" | "per_run" | "per_account";

/**
 * Approximate per-unit pricing for the actors this benchmark uses. These are
 * intentionally conservative (high) so the estimate is an upper bound. Real
 * reported costs from each actor run are recorded separately in the manifest;
 * the gate uses reported spend once available.
 */
export interface ActorPricing {
  actorKey: string;
  actorId: string;
  unit: PricingUnit;
  usdPerUnit: number;
}

/** Conservative default pricing. Override via config when actor pricing is known. */
export const DEFAULT_PRICING: ActorPricing[] = [
  // curious_coder/linkedin-jobs-scraper — billed per result (upper bound).
  { actorKey: "apify_jobs", actorId: "curious_coder/linkedin-jobs-scraper", unit: "per_result", usdPerUnit: 0.05 },
  // harvestapi/linkedin-profile-search — per founder-candidate result.
  { actorKey: "apify_people_search", actorId: "harvestapi/linkedin-profile-search", unit: "per_result", usdPerUnit: 0.08 },
  // website-content-crawler used for company enrichment — per account crawled.
  { actorKey: "apify_website", actorId: "apify/website-content-crawler", unit: "per_account", usdPerUnit: 0.04 },
];

export interface ActorCostLine {
  actorKey: string;
  actorId: string;
  units: number;
  unit: PricingUnit;
  usdPerUnit: number;
  usd: number;
}

export interface CostEstimate {
  lines: ActorCostLine[];
  estimatedMaxUsd: number;
  withinHardCap: boolean;
  withinSoftStop: boolean;
}

/**
 * Compute the pessimistic maximum spend from the bounded limits. Units per actor:
 *   - jobs:   at most rawMaxResults job results.
 *   - people: at most founderLookupMaxAccounts * founderCandidatesPerAccount.
 *   - website:at most verifyMaxAccounts accounts crawled.
 */
export function estimateMaxCost(limits: ApifyLimits, pricing: ActorPricing[] = DEFAULT_PRICING): CostEstimate {
  const unitsFor = (p: ActorPricing): number => {
    switch (p.actorKey) {
      case "apify_jobs":
        return limits.rawMaxResults;
      case "apify_people_search":
        return limits.founderLookupMaxAccounts * limits.founderCandidatesPerAccount;
      case "apify_website":
        return limits.verifyMaxAccounts;
      default:
        return 0;
    }
  };

  const lines: ActorCostLine[] = pricing.map((p) => {
    const units = unitsFor(p);
    const usd = round2(units * p.usdPerUnit);
    return { actorKey: p.actorKey, actorId: p.actorId, units, unit: p.unit, usdPerUnit: p.usdPerUnit, usd };
  });

  const estimatedMaxUsd = round2(lines.reduce((s, l) => s + l.usd, 0));
  return {
    lines,
    estimatedMaxUsd,
    withinHardCap: estimatedMaxUsd <= APIFY_HARD_CAP_USD,
    withinSoftStop: estimatedMaxUsd <= APIFY_SOFT_STOP_USD,
  };
}

export type BudgetLevel = "ok" | "soft_stop" | "hard_stop";

export interface BudgetGateResult {
  level: BudgetLevel;
  /** True when further provider calls may proceed. */
  proceed: boolean;
  message: string;
}

/**
 * Gate further provider calls on running/reported spend. At or above the soft
 * stop ($4.50) no further calls are allowed; at or above the hard cap ($5.00)
 * the run is stopped hard. Below the soft stop, calls proceed.
 */
export function budgetGate(spendUsd: number): BudgetGateResult {
  if (spendUsd >= APIFY_HARD_CAP_USD) {
    return { level: "hard_stop", proceed: false, message: `Hard cap reached ($${spendUsd.toFixed(2)} ≥ $${APIFY_HARD_CAP_USD.toFixed(2)}). Stopping.` };
  }
  if (spendUsd >= APIFY_SOFT_STOP_USD) {
    return { level: "soft_stop", proceed: false, message: `Soft stop reached ($${spendUsd.toFixed(2)} ≥ $${APIFY_SOFT_STOP_USD.toFixed(2)}). No further provider calls.` };
  }
  return { level: "ok", proceed: true, message: `Spend $${spendUsd.toFixed(2)} within budget.` };
}

/**
 * Reduce limits until the estimate fits under the hard cap. Returns the adjusted
 * limits and whether any adjustment was needed. Reduces the most expensive
 * dimensions first (people, then website, then jobs) but never below 1.
 */
export function fitLimitsToBudget(
  limits: ApifyLimits,
  pricing: ActorPricing[] = DEFAULT_PRICING,
  cap = APIFY_HARD_CAP_USD,
): { limits: ApifyLimits; adjusted: boolean } {
  const l: ApifyLimits = { ...limits };
  let adjusted = false;
  let guard = 0;
  while (estimateMaxCost(l, pricing).estimatedMaxUsd > cap && guard < 1000) {
    guard += 1;
    if (l.founderCandidatesPerAccount > 1) l.founderCandidatesPerAccount -= 1;
    else if (l.founderLookupMaxAccounts > 1) l.founderLookupMaxAccounts -= 1;
    else if (l.verifyMaxAccounts > 1) l.verifyMaxAccounts -= 1;
    else if (l.rawMaxResults > 1) l.rawMaxResults -= 1;
    else break;
    adjusted = true;
  }
  return { limits: l, adjusted };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
