// THE RUN-AGENT BRIDGE for sequential source execution.
//
// Kept deliberately small so the change inside run-agent is a handful of lines
// and every decision here is unit-testable without an edge-function harness.
//
// WHAT IT DOES: when dynamic source planning is permitted for THIS workspace, it
// wraps the caller's existing `invokeJobs` so provider calls follow the validated
// ordered plan, one step at a time — and it CLOSES THE LOOP by observing each
// completed round, deciding the one next action, and folding it into the state the
// next round reads.
//
// The loop matters as much as the wrapping. Until now `applyObservation` had no
// production caller at all, so `current_step_id` was set on the first call and
// never advanced: round 1 executed source 1, and every later round recompiled the
// identical input, hit the duplicate guard, and returned an empty batch. The plan
// looked ordered and behaved like a single source that had stopped working.
//
// WHAT IT DOES NOT TOUCH: the company-first executor, the quota controller, the
// Company Brain gate, the decision-maker workflow, employer verification,
// CONTACT/WATCH/REJECT/SKIP, persistence, the task-status model, or continuation.
// It returns the caller's OWN function when disabled, so the default path is not
// merely equivalent to today's behavior — it is literally the same function.
//
// PURE. No network, model or database access. The provider function is injected.

import { isDynamicSourcePlanningEnabled, deterministicOrderedPlan, validateOrderedPlan, orderedPlanHash,
  type LeadMissionSourceProfile, type OrderedHiringSourcePlan, type SourceStepObservation } from "./hiringSourcePlan.ts";
import { routeAdaptiveLeadDecision } from "./intelligence/leads/leadAdaptiveRoute.ts";
import {
  resolveAdaptiveOrderedPlan, runAdaptiveRound, bindFeedbackAskClaude,
  adaptiveRuntimeDiagnostics, readAdaptivePackState, ADAPTIVE_PACK_STATE_KEY,
  type AdaptivePackState, type ResolveStrategyInput,
} from "./intelligence/leads/leadAdaptiveRuntime.ts";
import type { QueryPack } from "./intelligence/leads/leadQueryPacks.ts";
import {
  newSourceExecutionState, SOURCE_EXECUTION_KEY, stateMatchesPlan, stepOf, isStepFinished,
  type SourceExecutionState,
} from "./sourceExecutionState.ts";
import { sequentialJobsInvoker, actorKeyForCapability, sourceExecutionDiagnostics,
  type ActivationContext, type SequentialCallOutcome } from "./sequentialSourceRuntime.ts";
import type { EnvReader } from "./intelligence/intelligenceFlags.ts";
import {
  newFusionState, fusionDiagnostics, FUSION_STATE_KEY,
  type HiringEvidenceFusionState,
} from "./hiringEvidenceFusion.ts";
import {
  fusedEvidenceHash, fusedMetricsFrom, newFeedbackLedger,
  MAX_SOURCE_FEEDBACK_CALLS_PER_TASK, SOURCE_FEEDBACK_KEY, SOURCE_FEEDBACK_VERSION,
  type SourceFeedbackLedger,
} from "./sourceFeedbackContract.ts";
import {
  applyObservationWithFeedback, decideNextActionWithFeedback, sourceFeedbackDiagnostics,
  type FeedbackDecisionResult,
} from "./sourceFeedbackRuntime.ts";
import { applyObservation } from "./sequentialSourceRuntime.ts";
import type { GenerateJsonFn } from "./intelligence/plannerWrapper.ts";
import { createStrategistGenerateJson } from "./leadStrategyFeedbackOwner.ts";

import { canonicalJson, sha256Hex } from "./planHash.ts";
import {
  safeObserverFailure,
  type RoundObservationInput, type RoundObservationOutcome,
} from "./companyFirstQuotaController.ts";

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
  /**
   * Which Company Brain policy gated this run. Hashed already by the caller — the
   * feedback request carries the hash, never the Brain itself.
   */
  companyBrainPolicyHash?: string | null;
  /**
   * The model call, injected ONLY by tests. Production omits it, so the existing
   * `generateJson` gateway is used — there is no second client and no wrapper
   * around the wrapper.
   */
  generate?: GenerateJsonFn;
  /**
   * The ADAPTIVE STRATEGY gateway (Claude-first qualified-lead planning).
   *
   * Injected by the caller that owns the model client, exactly like `generate`.
   * Omitted ⇒ the deterministic ordered plan is used and NO model call is made,
   * which is the shipping state while `CLAUDE_FIRST_LEAD_PLANNING` is off.
   *
   * It returns the raw strategy; parsing, validation and conversion happen here
   * so the gateway cannot smuggle an unvalidated plan into the runtime.
   */
  planAdaptiveStrategy?: () => Promise<unknown>;
  /** Parse + validate the raw strategy. Injected so this file holds no contract. */
  validateAdaptiveStrategy?: ResolveStrategyInput["validate"];
  /**
   * Explicit route decision for the strategy above. Supplied by the GPT strategy
   * path, whose eligibility is decided by GPT_LEAD_STRATEGY, not by the Claude
   * route flags. Omitted ⇒ the existing Claude route decides, unchanged.
   */
  strategyRouteOverride?: { enabled: boolean; reason: string };
  /** Validated query packs for this mission, when the adaptive path is enabled. */

  adaptivePacks?: readonly QueryPack[];
  log?: (msg: string, meta?: unknown) => void;
}

export interface SequentialSourceBridgeResult {
  /** Wrapped when enabled; the caller's own function when not. */
  invokeJobs: InvokeJobsFn;
  enabled: boolean;
  reason: string;
  /** What was attempted before going inert. Absent once enabled. */
  disabledDetail?: SequentialSourceDisabledDetail;
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
  /**
   * Observe ONE completed round: build the observation, decide the one next
   * action, fold it in, and hand back the slices to checkpoint.
   *
   * Wired to the controller's `onRoundComplete`. When the bridge is disabled this
   * is a no-op that returns nothing, so the default path does no work at all.
   */
  onObservation: (input: RoundObservationInput) => Promise<RoundObservationOutcome | void>;
  /** The last feedback decision, for diagnostics. Null until a round completes. */
  lastFeedback: () => FeedbackDecisionResult | null;
  /**
   * Safe diagnostics for the last ADAPTIVE decision. Null until the adaptive
   * path decides a round — which requires validated packs and the flags on.
   *
   * Codes, counts and the chosen action only; never a prompt or provider record.
   */
  lastAdaptiveDecision: () => Record<string, unknown> | null;
  /**
   * Provenance of the INITIAL strategy: `claude`, `claude_repaired` or
   * `deterministic_fallback`, with the exact fallback reason, the generated pack
   * ids, the selected capability order and the plan hash.
   */
  strategyProvenance: () => Record<string, unknown> | null;
  /**
   * READ-ONLY: the next approved DISCOVERY source that has not finished.
   *
   * Handed to the quota controller so it can tell "this source's titles are
   * spent" from "the search is over". Verification-role steps (ATS) are excluded:
   * they need a known company identity and are not a discovery lane, so a pending
   * ATS step is not a reason to keep the search alive.
   */
  nextPendingDiscoverySource: () => {
    pending: boolean;
    stepId: string | null;
    capability: string | null;
    actorKey: string | null;
  };
  /**
   * Safe diagnostics for a failed state transition. Null while healthy.
   *
   * Codes, hashes and booleans only — never an exception payload, a prompt, a
   * provider record or a contact.
   */
  lastTransitionFailure: () => Record<string, unknown> | null;
}

/**
 * What was attempted before the bridge went inert.
 *
 * Safe metadata only: capability keys, rejection CODES and booleans. Never an
 * Actor id, a credential, a prompt or a provider payload.
 */
export interface SequentialSourceDisabledDetail {
  workspaceMatch: boolean;
  orderedPlanCreated: boolean;
  capabilitiesRequested: string[];
  capabilitiesAccepted: string[];
  stepRejections: Array<{ capability: string; reason: string }>;
}

/** Where in the fold a transition failed. */
export type TransitionPhase =
  | "observation_construction"
  | "feedback_resolution"
  | "state_transition"
  | "checkpoint_persistence";

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
  // WHY IT WAS INERT HAS TO SURVIVE THE RUN.
  //
  // Every branch below returns the caller's function unchanged, which is correct
  // — but the reason used to be dropped on the floor by run-agent, so a task
  // result could not tell "the flag is off" from "every approved Actor is
  // disabled". Auditing production run c34c0cad required re-deriving the answer
  // offline against a reconstructed profile. That is one run too many.
  const inert = (
    reason: string,
    detail: Partial<SequentialSourceDisabledDetail> = {},
  ): SequentialSourceBridgeResult => ({
    invokeJobs: input.invokeJobs, enabled: false, reason,
    disabledDetail: {
      workspaceMatch: false, orderedPlanCreated: false,
      capabilitiesRequested: [], capabilitiesAccepted: [], stepRejections: [],
      ...detail,
    },
    plan: null, state: null, fusion: null, feedback: null, lastOutcome: () => null,
    // A no-op, not an absent function: the controller can call it unconditionally.
    onObservation: () => Promise.resolve(),
    lastFeedback: () => null,
    lastAdaptiveDecision: () => null,
    strategyProvenance: () => null,
    lastTransitionFailure: () => null,
    // Disabled: there is no ordered plan, so no source is pending. The controller
    // then behaves exactly as it did before ordered execution existed.
    nextPendingDiscoverySource: () => ({ pending: false, stepId: null, capability: null, actorKey: null }),
  });

  const enablement = isDynamicSourcePlanningEnabled(input.workspaceId, input.readEnv);
  if (!enablement.enabled) {
    // `workspace_not_allowed` already proves the flag was on and a list existed.
    return inert(enablement.reason, { workspaceMatch: false });
  }

  const plan = await deterministicOrderedPlan(input.profile);
  if (plan.capabilityGap) {
    return inert(`capability_gap:${plan.capabilityGap.code}`, { workspaceMatch: true });
  }

  // ---- INITIAL STRATEGY BINDING -------------------------------------------
  //
  // The deterministic plan above is built FIRST and unconditionally, so it is
  // always the thing that runs when the adaptive route is off, the gateway is
  // absent, the call fails, or the strategy does not validate. Claude can only
  // ever REPLACE its steps, never be required for a plan to exist.
  //
  // The gateway itself is injected (production supplies it; tests stub it), and
  // whatever it returns is parsed, validated and converted here before the
  // EXISTING `validateOrderedPlan` below passes final judgment on it.
  //
  // THE ROUTE OVERRIDE exists because the Claude route flags do not describe the
  // GPT strategy path. When the OpenAI strategy owner already resolved a plan for
  // this task, that plan IS the strategy: gating it behind CLAUDE_FIRST_* would
  // discard it and silently restore the merged single-call behaviour that
  // production tasks 4851efb0 / b59b422b exhibited.
  const adaptiveRoute = input.strategyRouteOverride ?? (() => {
    const r = routeAdaptiveLeadDecision({
      workflow: "qualified_lead_sourcing",
      executionMode: "company_first",
      workspaceId: input.workspaceId,
      decision: "sourcing_strategy",
      strategyContractAvailable: !!input.validateAdaptiveStrategy,
      read: input.readEnv,
    });
    return { enabled: r.useClaude, reason: r.reason };
  })();
  const strategyOutcome = await resolveAdaptiveOrderedPlan({
    routeEnabled: adaptiveRoute.enabled,
    routeReason: adaptiveRoute.reason,

    planStrategy: input.planAdaptiveStrategy,
    validate: input.validateAdaptiveStrategy ??
      (() => ({ ok: false, reason: "no_strategy_validator", strategy: null, source: "claude" as const })),
    candidateTarget: plan.steps[0]?.semanticIntent.candidateTarget ?? 25,
  });
  if (strategyOutcome.steps.length > 0) {
    plan.steps = strategyOutcome.steps;
    plan.planHash = await orderedPlanHash({ ...plan, planHash: undefined } as never);
  }
  // The packs the strategy GENERATED are what the feedback loop uses. Production
  // never supplies them as a fixture; `input.adaptivePacks` exists only so a test
  // can drive the loop without running the planner.
  const activePacks: readonly QueryPack[] = strategyOutcome.packs.length > 0
    ? strategyOutcome.packs
    : (input.adaptivePacks ?? []);
  const strategyProvenance = {
    strategy_source: strategyOutcome.strategySource,
    fallback_reason: strategyOutcome.fallbackReason,
    model_called: strategyOutcome.modelCalled,
    pack_ids: activePacks.map((p) => p.pack_id),
    capability_order: strategyOutcome.steps.map((x) => x.capability),
    ...strategyOutcome.diagnostics,
  };

  const validation = await validateOrderedPlan(plan, input.profile);
  if (!validation.ok || validation.plan.steps.length === 0) {
    // THE CASE THAT ACTUALLY FIRED IN PRODUCTION. The ordered plan built four
    // steps and validation rejected all four, each with
    // `provider_disabled:<actorKey>` — the capability→Actor mappings resolve to
    // Actors whose `required_env` is unprovisioned. Recording the requested
    // capabilities and per-step rejection reasons is what makes that readable
    // from the task result instead of reproducible only offline.
    return inert(`plan_invalid:${validation.violations.find((v) => v.severity === "block")?.code ?? "empty"}`, {
      workspaceMatch: true,
      orderedPlanCreated: true,
      capabilitiesRequested: plan.steps.map((s) => s.capability),
      capabilitiesAccepted: validation.plan.steps.map((s) => s.capability),
      stepRejections: (validation.rejectedSteps ?? []).map((r) => ({
        capability: String((r.step as { capability?: unknown }).capability ?? "unknown"),
        reason: r.reason,
      })),
    });
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
    // ONE PAID CALL PER PACK. `prepareStepPackCalls` shipped tested with no
    // production caller, so every Actor received the merged alias list.
    queryPacks: activePacks.map((p) => ({ packId: p.pack_id, titleAliases: p.titles })),
    taskId: input.taskId,
    plan: approved,
    state,
    fusion: { state: fusion, workspaceId: input.workspaceId },
    invokeJobs: input.invokeJobs,
    costPerCall: input.costPerCall,
    activationContext: input.activationContext,
    log: input.log,
  });

  let lastFeedback: FeedbackDecisionResult | null = null;
  let lastTransitionFailure: Record<string, unknown> | null = null;
  // The adaptive pack ledger, restored with the rest of the checkpoint.
  let adaptivePackState: AdaptivePackState = readAdaptivePackState(
    (input.restoredState as unknown as { slices?: Record<string, unknown> })?.slices,
  );
  let lastAdaptive: Record<string, unknown> | null = null;
  /** True once the adaptive path has decided a round for this task. */
  let adaptiveEngaged = false;
  /** A step is finished when the existing state authority says so. */
  const stepFinished = (id: string): boolean => {
    const rec = stepOf(state, id);
    return rec ? isStepFinished(rec) : false;
  };
  const log = input.log ?? (() => {});

  /**
   * One completed round becomes exactly ONE observation and exactly ONE applied
   * action.
   *
   * Everything upstream has already happened by the time this runs: the provider
   * call, normalization, SignalEvent fusion (performed inside the invoker, so the
   * evidence is canonical before any decision reads it), the Company Brain gate and
   * the decision-maker funnel. That ordering is why the observation can report
   * FUSED yield rather than raw rows.
   */
  const onObservation = async (round: RoundObservationInput): Promise<RoundObservationOutcome | void> => {
    // The slices are returned on EVERY path, success or halt, so a stopped run
    // still checkpoints the evidence and the ledger it already paid for.
    const slices = () => ({
      [SOURCE_EXECUTION_KEY]: state,
      [FUSION_STATE_KEY]: fusion,
      [SOURCE_FEEDBACK_KEY]: feedback,
      // The pack ledger travels with the state it describes, so a resumed run
      // cannot re-run a consumed pack or buy a second feedback request.
      //
      // ONLY once the adaptive path has actually run. A checkpoint written on the
      // pre-existing path must carry exactly the keys it carried before — a new
      // key there would change persisted shape for every run whose flags are off.
      ...(adaptiveEngaged ? { [ADAPTIVE_PACK_STATE_KEY]: adaptivePackState } : {}),
    });

    let phase: TransitionPhase = "observation_construction";
    const stepId = state.current_step_id ?? approved.steps[0]?.stepId ?? null;
    const record = stepId ? stepOf(state, stepId) : null;
    const step = stepId ? approved.steps.find((x) => x.stepId === stepId) : undefined;

    const halt = (reason: string, extra: Record<string, unknown> = {}): RoundObservationOutcome => {
      lastTransitionFailure = {
        phase, reason,
        stepId: stepId ?? null,
        attempt: record?.attempts ?? null,
        planHash: approved.planHash,
        providerCallCompleted: round.providerCalls > 0,
        evidenceFusionCompleted: handle.lastOutcome()?.fusion != null,
        ...extra,
      };
      log("[sequential-source] transition failed", lastTransitionFailure);
      return {
        checkpointSlices: slices(),
        halt: {
          code: "source_observation_transition_failed",
          reason,
          diagnostics: { ...lastTransitionFailure },
        },
      };
    };

    // A round that cannot be attributed to a step is a control-plane failure, not
    // a quiet no-op: the plan is running and we cannot say where.
    if (!stepId || !record || !step) return halt("current_step_unresolvable");

    try {
      const observation = buildObservation({ round, stepId, step: step.capability, record, fusion });

      // Fused metrics and the evidence hash come from PR #109's state, never
      // recomputed here.
      const fused = fusedMetricsFrom(fusion, handle.lastOutcome()?.fusion ?? null);
      const evidenceHash = await fusedEvidenceHash(fusion);
      const taskIdHash = await shortId(input.taskId);
      const workspaceIdHash = await shortId(input.workspaceId);

      // FEEDBACK FAILURES ARE NOT CONTROL-PLANE FAILURES. Everything the model can
      // do wrong — unavailable, no credential, timeout, malformed, rejected, budget
      // spent — is already resolved to the deterministic action inside this call,
      // which is why it sits under `feedback_resolution` and is expected to return
      // normally rather than throw.
      phase = "feedback_resolution";
      const feedbackInput = {
        workspaceId: input.workspaceId,
        taskId: input.taskId,
        plan: approved,
        state,
        observation,
        fused,
        evidenceHash,
        ledger: feedback,
        companyBrainPolicyHash: input.companyBrainPolicyHash ?? "",
        taskIdHash,
        workspaceIdHash,
        // ONE OWNER. This bridge only ever runs for
        // workflow = qualified_lead_sourcing + execution_mode = company_first,
        // and on that workflow the strategist that authored the initial strategy
        // also interprets the observation. Omitting `generate` here would fall
        // through to the shared `generateJson` gateway, whose `orchestration_plan`
        // task type routes to Gemini — a second brain answering the same question.
        // Tests still inject their own `generate` and take precedence.
        generate: input.generate ?? createStrategistGenerateJson(),
        readEnv: input.readEnv,

      };

      // ---- SOURCE-FEEDBACK BINDING ---------------------------------------
      //
      // When validated packs exist, the adaptive layer decides — but the MODEL
      // CALL is still `decideNextActionWithFeedback`, wrapped by
      // `bindFeedbackAskClaude`. There is exactly one request, made by the
      // existing implementation, under the existing flags and the existing
      // per-task ledger. This adds validation and an honest bottleneck on top of
      // that answer; it does not add a second caller.
      //
      // Without packs the pre-existing path runs verbatim.
      // THE ROUTE GATE, NOT JUST THE PACKS. With the feedback flags off this
      // branch must not run at all — not merely reach a deterministic answer —
      // otherwise a disabled run would still take a different code path and
      // write an extra checkpoint key.
      const feedbackRoute = routeAdaptiveLeadDecision({
        workflow: "qualified_lead_sourcing",
        executionMode: "company_first",
        workspaceId: input.workspaceId,
        decision: "source_observation_feedback",
        strategyContractAvailable: true,
        read: input.readEnv,
      });
      const packs = activePacks;
      if (feedbackRoute.useClaude && packs && packs.length > 0 && round.stages) {
        const nextStep = approved.steps.find((s) => s.stepId !== stepId && !stepFinished(s.stepId));
        const binding = bindFeedbackAskClaude(
          async () => {
            const r = await decideNextActionWithFeedback(feedbackInput);
            lastFeedback = r;
            return {
              action: r.action, source: r.source,
              modelCalled: r.modelCalled, skippedReason: r.skippedReason,
            };
          },
          { nextCapability: nextStep?.capability ?? null },
        );

        const adaptive = await runAdaptiveRound({
          stepId, capability: step.capability,
          stages: round.stages,
          packs, packState: adaptivePackState,
          packIdsUsed: [], titlesUsed: step.semanticIntent.approvedTitleAliases ?? [],
          requestedLeads: approved.completionCondition.target,
          totalContactReady: round.totalEligibleLeads,
          remainingBudgetUsd: round.remainingBudgetUsd,
          providerCallsRemaining: Math.max(0, approved.maximumProviderCalls - state.provider_calls),
          completedSources: state.completed_step_ids,
          remainingSources: approved.steps.filter((s) => !stepFinished(s.stepId) && s.stepId !== stepId).map((s) => s.capability),
          peopleSearchCompletedForQualified: state.people_searched_company_keys.length > 0,
          peopleNeedingContact: 0,
          seniorityBroadeningAvailable: false,
          recencyBroadeningAvailable: false,
          approvedCapabilities: approved.steps.map((s) => s.capability),
          maximumAgeDays: step.semanticIntent.postingWindowDays ?? 60,
          nextStepId: nextStep?.stepId ?? null,
          nextCapability: nextStep?.capability ?? null,
          peopleNeedingContactIds: [], companiesNeedingIdentityIds: [],
          askClaude: binding.askClaude,
        });
        adaptiveEngaged = true;
        adaptivePackState = adaptive.packState;
        lastAdaptive = { ...adaptiveRuntimeDiagnostics(adaptive), gateway: binding.lastCall() };

        // The EXISTING mutator applies it. Same function, same union, same rules.
        const appliedAdaptive = applyObservation(approved, state, observation, adaptive.approved ?? undefined);
        phase = "state_transition";
        if (!appliedAdaptive.action) return halt("accepted_action_unresolved");
        log("[sequential-source] round observed (adaptive)", {
          round: round.round, step: stepId,
          action: appliedAdaptive.action.action,
          chosen: adaptive.chosen.action, source: adaptive.chosenSource,
          fallback: adaptive.fallbackReason, stopped: appliedAdaptive.stopped,
        });
        phase = "checkpoint_persistence";
        return { checkpointSlices: slices() };
      }

      const applied = await applyObservationWithFeedback(feedbackInput);

      // `applyObservationWithFeedback` folds the action itself, so reaching here
      // means the transition happened.
      phase = "state_transition";
      if (!applied.action) return halt("accepted_action_unresolved");

      lastFeedback = applied.feedback;
      log("[sequential-source] round observed", {
        round: round.round, step: stepId,
        action: applied.action.action, source: applied.feedback.source,
        skipped: applied.feedback.skippedReason, stopped: applied.stopped,
      });

      phase = "checkpoint_persistence";
      return { checkpointSlices: slices() };
    } catch (e) {
      // Whatever threw, the safe category is all that is kept — an exception
      // message can carry a provider payload or a prompt fragment.
      return halt(safeObserverFailure(e));
    }
  };

  return {
    invokeJobs: handle.invokeJobs,
    enabled: true,
    reason: "enabled",
    plan: approved,
    state,
    fusion,
    feedback,
    lastOutcome: handle.lastOutcome,
    onObservation,
    lastFeedback: () => lastFeedback,
    lastAdaptiveDecision: () => lastAdaptive,
    strategyProvenance: () => ({ ...strategyProvenance, plan_hash: approved.planHash }),
    lastTransitionFailure: () => lastTransitionFailure,
    nextPendingDiscoverySource: () => {
      // Verification steps are excluded on purpose: ATS needs a known company
      // identity, so a pending ATS step is not a reason to keep discovery alive.
      const discoveryRoles = new Set(
        approved.steps.filter((s) => s.role !== "verification").map((s) => s.stepId),
      );
      const next = [...state.steps]
        .sort((a, b) => a.order - b.order)
        .find((s) => discoveryRoles.has(s.step_id) && !isStepFinished(s));
      if (!next) return { pending: false, stepId: null, capability: null, actorKey: null };
      return {
        pending: true,
        stepId: next.step_id,
        capability: next.capability,
        actorKey: next.actor_key,
      };
    },
  };
}

/** A short, non-reversible id for the feedback prompt. Never the raw identifier. */
async function shortId(value: string): Promise<string> {
  return (await sha256Hex(canonicalJson({ v: value }))).slice(0, 16);
}

/**
 * Build the observation from MEASURED round outcomes plus fused evidence.
 *
 * The two sources are deliberate. The round supplies what the funnel did — Company
 * Brain passes, people searched, employers verified, CONTACT-ready. Fusion supplies
 * what the evidence actually amounts to once duplicates across sources collapse.
 * Using the round's raw row count for both would let twenty-five copies of one
 * posting read as twenty-five findings.
 */
export function buildObservation(args: {
  round: RoundObservationInput;
  stepId: string;
  step: string;
  record: { attempts: number; broadening_used: string[] };
  fusion: HiringEvidenceFusionState | null;
}): SourceStepObservation {
  const { round, fusion } = args;
  const f = round.funnel as unknown as Record<string, number>;
  const n = (k: string) => Number(f[k] ?? 0) || 0;
  const companies = Object.values(fusion?.companies ?? {});

  return {
    stepId: args.stepId,
    capability: args.step,
    attempt: Math.max(1, args.record.attempts),
    funnel: {
      rawResults: round.rawRows,
      normalizedJobs: n("unique_jobs") || round.newUniqueJobs,
      // FUSED companies when fusion has them; the round's own count otherwise.
      uniqueCompanies: companies.length > 0 ? companies.length : round.newUniqueCompanies,
      companyBrainPass: n("companies_qualified"),
      companyBrainFail: n("companies_rejected"),
      evidencePending: companies.filter((c) =>
        c.latestTimingDecision === undefined || c.latestTimingDecision === "missing_timing_evidence").length,
      strongIdentity: companies.filter((c) => c.strongIdentity).length,
      peopleSearched: n("people_calls"),
      employerVerified: n("employer_verified"),
      contactReady: n("contact"),
    },
    rejectionSummary: {
      wrongRole: n("job_family_fail"),
      wrongGeography: 0,
      companyBrainMismatch: n("companies_rejected"),
      missingIdentity: n("companies_missing_identity"),
      missingDecisionMaker: Math.max(0, n("profiles_returned") - n("person_role_pass")),
      employerMismatch: n("employer_ambiguous"),
      missingContactMethod: Math.max(0, n("person_role_pass") - n("contact")),
    },
    // CONTACT-READY ONLY. Jobs, signals and companies never count, whatever their
    // volume — `newEligibleLeads` is already the quota-eligible delta.
    incrementalContactReady: round.newEligibleLeads,
    totalContactReady: round.totalEligibleLeads,
    remainingQuota: round.remainingQuota,
    remainingBudgetUsd: round.remainingBudgetUsd,
    sourceExhausted: round.sourceExhausted,
    broadeningActionsUsed: [...args.record.broadening_used],
  };
}

/** Safe diagnostics for the task result. Absent-by-default when disabled. */
export function sequentialSourceDiagnostics(r: SequentialSourceBridgeResult): Record<string, unknown> {
  if (!r.enabled || !r.plan || !r.state) {
    const d = r.disabledDetail;
    // A future audit must be answerable from ONE task result. `enablement_reason`
    // alone could not distinguish a flag from five unprovisioned Actors.
    return {
      sequential_source_execution: false,
      enabled: false,
      enablement_reason: r.reason,
      reason: r.reason,
      workspace_match: d?.workspaceMatch ?? false,
      ordered_plan_created: d?.orderedPlanCreated ?? false,
      capabilities_requested: d?.capabilitiesRequested ?? [],
      capabilities_accepted: d?.capabilitiesAccepted ?? [],
      // Per-step CODES only — the difference between "we planned nothing" and
      // "we planned four steps and every Actor was disabled".
      step_rejections: d?.stepRejections ?? [],
      current_step: null,
      completed_steps: [],
      observation_count: 0,
      feedback_eligible: false,
    };
  }
  const lastFeedback = r.lastFeedback();
  return {
    sequential_source_execution: true,
    enablement_reason: r.reason,
    ...sourceExecutionDiagnostics(r.plan, r.state, r.lastOutcome()),
    ...(r.fusion ? { evidence_fusion: fusionDiagnostics(r.fusion, r.lastOutcome()?.fusion ?? null) } : {}),
    // Ledger-level only. The per-checkpoint record is reported by the feedback
    // runtime itself, which is the only thing that has one.
    // Present ONLY when a fold failed. Its absence is the healthy signal.
    ...(r.lastTransitionFailure() ? { source_transition_failure: r.lastTransitionFailure() } : {}),
    ...(r.feedback ? {
      source_feedback: {
        calls_used: r.feedback.callsUsed,
        calls_remaining: Math.max(0, MAX_SOURCE_FEEDBACK_CALLS_PER_TASK - r.feedback.callsUsed),
        checkpoints: r.feedback.checkpoints.length,
        statuses: r.feedback.checkpoints.map((c) => c.status),
        // Per-checkpoint provenance. Truncated hashes and codes only — never a
        // prompt, a response body, hidden reasoning or a credential.
        history: r.feedback.checkpoints.map((c) => ({
          request_key: c.requestKey.slice(0, 16),
          observation_hash: c.observationHash.slice(0, 16),
          status: c.status,
          reason_code: c.reasonCode ?? null,
          recommended_action: c.recommendedAction?.action ?? null,
          accepted_action: c.acceptedAction?.action ?? null,
          validation_reason_codes: c.validationReasonCodes ?? [],
        })),
        ...(lastFeedback ? { last_decision: sourceFeedbackDiagnostics(lastFeedback, r.feedback) } : {}),
      },
    } : {}),
  };
}
