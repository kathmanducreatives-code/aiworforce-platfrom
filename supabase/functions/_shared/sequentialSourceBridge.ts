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
import { newFusionState, fusionDiagnostics, type HiringEvidenceFusionState } from "./hiringEvidenceFusion.ts";
import {
  newFeedbackLedger, SOURCE_FEEDBACK_VERSION, MAX_SOURCE_FEEDBACK_CALLS_PER_TASK,
  type SourceFeedbackLedger,
} from "./sourceFeedbackContract.ts";

export type InvokeJobsFn = (envelope: Record<string, unknown>, max: number) => Promise<unknown[]>;

export interface SequentialSourceBridgeInput {
  workspaceId: string;
  taskId: string;
  /** The caller's EXISTING provider function. Returned unchanged when disabled. */
  invokeJobs: InvokeJobsFn;
  profile: LeadMissionSourceProfile;
  /** Restored slice from the existing company-first checkpoint, when resuming. */
  restoredState?: SourceExecutionState | null;
  /** Restored fusion slice from the same checkpoint, when resuming. */
  restoredFusion?: HiringEvidenceFusionState | null;
  /** Restored feedback ledger from the same checkpoint, when resuming. */
  restoredFeedback?: SourceFeedbackLedger | null;
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
  /** Canonical fused evidence for this task. Null when disabled. */
  fusion: HiringEvidenceFusionState | null;
  /**
   * The bounded-feedback ledger for this task. Null when disabled.
   *
   * Carried here so it is restored and checkpointed with the step state and the
   * fused evidence it was derived from — a resumed run must not hold a decision
   * that disagrees with the observation that produced it.
   */
  feedback: SourceFeedbackLedger | null;
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
    plan: null, state: null, fusion: null, feedback: null, lastOutcome: () => null,
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

  // Fused evidence lives beside the step state in the SAME checkpoint, restored
  // together so a resumed run cannot hold step progress that disagrees with the
  // evidence it was derived from.
  const fusion = input.restoredFusion ?? newFusionState();

  // The feedback ledger travels with them. A restored ledger from an older
  // contract version is discarded rather than trusted: its request keys were
  // computed under a different policy and would suppress a call they never
  // actually answered.
  const feedback = input.restoredFeedback?.version === SOURCE_FEEDBACK_VERSION
    ? input.restoredFeedback
    : newFeedbackLedger();

  const handle = sequentialJobsInvoker({
    taskId: input.taskId,
    plan: approved,
    state,
    fusion: { state: fusion, workspaceId: input.workspaceId },
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
    fusion,
    feedback,
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
    ...(r.fusion ? { evidence_fusion: fusionDiagnostics(r.fusion, r.lastOutcome()?.fusion ?? null) } : {}),
    // Ledger-level only. The per-checkpoint record is reported by the feedback
    // runtime itself, which is the only thing that has one.
    ...(r.feedback ? {
      source_feedback: {
        calls_used: r.feedback.callsUsed,
        calls_remaining: Math.max(0, MAX_SOURCE_FEEDBACK_CALLS_PER_TASK - r.feedback.callsUsed),
        checkpoints: r.feedback.checkpoints.length,
        statuses: r.feedback.checkpoints.map((c) => c.status),
      },
    } : {}),
  };
}
