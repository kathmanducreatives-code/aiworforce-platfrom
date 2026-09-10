// BUILD THE COMPANY-FIRST RUNTIME DEPS IN ONE PLACE.
//
// run-agent constructed the `CompanyFirstRuntimeDeps` object inline before
// calling `executeRunAgentCompanyFirstSourcing`. That object is the seam between
// "how this runtime is wired" (Supabase client, real invokers, planner, state
// store) and "the quota controller that does the work". Extracting it so a
// SECOND runtime — the V2 long-running worker — can assemble the identical deps
// without copying run-agent's handler.
//
// THIS FILE ADDS NO BEHAVIOUR. It is a typed constructor: every field is passed
// through unchanged, and the three conditional fields (`actionBudget`, `bounds`,
// `executionBudget`) are included only when the caller supplies them — exactly
// as the inline spreads did. For V1, `executionBudget` is never supplied, so the
// object produced here is behaviourally identical to the previous literal.
//
// The ONE new capability is `executionBudget`: today omitted (run-agent relies
// on the edge default), later supplied by the worker to lift the ~125s ceiling.
// It changes nothing unless a caller passes it.

import type { CompanyFirstRuntimeDeps } from "./executeRunAgentCompanyFirstSourcing.ts";

export const BUILD_COMPANY_FIRST_RUNTIME_DEPS_VERSION =
  "build-company-first-runtime-deps-v1" as const;

/**
 * The inputs run-agent already computes. Typed by Pick from the deps contract,
 * so this helper can never drift from what the controller accepts. Callers still
 * decide blocking, ownership and fallback — they pass already-resolved invokers,
 * `actionBudget` and `bounds` in; this helper does not reimplement that logic.
 */
export type BuildCompanyFirstRuntimeDepsArgs = Pick<
  CompanyFirstRuntimeDeps,
  | "intent"
  | "workspaceId"
  | "planId"
  | "taskId"
  | "brainConstraints"
  | "brainPolicyHash"
  | "requestedLeadCount"
  | "requestedCountSource"
  | "proposeBroadening"
  | "plannerMetadata"
  | "durableIdempotency"
  | "stateStore"
  | "invokeJobs"
  | "invokePeople"
  | "persist"
  | "classifyCompanyEvidence"
  | "classificationCallsRemaining"
  | "onRoundComplete"
  | "pendingDiscoverySource"
  | "log"
> & {
  /** Resolved by the caller: present only when the plan-aware budget applies. */
  actionBudget?: CompanyFirstRuntimeDeps["actionBudget"];
  /** Resolved by the caller: e.g. `{ maxRounds: 0 }` when sourcing is blocked. */
  bounds?: CompanyFirstRuntimeDeps["bounds"];
  /**
   * OMITTED by V1 (edge default applies). Supplied by the V2 worker to remove
   * the ~125s edge execution ceiling. Absent ⇒ identical to previous behaviour.
   */
  executionBudget?: CompanyFirstRuntimeDeps["executionBudget"];
};

export function buildCompanyFirstRuntimeDeps(
  a: BuildCompanyFirstRuntimeDepsArgs,
): CompanyFirstRuntimeDeps {
  return {
    intent: a.intent,
    workspaceId: a.workspaceId,
    planId: a.planId ?? null,
    taskId: a.taskId ?? null,
    brainConstraints: a.brainConstraints ?? null,
    brainPolicyHash: a.brainPolicyHash ?? null,
    requestedLeadCount: a.requestedLeadCount,
    requestedCountSource: a.requestedCountSource,
    proposeBroadening: a.proposeBroadening,
    plannerMetadata: a.plannerMetadata,
    durableIdempotency: a.durableIdempotency,
    stateStore: a.stateStore,
    invokeJobs: a.invokeJobs,
    invokePeople: a.invokePeople,
    persist: a.persist,
    classifyCompanyEvidence: a.classifyCompanyEvidence,
    classificationCallsRemaining: a.classificationCallsRemaining,
    onRoundComplete: a.onRoundComplete,
    pendingDiscoverySource: a.pendingDiscoverySource,
    log: a.log,
    // Conditional fields — included ONLY when supplied, matching the previous
    // `...(cond ? { field } : {})` inline spreads exactly.
    ...(a.actionBudget ? { actionBudget: a.actionBudget } : {}),
    ...(a.bounds ? { bounds: a.bounds } : {}),
    ...(a.executionBudget ? { executionBudget: a.executionBudget } : {}),
  };
}
