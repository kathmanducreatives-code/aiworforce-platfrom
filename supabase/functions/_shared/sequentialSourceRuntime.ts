// SEQUENTIAL EXECUTION OF A VALIDATED ORDERED SOURCE PLAN.
//
// PR #107 produced an ordered, conditional decision graph. This module RUNS it —
// one discovery step at a time — through the machinery that already exists.
//
// THE SEAM. The company-first pipeline reaches providers through exactly one
// function, `invokeJobs(envelope, max)`. So this module does not execute anything
// itself: it WRAPS that function. `sequentialJobsInvoker` returns something with
// the same signature, which the existing quota controller, Company Brain gate,
// decision-maker workflow and persistence path call exactly as they do today.
//
// That is the whole reason there is no second executor, no second quota
// authority, no second task type and no second continuation system here. The
// ordered plan decides WHICH source the next call goes to; everything after the
// call is unchanged.
//
//   existing controller -> invokeJobs(envelope, max)      <- unchanged caller
//                            |
//                            v
//                    [ this decorator ]
//                      select active step (only one)
//                      compile via actorInputPlanner
//                      idempotency check
//                      call the INJECTED provider fn     <- the existing executor
//                      dedupe + record
//                            |
//                            v
//                    existing normalization, Company Brain,
//                    people search, employer verification, quota
//
// PURE except for the injected provider function. No network, model or database
// access of its own.

import {
  applyBroadeningToIntent, compileHiringSourceInput,
  type BroadeningIntentChange, type HiringSourceCompileResult, type HiringSourceIntent,
} from "./actorInputPlanner.ts";
import {
  decideNextAction, isSafeBroadeningAction,
  type OrderedHiringSourcePlan, type OrderedSourceStep, type SourceRuntimeState,
  type SourceStepObservation, type ApprovedSourceNextAction,
} from "./hiringSourcePlan.ts";
import { resolveHiringSourceActor } from "./hiringSourceCatalog.ts";
import {
  dedupeAgainstState, hasSentInput, isStepFinished, jobDedupeKey, stepOf,
  type SourceExecutionState, type SourceStepRecord,
} from "./sourceExecutionState.ts";
import {
  fuseSourceResults, type FusionSourceId, type FuseSourceOutcome,
  type HiringEvidenceFusionState,
} from "./hiringEvidenceFusion.ts";

// ------------------------------------------------------------- activation ---

export type ActivationRefusal =
  | "quota_met"
  | "no_plan_steps"
  | "budget_exhausted"
  | "provider_call_limit_reached"
  | "step_already_finished"
  | "not_yet_activated"
  | "verification_requires_company_identity"
  | "no_remaining_step";

export type ActivationDecision =
  | { ok: true; step: OrderedSourceStep; record: SourceStepRecord }
  | { ok: false; reason: ActivationRefusal; stepId?: string };

export interface ActivationContext {
  /** Companies with a resolved ATS type + slug. Gates verification steps. */
  atsIdentitiesAvailable?: number;
  /** True when job evidence is weak, stale or conflicting. Gates verification. */
  jobEvidenceUncertain?: boolean;
}

/**
 * Which step, if any, may call a provider right now.
 *
 * At most ONE, and never a step the plan has not activated. The first call of a
 * task may only run the step whose `activationCondition` is `initial`; every later
 * step becomes reachable only because `applyObservation` advanced to it. That is
 * what stops "here are five approved sources" from meaning "run five sources".
 */
export function selectExecutableStep(
  plan: OrderedHiringSourcePlan,
  state: SourceExecutionState,
  ctx: ActivationContext = {},
): ActivationDecision {
  if (plan.steps.length === 0) return { ok: false, reason: "no_plan_steps" };

  // Quota is the completion authority. A satisfied request never pays again.
  if (state.total_contact_ready >= plan.completionCondition.target) {
    return { ok: false, reason: "quota_met" };
  }
  if (state.provider_calls >= plan.maximumProviderCalls) {
    return { ok: false, reason: "provider_call_limit_reached" };
  }
  if (state.cumulative_cost >= plan.maximumEstimatedCostUsd) {
    return { ok: false, reason: "budget_exhausted" };
  }

  // The current step keeps the floor until it is finished; otherwise the first
  // step of the plan starts the task.
  const currentId = state.current_step_id
    ?? plan.steps.find((s) => s.activationCondition === "initial")?.stepId
    ?? null;
  if (!currentId) return { ok: false, reason: "no_remaining_step" };

  const step = plan.steps.find((s) => s.stepId === currentId);
  const record = stepOf(state, currentId);
  if (!step || !record) return { ok: false, reason: "no_remaining_step", stepId: currentId };

  if (isStepFinished(record)) return { ok: false, reason: "step_already_finished", stepId: currentId };

  // A verification step is conditional on identity, never on ambition. Without a
  // resolved company and ATS slug there is nothing to verify, and running it would
  // be a paid call that cannot succeed.
  if (step.role === "verification") {
    const haveIdentity = (ctx.atsIdentitiesAvailable ?? 0) > 0;
    const warranted = ctx.jobEvidenceUncertain === true
      || step.activationCondition === "known_ats_identity";
    if (!haveIdentity || !warranted) {
      return { ok: false, reason: "verification_requires_company_identity", stepId: currentId };
    }
  }

  return { ok: true, step, record };
}

// -------------------------------------------------------------- compiling ---

export interface PreparedCall {
  stepId: string;
  capability: string;
  actorKey: string;
  input: Record<string, unknown>;
  inputHash: string;
  idempotencyKey: string;
  repairs: string[];
  summary: Record<string, unknown>;
}

export type PrepareResult =
  | { ok: true; call: PreparedCall }
  | { ok: false; status: "deferred" | "rejected" | "duplicate_input"; reason: string; stepId: string };

/** Deterministic identity for one paid call. Same step + attempt + input ⇒ same key. */
export function sourceIdempotencyKey(taskId: string, stepId: string, attempt: number, inputHash: string): string {
  return `${taskId}:${stepId}:a${attempt}:${inputHash.slice(0, 16)}`;
}

/**
 * Compile the active step's semantic intent through the EXISTING Actor input
 * planner, and refuse to re-send an input this step already sent.
 *
 * The duplicate guard matters most during broadening: a rung that happens to
 * produce the same bounded input as the previous attempt would otherwise pay for
 * an identical call and record it as progress.
 */
export async function prepareStepCall(args: {
  taskId: string;
  step: OrderedSourceStep;
  state: SourceExecutionState;
  broadening?: BroadeningIntentChange | null;
}): Promise<PrepareResult> {
  const { step, state } = args;
  const intent = step.semanticIntent;

  // ONE application authority. `applyBroadeningToIntent` is the same function the
  // plan used to decide this rung was worth offering, so the rung that was judged
  // compatible is exactly the rung that executes.
  const compiled: HiringSourceCompileResult = await compileHiringSourceInput(
    applyBroadeningToIntent({
      capability: step.capability,
      roleFamily: intent.roleFamily,
      titleAliases: [...(intent.approvedTitleAliases ?? [])],
      geography: intent.geography,
      postingWindowDays: intent.postingWindowDays,
      remotePolicy: (intent.remotePolicy ?? null) as HiringSourceIntent["remotePolicy"],
      employmentTypes: intent.employmentTypes,
      candidateTarget: intent.candidateTarget,
    }, args.broadening),
  );

  if (!compiled.ok) {
    return { ok: false, status: compiled.status, reason: compiled.reason, stepId: step.stepId };
  }
  if (hasSentInput(state, step.stepId, compiled.inputHash)) {
    return {
      ok: false, status: "duplicate_input", stepId: step.stepId,
      reason: `input ${compiled.inputHash.slice(0, 12)} was already sent for this step`,
    };
  }

  const attempt = (stepOf(state, step.stepId)?.attempts ?? 0) + 1;
  return {
    ok: true,
    call: {
      stepId: step.stepId,
      capability: compiled.capability,
      actorKey: compiled.actorKey,
      input: compiled.input,
      inputHash: compiled.inputHash,
      idempotencyKey: sourceIdempotencyKey(args.taskId, step.stepId, attempt, compiled.inputHash),
      repairs: compiled.repairs,
      summary: compiled.summary,
    },
  };
}

// ------------------------------------------------------------- the invoker --

export interface SequentialInvokerDeps {
  taskId: string;
  plan: OrderedHiringSourcePlan;
  state: SourceExecutionState;
  /**
   * The EXISTING provider path. run-agent injects the same function it already
   * gives the company-first executor; nothing here talks to a provider directly.
   */
  invokeJobs: (envelope: Record<string, unknown>, max: number) => Promise<unknown[]>;
  /** Existing durable ledger. A key found here is NOT paid for again. */
  alreadyPaid?: (key: string) => Promise<boolean> | boolean;
  /** Per-call cost estimate, for the plan's own ceiling. */
  costPerCall?: number;
  activationContext?: () => ActivationContext;
  /**
   * Fuse each source's rows into canonical evidence IMMEDIATELY after the attempt,
   * rather than at task completion. Optional: without it the runtime behaves
   * exactly as PR #108 shipped, so fusion is additive rather than a new
   * precondition.
   */
  fusion?: { state: HiringEvidenceFusionState; workspaceId: string };
  log?: (msg: string, meta?: unknown) => void;
  now?: () => string;
}

export interface SequentialCallOutcome {
  ran: boolean;
  stepId: string | null;
  actorKey: string | null;
  rawCount: number;
  freshCount: number;
  duplicateCount: number;
  reason: string | null;
  idempotencyKey: string | null;
  /**
   * Fused yield. Present only when a fusion state was supplied.
   *
   * `freshCount` above counts rows this task had not SEEN; this counts what they
   * actually added to the evidence picture. Twenty-five duplicate postings are
   * real rows and zero new events, and only the second number should ever look
   * like progress to the plan.
   */
  fusion: FuseSourceOutcome | null;
}

/** The last outcome, for diagnostics. Set by the invoker on every call. */
export interface SequentialInvokerHandle {
  invokeJobs: (envelope: Record<string, unknown>, max: number) => Promise<unknown[]>;
  lastOutcome: () => SequentialCallOutcome | null;
}

/**
 * Wrap the existing jobs invoker so provider calls follow the ordered plan.
 *
 * Returns something with the SAME signature the company-first controller already
 * calls, so the controller is unmodified. When the plan says no step may run, it
 * returns an empty batch rather than throwing: an empty batch is a state the
 * controller already handles correctly, and throwing would turn "the plan says
 * stop" into a task failure.
 */
export function sequentialJobsInvoker(deps: SequentialInvokerDeps): SequentialInvokerHandle {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => new Date().toISOString());
  let last: SequentialCallOutcome | null = null;

  const invokeJobs = async (envelope: Record<string, unknown>, max: number): Promise<unknown[]> => {
    const ctx = deps.activationContext?.() ?? {};
    const decision = selectExecutableStep(deps.plan, deps.state, ctx);
    if (!decision.ok) {
      last = {
        ran: false, stepId: decision.stepId ?? null, actorKey: null,
        rawCount: 0, freshCount: 0, duplicateCount: 0,
        reason: decision.reason, idempotencyKey: null, fusion: null,
      };
      log("[sequential-source] no step executable", { reason: decision.reason });
      return [];
    }

    const { step, record } = decision;
    deps.state.current_step_id = step.stepId;
    record.status = "active";

    const prepared = await prepareStepCall({ taskId: deps.taskId, step, state: deps.state });
    if (!prepared.ok) {
      // A deferred verification step is not a failure — it simply cannot run yet.
      record.status = prepared.status === "deferred" ? "deferred" : record.status;
      if (prepared.status === "rejected") { record.status = "failed"; record.failure_category = prepared.reason; }
      last = {
        ran: false, stepId: step.stepId, actorKey: null,
        rawCount: 0, freshCount: 0, duplicateCount: 0,
        reason: `${prepared.status}:${prepared.reason}`, idempotencyKey: null, fusion: null,
      };
      log("[sequential-source] step not runnable", { step: step.stepId, status: prepared.status });
      return [];
    }

    const call = prepared.call;

    // The EXISTING durable ledger decides whether this was already paid for.
    if (deps.alreadyPaid && await deps.alreadyPaid(call.idempotencyKey)) {
      last = {
        ran: false, stepId: step.stepId, actorKey: call.actorKey,
        rawCount: 0, freshCount: 0, duplicateCount: 0,
        reason: "already_paid", idempotencyKey: call.idempotencyKey, fusion: null,
      };
      log("[sequential-source] call already completed", { step: step.stepId, key: call.idempotencyKey });
      return [];
    }

    record.attempts += 1;
    record.input_hashes.push(call.inputHash);
    record.idempotency_keys.push(call.idempotencyKey);
    deps.state.current_attempt = record.attempts;
    deps.state.provider_calls += 1;

    // Carry the wrapper's own controls through, and put the compiled Actor-native
    // input where the existing provider path expects it. The caller's envelope is
    // preserved so nothing downstream loses context it already depends on.
    const merged: Record<string, unknown> = {
      ...envelope,
      selected_actor_key: call.actorKey,
      idempotency_key: call.idempotencyKey,
      input: call.input,
      // THIS PAYLOAD IS ALREADY THE ACTOR'S OWN SHAPE.
      //
      // `compileHiringSourceInput` produced it for THIS capability and it has been
      // validated and hashed. Marking it is what stops the provider layer treating
      // it as generic hints and rebuilding it with another vendor's serializer —
      // the defect that sent Curious-Coder keys to Crawlworks and drew
      // "Field input.jobsToFetch is required" from Apify.
      compiled_actor_input: true,
      capability_key: call.capability,
      compiled_input_hash: call.inputHash,
    };

    let raw: unknown[] = [];
    try {
      raw = await deps.invokeJobs(merged, max);
    } catch (e) {
      // A provider failure ends THIS step, not the task: the ordered plan may
      // still have an approved fallback, and failing everything would throw away
      // work already paid for.
      record.status = "failed";
      record.failure_category = safeFailureCategory(e);
      deps.state.cumulative_cost += deps.costPerCall ?? 0;
      deps.state.checkpoint_at = now();
      last = {
        ran: true, stepId: step.stepId, actorKey: call.actorKey,
        rawCount: 0, freshCount: 0, duplicateCount: 0,
        reason: `provider_failed:${record.failure_category}`, idempotencyKey: call.idempotencyKey, fusion: null,
      };
      log("[sequential-source] provider failed", { step: step.stepId, category: record.failure_category });
      return [];
    }

    const rows = Array.isArray(raw) ? raw : [];
    // TASK-LOCAL dedupe before anything downstream sees these rows, so one opening
    // seen through two sources produces one company decision, not two.
    const dedupe = dedupeAgainstState(deps.state.seen_job_keys, rows, (r) => jobDedupeKey(asJob(r)));

    record.cost += deps.costPerCall ?? 0;
    deps.state.cumulative_cost += deps.costPerCall ?? 0;
    deps.state.checkpoint_at = now();

    // FUSE NOW, not at task completion: the plan's next decision depends on what
    // this source actually ADDED, and that is only knowable after reconciliation.
    let fusion: FuseSourceOutcome | null = null;
    const fusionSource = fusionSourceFor(step.capability);
    if (deps.fusion && fusionSource) {
      fusion = await fuseSourceResults({
        state: deps.fusion.state,
        source: fusionSource,
        actorKey: call.actorKey,
        rows: [...dedupe.fresh, ...dedupe.unidentified] as Array<Record<string, unknown>>,
        workspaceId: deps.fusion.workspaceId,
        observedAt: now(),
      });
    }

    last = {
      ran: true, stepId: step.stepId, actorKey: call.actorKey,
      rawCount: rows.length, freshCount: dedupe.fresh.length, duplicateCount: dedupe.duplicates.length,
      reason: null, idempotencyKey: call.idempotencyKey, fusion,
    };
    log("[sequential-source] step executed", {
      step: step.stepId, actor: call.actorKey,
      raw: rows.length, fresh: dedupe.fresh.length, duplicates: dedupe.duplicates.length,
    });

    // Unidentified rows are passed through: they cannot be deduplicated, and
    // dropping them would silently lose real jobs.
    return [...dedupe.fresh, ...dedupe.unidentified];
  };

  return { invokeJobs, lastOutcome: () => last };
}

/** The ordered plan's capability ids ARE the fusion source ids. */
function fusionSourceFor(capability: string): FusionSourceId | null {
  switch (capability) {
    case "yc_job_discovery": case "indeed_job_discovery": case "linkedin_job_discovery":
    case "glassdoor_job_discovery": case "ats_job_verification":
      return capability;
    default: return null;
  }
}

function asJob(row: unknown): Parameters<typeof jobDedupeKey>[0] {
  const r = (row ?? {}) as Record<string, unknown>;
  return {
    providerJobId: (r.id ?? r.jobId ?? r.job_id ?? null) as string | null,
    jobUrl: (r.url ?? r.jobUrl ?? r.job_url ?? r.link ?? null) as string | null,
    companyName: (r.company ?? r.companyName ?? r.company_name ?? null) as string | null,
    title: (r.title ?? r.jobTitle ?? r.job_title ?? null) as string | null,
    location: (r.location ?? r.jobLocation ?? null) as string | null,
  };
}

/** A short, safe category. Never the provider's raw message. */
export function safeFailureCategory(e: unknown): string {
  const msg = String((e as { message?: unknown })?.message ?? e ?? "").toLowerCase();
  if (/timeout|timed out|etimedout/.test(msg)) return "timeout";
  if (/rate.?limit|429/.test(msg)) return "rate_limited";
  if (/quota|credit|402|payment/.test(msg)) return "provider_quota_exhausted";
  if (/401|403|unauthor|forbidden/.test(msg)) return "provider_auth_error";
  if (/404|not found/.test(msg)) return "provider_not_found";
  if (/5\d\d|server error|internal/.test(msg)) return "provider_server_error";
  if (/network|econn|socket|dns/.test(msg)) return "network_error";
  return "provider_error";
}

// --------------------------------------------------------- runtime state ----

/**
 * Project the execution state into the shape the deterministic authority reads.
 *
 * A TRANSLATION, not a second store: every value is read straight off the
 * checkpoint. It exists so `hiringSourcePlan` can stay pure and free of any
 * dependency on the execution state's own shape, while still deciding from what
 * actually happened rather than from the plan alone.
 */
export function runtimeStateFor(state: SourceExecutionState): SourceRuntimeState {
  const broadeningUsedByStep: Record<string, string[]> = {};
  for (const s of state.steps) {
    if (s.broadening_used.length > 0) broadeningUsedByStep[s.step_id] = [...s.broadening_used];
  }
  return {
    finishedStepIds: state.steps.filter(isStepFinished).map((s) => s.step_id),
    broadeningUsedByStep,
    providerCallsUsed: state.provider_calls,
    cumulativeCostUsd: state.cumulative_cost,
  };
}

/**
 * Add the rungs that would compile to an input this step already sent.
 *
 * Separate from `runtimeStateFor`, and asynchronous, because compilation runs
 * through the existing Actor input planner. Callers that cannot await — the
 * synchronous `applyObservation` — simply do without it and lose nothing they had
 * before; the duplicate is still caught at `prepareStepCall` when the call is
 * assembled. Callers that CAN await get the stronger guarantee: a rung whose call
 * has already been paid for is never even offered.
 */
export async function withDuplicateBroadening(
  runtime: SourceRuntimeState,
  args: { taskId: string; plan: OrderedHiringSourcePlan; state: SourceExecutionState; stepId: string },
): Promise<SourceRuntimeState> {
  const step = args.plan.steps.find((s) => s.stepId === args.stepId);
  const record = stepOf(args.state, args.stepId);
  if (!step || !record || record.input_hashes.length === 0) return runtime;

  const duplicates: string[] = [];
  for (const rung of step.broadeningLadder ?? []) {
    if (!isSafeBroadeningAction(rung)) continue;
    const prepared = await prepareStepCall({
      taskId: args.taskId, step, state: args.state, broadening: rung as BroadeningIntentChange,
    });
    if (!prepared.ok && prepared.status === "duplicate_input") duplicates.push(rung.action);
  }
  if (duplicates.length === 0) return runtime;

  return {
    ...runtime,
    duplicateBroadeningByStep: { ...(runtime.duplicateBroadeningByStep ?? {}), [args.stepId]: duplicates },
  };
}

// ------------------------------------------------------------ observation ---

export interface ApplyObservationResult {
  action: ApprovedSourceNextAction;
  /** True when the plan is finished and nothing further may run. */
  stopped: boolean;
}

/**
 * Fold one step's observed funnel back into the state and decide what happens
 * next, using PR #107's `decideNextAction`.
 *
 * CONTACT-ready is the completion authority. Raw job volume is deliberately not
 * consulted here: a source that returned four hundred jobs and zero contactable
 * founders has not succeeded, and treating volume as success is what makes a run
 * keep paying for the wrong thing.
 *
 * `decided` lets a caller supply an action that has ALREADY been chosen and
 * validated — PR #110's bounded feedback does, having compared a recommendation
 * against `decideNextAction`'s own answer. It changes only WHICH approved action is
 * folded in; every state transition below is identical either way, so there is one
 * place that knows what "advance" does to a checkpoint. Omitting it is the default
 * and is byte-for-byte today's behavior.
 */
export function applyObservation(
  plan: OrderedHiringSourcePlan,
  state: SourceExecutionState,
  observation: SourceStepObservation,
  decided?: ApprovedSourceNextAction,
): ApplyObservationResult {
  const record = stepOf(state, observation.stepId);
  if (record) {
    record.contact_ready_delta += observation.incrementalContactReady;
    if (observation.sourceExhausted) record.status = "exhausted";
  }

  state.total_contact_ready = observation.totalContactReady;
  state.remaining_quota = Math.max(0, plan.completionCondition.target - observation.totalContactReady);

  // STATE-AWARE. The checkpoint is projected into the deterministic authority, so
  // it can never advance toward a step this task has already finished.
  const action = decided ?? decideNextAction(plan, observation, runtimeStateFor(state));
  state.pending_next_action = action.action;

  switch (action.action) {
    case "stop_quota_reached": {
      if (record) record.status = "completed";
      if (!state.completed_step_ids.includes(observation.stepId)) {
        state.completed_step_ids.push(observation.stepId);
      }
      // Every remaining step is explicitly marked, so a reader can see WHY four
      // approved sources never ran.
      for (const s of state.steps) {
        if (s.step_id === observation.stepId) continue;
        if (!isStepFinished(s)) { s.status = "inactive_quota_met"; s.inactive_reason = "contact_quota_met"; }
      }
      state.early_stop_reason = "contact_ready_quota_met";
      state.current_step_id = null;
      return { action, stopped: true };
    }

    case "broaden_current_source": {
      if (record && isSafeBroadeningAction(action.broadeningAction)) {
        record.broadening_used.push(action.broadeningAction.action);
        record.status = "active";
      }
      // PIN the step explicitly. A checkpoint written between this decision and
      // the next provider call must resume ON this step; leaving the field null
      // would send a resumed run back to the plan's initial step and re-pay for
      // work this step has already done.
      state.current_step_id = observation.stepId;
      return { action, stopped: false };
    }

    case "advance_to_next_source": {
      if (record && record.status !== "failed") {
        record.status = record.status === "exhausted" ? "exhausted" : "completed";
      }
      const finishedList = record?.status === "exhausted" ? state.exhausted_step_ids : state.completed_step_ids;
      if (!finishedList.includes(observation.stepId)) finishedList.push(observation.stepId);
      state.current_step_id = action.nextStepId;
      state.current_attempt = 0;
      return { action, stopped: false };
    }

    case "stop_valid_exhaustion": {
      if (record && !isStepFinished(record)) record.status = "exhausted";
      if (!state.exhausted_step_ids.includes(observation.stepId)) {
        state.exhausted_step_ids.push(observation.stepId);
      }
      state.exhaustion_reason = action.reason;
      state.current_step_id = null;
      return { action, stopped: true };
    }

    default:
      return { action, stopped: false };
  }
}

// ----------------------------------------------------------- diagnostics ----

/** Safe diagnostics. No prompts, credentials, raw Actor input or contact data. */
export function sourceExecutionDiagnostics(
  plan: OrderedHiringSourcePlan,
  state: SourceExecutionState,
  last?: SequentialCallOutcome | null,
): Record<string, unknown> {
  return {
    ordered_plan_hash: state.plan_hash,
    plan_version: plan.version,
    active_step_id: state.current_step_id,
    active_attempt: state.current_attempt,
    ordered_capabilities: plan.steps.map((s) => s.capability),
    steps: state.steps.map((s) => ({
      step_id: s.step_id, order: s.order, capability: s.capability,
      actor_key: s.actor_key, status: s.status, attempts: s.attempts,
      broadening_used: s.broadening_used,
      // Truncated: enough to correlate two runs, never enough to reconstruct input.
      input_hashes: s.input_hashes.map((h) => h.slice(0, 12)),
      contact_ready_delta: s.contact_ready_delta,
      failure_category: s.failure_category,
      inactive_reason: s.inactive_reason,
    })),
    provider_calls: state.provider_calls,
    maximum_provider_calls: plan.maximumProviderCalls,
    cumulative_cost: state.cumulative_cost,
    maximum_estimated_cost_usd: plan.maximumEstimatedCostUsd,
    total_contact_ready: state.total_contact_ready,
    remaining_quota: state.remaining_quota,
    completion_target: plan.completionCondition.target,
    deduplicated_jobs: state.seen_job_keys.length,
    deduplicated_companies: state.seen_company_keys.length,
    people_searched_companies: state.people_searched_company_keys.length,
    pending_next_action: state.pending_next_action,
    early_stop_reason: state.early_stop_reason,
    valid_exhaustion_reason: state.exhaustion_reason,
    ...(last ? {
      last_call: {
        ran: last.ran, step_id: last.stepId, actor_key: last.actorKey,
        raw: last.rawCount, fresh: last.freshCount, duplicates: last.duplicateCount,
        reason: last.reason,
      },
    } : {}),
  };
}

/** Resolve a capability to its registry key without exposing the actor id. */
export function actorKeyForCapability(capability: string): string | null {
  const r = resolveHiringSourceActor(capability as never);
  return r.ok ? r.actorKey : null;
}
