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
import { resolveHiringSourceActor, HIRING_SOURCE_CATALOG } from "./hiringSourceCatalog.ts";
import { decideDiscoveryBatchSize, batchDecisionDiagnostics, type DiscoveryBatchDecision } from "./discoveryBatchSize.ts";
import {
  allocateBatchAcrossPacks, packAllocationDiagnostics,
  type PackAllocationDecision, type ProviderLimitScope,
} from "./discoveryBatchAllocation.ts";
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
  /** The quota-aware batch decision, when one was made. Null for ATS. */
  batchDecision?: Record<string, unknown> | null;
  /**
   * Which query pack this call executes, when the step was split into packs.
   * Null for an unsplit step. Packs are NEVER merged into one query.
   */
  queryPackId?: string | null;
  /** How the step's batch was split across packs. Present on split calls only. */
  packAllocation?: Record<string, unknown> | null;
}

export type PrepareResult =
  | { ok: true; call: PreparedCall }
  | { ok: false; status: "deferred" | "rejected" | "duplicate_input"; reason: string; stepId: string };

/**
 * Deterministic identity for one paid call.
 *
 * SOURCE IDENTITY IS PART OF THE KEY. The key previously named only the step, so
 * two calls that differed by the ACTOR finally selected (a capability re-resolved
 * to a different provider between attempts) or by the QUERY PACK being executed
 * could not be told apart in `completed_calls`, and a legitimately distinct paid
 * call could be suppressed as "already paid". The final actor key and the pack id
 * are therefore named explicitly rather than left implicit in the input hash.
 */
export function sourceIdempotencyKey(
  taskId: string,
  stepId: string,
  attempt: number,
  inputHash: string,
  identity?: { actorKey?: string | null; queryPackId?: string | null },
): string {
  const actor = String(identity?.actorKey ?? "").trim();
  const pack = String(identity?.queryPackId ?? "").trim();
  return [
    taskId,
    stepId,
    actor ? `actor=${actor}` : null,
    pack ? `pack=${pack}` : null,
    `a${attempt}`,
    inputHash.slice(0, 16),
  ].filter(Boolean).join(":");
}


/**
 * Compile the active step's semantic intent through the EXISTING Actor input
 * planner, and refuse to re-send an input this step already sent.
 *
 * The duplicate guard matters most during broadening: a rung that happens to
 * produce the same bounded input as the previous attempt would otherwise pay for
 * an identical call and record it as progress.
 */
/** Capabilities whose result limit is a DISCOVERY batch. ATS is not one of them. */
const DISCOVERY_CAPABILITIES: ReadonlySet<string> = new Set([
  "indeed_job_discovery", "linkedin_job_discovery",
  "glassdoor_job_discovery", "yc_job_discovery",
]);

/**
 * Which provider field carries the batch, per capability.
 *
 * Four different names for the same idea, verified in PR #123. Recorded rather
 * than inferred so a trace states the field that actually carried the number, and
 * so `jobsToFetch` is never read as if it bounded the run.
 */
export const PROVIDER_LIMIT_FIELD: Readonly<Record<string, string>> = {
  indeed_job_discovery: "maxItems",
  linkedin_job_discovery: "jobsToFetch",
  glassdoor_job_discovery: "limit",
  yc_job_discovery: "maxResults",
  // Per-company verification cap, NOT a discovery batch.
  ats_job_verification: "maxJobsPerCompany",
};

/** What each provider's limit actually bounds. Crawlworks applies it per URL. */
export const PROVIDER_LIMIT_SCOPE: Readonly<Record<string, "per_run" | "per_query">> = {
  indeed_job_discovery: "per_run",
  linkedin_job_discovery: "per_query",
  glassdoor_job_discovery: "per_run",
  yc_job_discovery: "per_run",
  ats_job_verification: "per_query",
};

export async function prepareStepCall(args: {
  taskId: string;
  step: OrderedSourceStep;
  state: SourceExecutionState;
  broadening?: BroadeningIntentChange | null;
  /**
   * What the batch authority needs that step state does not carry.
   *
   * Absent ⇒ the step's planned `candidateTarget` is used unchanged, which is the
   * pre-existing behaviour every current caller relies on.
   */
  batchContext?: {
    /** The capability's own ceiling, from its operating policy. */
    providerMaximum: number;
    /** Estimated cost of one provider call, in USD. */
    costPerCallUsd: number;
    /** Hard spend ceiling for this task, in USD. */
    budgetCapUsd: number;
    /** Raw rows per CONTACT-ready lead observed so far on this run. */
    observedRowsPerLead?: number | null;
  } | null;
}): Promise<PrepareResult> {
  const { step, state } = args;
  const intent = step.semanticIntent;

  // ---- QUOTA-AWARE DISCOVERY BATCH ---------------------------------------
  //
  // `decideDiscoveryBatchSize` shipped in PR #121 with tests and no caller: a grep
  // for it across `supabase/functions` matched only its own test file. The value
  // that actually reached providers came from `validateOrderedPlan`, which defaults
  // `candidateTarget` to a literal 25 (`step_target_defaulted`) and only ever
  // clamps it upward-bounded by the capability ceiling. Remaining quota never
  // entered the calculation, so a run owing 1 lead asked for exactly as many rows
  // as one owing 5.
  //
  // The batch is decided HERE, immediately before compilation, because this is the
  // first point that can see BOTH the plan's ceiling and the live quota. ATS is
  // excluded on purpose: its `maxJobsPerCompany` is a per-company cap on
  // verification, not a discovery batch, and driving it from remaining quota would
  // conflate two different quantities.
  let effectiveTarget = intent.candidateTarget;
  let batchDecision: DiscoveryBatchDecision | null = null;
  if (args.batchContext && DISCOVERY_CAPABILITIES.has(step.capability)) {
    const remaining = Math.max(0, state.remaining_quota);
    batchDecision = decideDiscoveryBatchSize({
      requestedLeads: remaining + Math.max(0, state.total_contact_ready),
      remainingLeads: remaining,
      sourceMaximum: args.batchContext.providerMaximum,
      remainingBudgetUsd: Math.max(0, args.batchContext.budgetCapUsd - state.cumulative_cost),
      costPerCallUsd: args.batchContext.costPerCallUsd,
      observedRowsPerLead: args.batchContext.observedRowsPerLead ?? null,
      completedSources: state.completed_step_ids.length,
    });
    // A met quota yields 0 — the caller must not issue a call at all.
    if (batchDecision.count === 0) {
      return {
        ok: false, status: "rejected", stepId: step.stepId,
        reason: `discovery_batch_zero:${batchDecision.reason}`,
      };
    }
    effectiveTarget = batchDecision.count;
  }

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
      candidateTarget: effectiveTarget,
      // NOTE: `companies` is deliberately NOT forwarded. `OrderedSourceStep`'s
      // semanticIntent carries no such field, so ATS verification always compiles
      // to `deferred:ats_verification_requires_resolved_company_slug`. Resolving
      // where company identities should enter this call is a design question, not a
      // one-line forward, and is left to the ATS work rather than guessed at here.
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
      idempotencyKey: sourceIdempotencyKey(args.taskId, step.stepId, attempt, compiled.inputHash, {
        actorKey: compiled.actorKey,
      }),
      repairs: compiled.repairs,
      summary: compiled.summary,
      queryPackId: null,
      packAllocation: null,
      // The batch decision travels with the call so the trace can show WHY this
      // many rows were requested, and which provider field carried the number.
      batchDecision: batchDecision
        ? {
            ...batchDecisionDiagnostics(batchDecision),
            provider_limit_field: PROVIDER_LIMIT_FIELD[compiled.capability] ?? null,
            provider_limit_scope: PROVIDER_LIMIT_SCOPE[compiled.capability] ?? null,
          }
        : null,
    },
  };
}

// ------------------------------------------------------- separate packs -----
//
// PRESERVING QUERY PACKS THROUGH EXECUTION.
//
// The strategy owner emits several bounded query packs, each ONE coherent search
// intent. `prepareStepCall` compiles a single merged `titleAliases` list, which
// collapses those intents into one `A OR B OR C` query — precisely the merge the
// strategy contract forbids, because the provider then ranks whatever it likes
// highest and the early-stage packs never surface.
//
// This function keeps them separate: one compiled call PER PACK, each with its own
// share of the approved batch (`allocateBatchAcrossPacks` owns that arithmetic,
// including the per-query multiplication hazard), its own input hash and its own
// idempotency key. A pack whose input was already sent is skipped, not merged.

export interface StepQueryPack {
  packId: string;
  /** Titles for THIS pack only. Never the union of every pack. */
  titleAliases: string[];
}

export interface PreparePackResult {
  calls: PreparedCall[];
  /** Packs that were not funded or not issued, with the reason. */
  skipped: Array<{ packId: string; status: "deferred" | "rejected" | "duplicate_input" | "unfunded"; reason: string }>;
  allocation: Record<string, unknown> | null;
}

export async function prepareStepPackCalls(args: {
  taskId: string;
  step: OrderedSourceStep;
  state: SourceExecutionState;
  queryPacks: StepQueryPack[];
  /** Total rows the batch authority approved for this step. */
  totalBatch: number;
  providerMaximum: number;
  maximumQueries?: number | null;
  broadening?: BroadeningIntentChange | null;
}): Promise<PreparePackResult> {
  const { step, state } = args;
  const intent = step.semanticIntent;
  const packs = args.queryPacks.filter((p) => p && p.packId && (p.titleAliases ?? []).length > 0);
  const skipped: PreparePackResult["skipped"] = [];

  if (packs.length === 0) return { calls: [], skipped, allocation: null };

  const scope = (PROVIDER_LIMIT_SCOPE[step.capability] ?? "per_run") as ProviderLimitScope;
  const decision: PackAllocationDecision = allocateBatchAcrossPacks({
    totalBatch: args.totalBatch,
    packIds: packs.map((p) => p.packId),
    scope,
    providerMaximum: args.providerMaximum,
    maximumQueries: args.maximumQueries ?? null,
  });
  const allocation = packAllocationDiagnostics(decision);

  for (const packId of decision.droppedPackIds) {
    skipped.push({ packId, status: "unfunded", reason: `pack_not_funded:${decision.reason}` });
  }

  const calls: PreparedCall[] = [];
  const attemptBase = (stepOf(state, step.stepId)?.attempts ?? 0) + 1;

  for (const alloc of decision.allocations) {
    const pack = packs.find((p) => p.packId === alloc.packId);
    if (!pack) continue;

    const compiled: HiringSourceCompileResult = await compileHiringSourceInput(
      applyBroadeningToIntent({
        capability: step.capability,
        roleFamily: intent.roleFamily,
        // THIS pack's titles only.
        titleAliases: [...pack.titleAliases],
        geography: intent.geography,
        postingWindowDays: intent.postingWindowDays,
        remotePolicy: (intent.remotePolicy ?? null) as HiringSourceIntent["remotePolicy"],
        employmentTypes: intent.employmentTypes,
        candidateTarget: alloc.allocatedResults,
      }, args.broadening),
    );

    if (!compiled.ok) {
      skipped.push({ packId: pack.packId, status: compiled.status, reason: compiled.reason });
      continue;
    }
    if (hasSentInput(state, step.stepId, compiled.inputHash)) {
      skipped.push({
        packId: pack.packId, status: "duplicate_input",
        reason: `input ${compiled.inputHash.slice(0, 12)} was already sent for this step`,
      });
      continue;
    }

    calls.push({
      stepId: step.stepId,
      capability: compiled.capability,
      actorKey: compiled.actorKey,
      input: compiled.input,
      inputHash: compiled.inputHash,
      idempotencyKey: sourceIdempotencyKey(args.taskId, step.stepId, attemptBase, compiled.inputHash, {
        actorKey: compiled.actorKey,
        queryPackId: pack.packId,
      }),
      repairs: compiled.repairs,
      summary: compiled.summary,
      queryPackId: pack.packId,
      packAllocation: {
        ...allocation,
        pack_id: pack.packId,
        allocated_results: alloc.allocatedResults,
        provider_limit_field: PROVIDER_LIMIT_FIELD[compiled.capability] ?? null,
      },
      batchDecision: null,
    });
  }

  return { calls, skipped, allocation };
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
  /**
   * The validated query packs for this mission, when the strategy produced any.
   *
   * Supplying them makes the step execute ONE PAID CALL PER PACK through
   * `prepareStepPackCalls` — each with its own titles, batch allocation, input
   * hash and idempotency identity. Omitting them keeps the pre-existing single
   * merged-alias call exactly as it was.
   *
   * `prepareStepPackCalls` shipped tested but with NO production caller, which is
   * why production task 9cb98f67 sent
   * `"Sales Operations OR Revenue Operations OR GTM Operations"` to all three
   * Actors: the merge happened in `prepareStepCall`, which passes
   * `intent.approvedTitleAliases` as one list.
   */
  queryPacks?: StepQueryPack[];
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

    // THE BATCH IS DECIDED FROM LIVE QUOTA, not from the plan's default of 25.
    // The capability's own ceiling and the plan's spend cap are the bounds; the
    // remaining CONTACT-ready quota is the driver.
    const prepared = await prepareStepCall({
      taskId: deps.taskId, step, state: deps.state,
      batchContext: {
        // The capability's own verified ceiling — the same value the compiler
        // clamps to, so the batch authority and the compiler cannot disagree.
        providerMaximum: HIRING_SOURCE_CATALOG[step.capability]?.operatingPolicy.maximumResultsPerCall
          ?? step.semanticIntent.candidateTarget,
        costPerCallUsd: deps.costPerCall ?? 0,
        budgetCapUsd: deps.plan.maximumEstimatedCostUsd,
        // NOT YET AVAILABLE. `SourceExecutionState` records contact-ready totals
        // and provider calls, but not raw rows returned, so a real rows-per-lead
        // ratio cannot be derived here. Passing null uses the conservative default
        // rather than inventing a multiplier from numbers that do not measure it.
        observedRowsPerLead: null,
      },
    });
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

    // ONE CALL PER QUERY PACK.
    //
    // With packs supplied, `prepareStepPackCalls` splits this step into separate
    // paid calls — each carrying its own titles, batch allocation, input hash and
    // idempotency key, and recording unfunded packs as SKIPPED rather than folding
    // them into a neighbour. Without packs the single prepared call runs exactly as
    // before, so every existing caller is unchanged.
    const packs = deps.queryPacks ?? [];
    let calls: PreparedCall[] = [prepared.call];
    if (packs.length > 0) {
      const split = await prepareStepPackCalls({
        taskId: deps.taskId, step, state: deps.state, queryPacks: packs,
        totalBatch: Number(prepared.call.batchDecision?.count ?? step.semanticIntent.candidateTarget),
        providerMaximum: HIRING_SOURCE_CATALOG[step.capability]?.operatingPolicy.maximumResultsPerCall
          ?? step.semanticIntent.candidateTarget,
      });
      if (split.calls.length > 0) {
        calls = split.calls;
        for (const sk of split.skipped) {
          log("[sequential-source] pack skipped", { step: step.stepId, pack: sk.packId, reason: sk.reason });
        }
      }
    }

    const allRows: unknown[] = [];
    const allFresh: unknown[] = [];
    let rawTotal = 0, freshTotal = 0, dupTotal = 0;
    let lastKey: string | null = null;
    let lastFusion: FuseSourceOutcome | null = null;

    for (const call of calls) {
      // The EXISTING durable ledger decides whether THIS pack was already paid for.
      if (deps.alreadyPaid && await deps.alreadyPaid(call.idempotencyKey)) {
        log("[sequential-source] call already completed", { step: step.stepId, key: call.idempotencyKey });
        continue;
      }

      record.attempts += 1;
      record.input_hashes.push(call.inputHash);
      record.idempotency_keys.push(call.idempotencyKey);
      deps.state.current_attempt = record.attempts;
      deps.state.provider_calls += 1;
      lastKey = call.idempotencyKey;

      const merged: Record<string, unknown> = {
        ...envelope,
        selected_actor_key: call.actorKey,
        idempotency_key: call.idempotencyKey,
        input: call.input,
        // THIS PAYLOAD IS ALREADY THE ACTOR'S OWN SHAPE — see compileHiringSourceInput.
        compiled_actor_input: true,
        capability_key: call.capability,
        compiled_input_hash: call.inputHash,
        ...(call.queryPackId ? { query_pack_id: call.queryPackId } : {}),
      };

      let raw: unknown[] = [];
      try {
        raw = await deps.invokeJobs(merged, max);
      } catch (e) {
        // A provider failure ends THIS step, not the task.
        record.status = "failed";
        record.failure_category = safeFailureCategory(e);
        deps.state.cumulative_cost += deps.costPerCall ?? 0;
        deps.state.checkpoint_at = now();
        last = {
          ran: true, stepId: step.stepId, actorKey: call.actorKey,
          rawCount: rawTotal, freshCount: freshTotal, duplicateCount: dupTotal,
          reason: `provider_failed:${record.failure_category}`, idempotencyKey: call.idempotencyKey, fusion: lastFusion,
        };
        log("[sequential-source] provider failed", { step: step.stepId, category: record.failure_category });
        return allFresh;
      }

      const rows = Array.isArray(raw) ? raw : [];
      // TASK-LOCAL dedupe runs PER CALL against the shared ledger, so two packs
      // returning the same posting produce one company decision, not two.
      const dedupe = dedupeAgainstState(deps.state.seen_job_keys, rows, (r) => jobDedupeKey(asJob(r)));

      record.cost += deps.costPerCall ?? 0;
      deps.state.cumulative_cost += deps.costPerCall ?? 0;
      deps.state.checkpoint_at = now();

      const fusionSource = fusionSourceFor(step.capability);
      if (deps.fusion && fusionSource) {
        lastFusion = await fuseSourceResults({
          state: deps.fusion.state,
          source: fusionSource,
          actorKey: call.actorKey,
          rows: [...dedupe.fresh, ...dedupe.unidentified] as Array<Record<string, unknown>>,
          workspaceId: deps.fusion.workspaceId,
          observedAt: now(),
        });
      }

      rawTotal += rows.length;
      freshTotal += dedupe.fresh.length;
      dupTotal += dedupe.duplicates.length;
      allRows.push(...rows);
      allFresh.push(...dedupe.fresh, ...dedupe.unidentified);

      log("[sequential-source] pack executed", {
        step: step.stepId, actor: call.actorKey, pack: call.queryPackId ?? null,
        raw: rows.length, fresh: dedupe.fresh.length, duplicates: dedupe.duplicates.length,
      });
    }

    if (lastKey === null) {
      last = {
        ran: false, stepId: step.stepId, actorKey: calls[0]?.actorKey ?? null,
        rawCount: 0, freshCount: 0, duplicateCount: 0,
        reason: "already_paid", idempotencyKey: null, fusion: null,
      };
      return [];
    }

    last = {
      ran: true, stepId: step.stepId, actorKey: calls[0].actorKey,
      rawCount: rawTotal, freshCount: freshTotal, duplicateCount: dupTotal,
      reason: null, idempotencyKey: lastKey, fusion: lastFusion,
    };
    log("[sequential-source] step executed", {
      step: step.stepId, actor: calls[0].actorKey, packCalls: calls.length,
      raw: rawTotal, fresh: freshTotal, duplicates: dupTotal,
    });

    // Unidentified rows are passed through: they cannot be deduplicated, and
    // dropping them would silently lose real jobs.
    return allFresh;
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
