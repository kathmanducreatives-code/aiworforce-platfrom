// PRE-EXECUTION COST FORECAST. A round is approved or refused BEFORE any provider
// call. The planner cannot influence any value here — every input comes from the
// deterministic round plan and the cost policy.

import type { RoundPlan } from "./broadeningPlan.ts";

export interface CostPolicy {
  costPerJobsCall: number;
  costPerPeopleCall: number;
  softBudget: number;
  hardBudget: number;
  maxJobsCallsPerRound: number;
  maxPeopleCallsPerRound: number;
}

export const DEFAULT_COST_POLICY: CostPolicy = {
  costPerJobsCall: 0.25, costPerPeopleCall: 0.12,
  softBudget: 4.5, hardBudget: 5.0,
  maxJobsCallsPerRound: 1, maxPeopleCallsPerRound: 12,
};

export interface CostForecast {
  jobs_calls: number;
  max_people_calls: number;
  max_profiles: number;
  estimated_provider_cost: number;
  estimated_total_cost: number;
  soft_budget: number;
  hard_budget: number;
  remaining_budget: number;
  approved: boolean;
  refusal_reason: string | null;
}

export function forecastRoundCost(
  round: RoundPlan,
  spentSoFar: number,
  policy: CostPolicy = DEFAULT_COST_POLICY,
): CostForecast {
  // All compiled title variants ship in ONE jobs invocation (multi-URL), so a
  // round costs one jobs call regardless of how many titles it carries.
  const jobsCalls = Math.min(policy.maxJobsCallsPerRound, 1);
  const maxPeopleCalls = Math.min(policy.maxPeopleCallsPerRound, Math.max(0, round.people_lookup_limit));
  const maxProfiles = maxPeopleCalls * Math.max(1, round.people_per_company);
  const providerCost = jobsCalls * policy.costPerJobsCall + maxPeopleCalls * policy.costPerPeopleCall;
  const total = spentSoFar + providerCost;

  let approved = true;
  let refusal: string | null = null;
  if (total > policy.hardBudget) { approved = false; refusal = "would_exceed_hard_budget"; }
  else if (jobsCalls > policy.maxJobsCallsPerRound) { approved = false; refusal = "jobs_call_limit"; }
  else if (maxPeopleCalls > policy.maxPeopleCallsPerRound) { approved = false; refusal = "people_call_limit"; }
  else if (round.raw_job_limit <= 0) { approved = false; refusal = "unsafe_round_limits"; }

  return {
    jobs_calls: jobsCalls, max_people_calls: maxPeopleCalls, max_profiles: maxProfiles,
    estimated_provider_cost: Number(providerCost.toFixed(4)),
    estimated_total_cost: Number(total.toFixed(4)),
    soft_budget: policy.softBudget, hard_budget: policy.hardBudget,
    remaining_budget: Number(Math.max(0, policy.hardBudget - spentSoFar).toFixed(4)),
    approved, refusal_reason: refusal,
  };
}

// ------------------------------------------------------------ idempotency ----

/** Stable identity for a paid round: a retry reuses it instead of re-charging. */
export function roundIdempotencyKey(args: {
  taskId: string | null; workspaceId: string; round: number; strategyHash: string; actorKey: string;
}): string {
  return [args.taskId ?? "no-task", args.workspaceId, `r${args.round}`, args.strategyHash, args.actorKey].join("::");
}

export interface IdempotencyLedger {
  seen: Set<string>;
  /** Returns false when this exact paid call already happened. */
  claim(key: string): boolean;
}

export function newIdempotencyLedger(existing: Iterable<string> = []): IdempotencyLedger {
  const seen = new Set<string>(existing);
  return {
    seen,
    claim(key: string) {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
  };
}
