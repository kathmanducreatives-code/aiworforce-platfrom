// THE RUN-AGENT BRIDGE for sequential source execution.
//
// Kept deliberately small so the change inside run-agent is a handful of lines
// and every decision here is unit-testable without an edge-function harness.
//
// WHAT IT DOES: when dynamic source planning is permitted for THIS workspace, it
// wraps the caller's existing `invokeJobs` so provider calls follow the validated
// ordered plan, one step at a time. Nothing else.
//
// WHAT IT DOES NOT TOUCH: the company-first executor, the quota controller, the
// Company Brain gate, the decision-maker workflow, employer verification,
// CONTACT/WATCH/REJECT/SKIP, persistence, the task-status model, or continuation.
// It returns the caller's OWN function when disabled, so the default path is not
// merely equivalent to today's behavior — it is literally the same function.
//
// PURE. No network, model or database access. The provider function is injected.

import { isDynamicSourcePlanningEnabled, deterministicOrderedPlan, validateOrderedPlan,
  type LeadMissionSourceProfile, type OrderedHiringSourcePlan } from "./hiringSourcePlan.ts";
import { newSourceExecutionState, stateMatchesPlan, type SourceExecutionState } from "./sourceExecutionState.ts";
import { sequentialJobsInvoker, actorKeyForCapability, sourceExecutionDiagnostics,
  type ActivationContext, type SequentialCallOutcome } from "./sequentialSourceRuntime.ts";
import type { EnvReader } from "./intelligence/intelligenceFlags.ts";

export type InvokeJobsFn = (envelope: Record<string, unknown>, max: number) => Promise<unknown[]>;

export interface SequentialSourceBridgeInput {
  workspaceId: string;
  taskId: string;
  /** The caller's EXISTING provider function. Returned unchanged when disabled. */
  invokeJobs: InvokeJobsFn;
  profile: LeadMissionSourceProfile;
  /** Restored slice from the existing company-first checkpoint, when resuming. */
  restoredState?: SourceExecutionState | null;
  costPerCall?: number;
  activationContext?: () => ActivationContext;
  readEnv?: EnvReader;
  log?: (msg: string, meta?: unknown) => void;
}

export interface SequentialSourceBridgeResult {
  /** Wrapped when enabled; the caller's own function when not. */
  invokeJobs: InvokeJobsFn;
  enabled: boolean;
  reason: string;
  plan: OrderedHiringSourcePlan | null;
  state: SourceExecutionState | null;
  lastOutcome: () => SequentialCallOutcome | null;
}

/**
 * Wrap the jobs invoker when sequential source execution is permitted.
 *
 * A plan that fails validation returns the caller's function unchanged rather
 * than a partially-approved graph: half a strategy is not a safer strategy, and
 * today's deterministic path is the correct thing to fall back to.
 */
export async function applySequentialSourceExecution(
  input: SequentialSourceBridgeInput,
): Promise<SequentialSourceBridgeResult> {
  const inert = (reason: string): SequentialSourceBridgeResult => ({
    invokeJobs: input.invokeJobs, enabled: false, reason,
    plan: null, state: null, lastOutcome: () => null,
  });

  const enablement = isDynamicSourcePlanningEnabled(input.workspaceId, input.readEnv);
  if (!enablement.enabled) return inert(enablement.reason);

  const plan = await deterministicOrderedPlan(input.profile);
  if (plan.capabilityGap) return inert(`capability_gap:${plan.capabilityGap.code}`);

  const validation = await validateOrderedPlan(plan, input.profile);
  if (!validation.ok || validation.plan.steps.length === 0) {
    return inert(`plan_invalid:${validation.violations.find((v) => v.severity === "block")?.code ?? "empty"}`);
  }
  const approved = validation.plan;

  // Reuse the restored slice only when it belongs to THIS plan. A different
  // ordering gives the same step ids different meanings, so carrying progress
  // across that boundary would credit one plan's paid calls to another's steps.
  const state = stateMatchesPlan(input.restoredState, approved.planHash)
    ? input.restoredState as SourceExecutionState
    : newSourceExecutionState({
        planHash: approved.planHash,
        steps: approved.steps.map((s) => ({
          stepId: s.stepId, capability: s.capability, order: s.order,
          actorKey: actorKeyForCapability(s.capability),
        })),
        requestedCount: approved.completionCondition.target,
        now: new Date().toISOString(),
      });

  const handle = sequentialJobsInvoker({
    taskId: input.taskId,
    plan: approved,
    state,
    invokeJobs: input.invokeJobs,
    costPerCall: input.costPerCall,
    activationContext: input.activationContext,
    log: input.log,
  });

  return {
    invokeJobs: handle.invokeJobs,
    enabled: true,
    reason: "enabled",
    plan: approved,
    state,
    lastOutcome: handle.lastOutcome,
  };
}

/** Safe diagnostics for the task result. Absent-by-default when disabled. */
export function sequentialSourceDiagnostics(r: SequentialSourceBridgeResult): Record<string, unknown> {
  if (!r.enabled || !r.plan || !r.state) {
    return { sequential_source_execution: false, enablement_reason: r.reason };
  }
  return {
    sequential_source_execution: true,
    enablement_reason: r.reason,
    ...sourceExecutionDiagnostics(r.plan, r.state, r.lastOutcome()),
  };
}
