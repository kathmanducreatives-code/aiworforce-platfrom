// COMPANY-FIRST QUOTA CONTROLLER — the multi-round loop the audit found missing.
//
// v96 ran exactly one sourcing batch, counted successful DB writes, and reported
// `completed` with 0 CONTACT. The adaptive machinery (sourcingRetry.ts) existed but
// sat behind the company-first early return and was unreachable.
//
// This controller owns:
//   • remaining quota (eligible CONTACT leads, never raw rows or DB writes)
//   • bounded broadening between rounds (search space only, never gates)
//   • cross-round deduplication
//   • budget / call / round bounds
//   • honest terminal status
//
// A round never marks the task complete; only this controller does.

import type { LeadEntityIntent } from "./leadEntityIntent.ts";
import { runAgentCompoundExecution, type CompoundExecutionDeps } from "./runAgentCompoundExecution.ts";
import type { CompoundCandidate, CompoundLimits } from "./compoundSourcingPipeline.ts";
import { buildCompoundPersistencePlan, type CompoundPersistencePlan } from "./runAgentCompoundPersistenceAdapter.ts";
import { buildCompanyRowPersistencePlan, companyRowKey } from "./companyRowProjection.ts";

import { buildSourcingConstraints, type SourcingConstraints } from "./sourcingConstraints.ts";
import {
  buildInitialPlan, deterministicRoundPlan, sanitizePlannerInput,
  type BroadeningPlan, type BroadeningPlannerFn, type PlanSource, type RoundPlan,
} from "./broadeningPlan.ts";
import { validateRoundPlan, scanProposalForInjection } from "./broadeningValidator.ts";
import { classifyBottleneck, emptyFunnelSummary, remedyFor, type BottleneckKind, type FunnelSummary } from "./sourcingBottleneck.ts";
import { forecastRoundCost, roundIdempotencyKey, newIdempotencyLedger, DEFAULT_COST_POLICY, type CostForecast } from "./sourcingCostForecast.ts";
import { shortHash } from "./planHash.ts";
import { stampIdempotencyKey, lookupDurableCall, type ToolCallReader, type DurableLookupKind } from "./durableIdempotency.ts";
import type { PlannerMetadata } from "./broadeningPlannerAdapter.ts";
import {
  newSourcingState, stateBelongsTo, isResumable, deltaTitles, recordAttemptedTitles, hasCompletedCall, recordCompletedCall,
  type CompanyFirstSourcingState, type SourcingStateStore, type RoundCheckpoint,
} from "./companyFirstSourcingState.ts";
import { createExecutionDeadline, type ExecutionBudget, type ExecutionDeadline } from "./executionDeadline.ts";
import {
  countEligible, isQuotaEligibleCandidate, leadIdentityKey, remainingLeadCount,
  DEFAULT_QUOTA_POLICY, type QuotaPolicy,
} from "./leadQuotaPolicy.ts";
import { newWriteBoundary, type CompanyFirstWriteBoundary } from "./providerEvidenceMode.ts";
import type { Vertical } from "./verticalQualification.ts";

export type CompanyFirstTerminalStatus =
  | "completed" | "quota_not_met" | "search_exhausted" | "budget_exhausted"
  | "round_limit_reached" | "provider_failure" | "invalid_request"
  /**
   * The provider round succeeded but its outcome could not be folded into source
   * state. NOT `provider_failure`: the paid call worked, and blaming the provider
   * would point an operator at the wrong system.
   */
  | "source_transition_failed"
  /** NOT terminal: the safe time boundary was reached; the task can be resumed. */
  | "continuation_required";

export interface RoundRecord {
  round_number: number;
  requested_total: number;
  eligible_before_round: number;
  remaining_before_round: number;
  search_strategy: string;
  search_expansions: string[];
  provider_calls: number;
  raw_rows: number;
  new_unique_jobs: number;
  new_unique_companies: number;
  new_people: number;
  new_eligible_leads: number;
  rejections: number;
  duplicates_removed: number;
  budget_consumed: number;
  remaining_after_round: number;
  terminal_reason: string | null;
}

export interface QuotaControllerBounds {
  maxRounds: number;
  maxJobsCalls: number;
  maxPeopleCalls: number;
  /** Soft/hard spend guards, in the same unit the caller accounts in. */
  softBudget: number;
  hardBudget: number;
  /** Estimated cost charged per provider call for accounting. */
  costPerJobsCall: number;
  costPerPeopleCall: number;
}

export const DEFAULT_QUOTA_BOUNDS: QuotaControllerBounds = {
  maxRounds: 3, maxJobsCalls: 3, maxPeopleCalls: 24,
  softBudget: 4.5, hardBudget: 5.0, costPerJobsCall: 0.25, costPerPeopleCall: 0.12,
};

export interface QuotaControllerResult {
  terminal_status: CompanyFirstTerminalStatus;
  terminal_reason: string;
  requested_leads: number;
  eligible_leads: number;
  remaining_leads: number;
  rounds_attempted: number;
  expansions_attempted: string[];
  raw_jobs_processed: number;
  verified_companies: number;
  people_candidates: number;
  provider_calls: number;
  provider_side_writes: number;
  budget_consumed: number;
  rounds: RoundRecord[];
  /** Deduplicated candidates across every round. */
  candidates: CompoundCandidate[];
  /** Plans actually persisted (REJECT/SKIP excluded by policy). */
  persisted: Array<{ ok: boolean; accountId: string | null; leadCandidateId: string | null; reason?: string }>;
  writeBoundary: CompanyFirstWriteBoundary;
  /** Generalized broadening observability. */
  plan: BroadeningPlan | null;
  plan_sources: PlanSource[];
  bottlenecks: Array<{ round: number; kind: BottleneckKind; reason: string; remedy: string }>;
  cost_forecasts: CostForecast[];
  plan_validations: Array<{ round: number; approved: string[]; rejected: Array<{ title: string; reason: string }>; violations: string[] }>;
  /** Per-round planner provenance (no chain-of-thought, no secrets). */
  planner_metadata: Array<PlannerMetadata & { round: number }>;
  /** Continuation contract when the time boundary stopped the run. */
  continuation: {
    required: boolean;
    next_action: string;
    next_round: number | null;
    checkpoint_at: string | null;
    /** Stable identity a later invocation resumes with. */
    continuation_token: string | null;
    resumed_from_round: number;
  };
  /** Per-round durable-idempotency decision. */
  idempotency: Array<{ round: number; key: string; kind: DurableLookupKind; reason: string }>;
  /**
   * Set ONLY when a round's outcome could not be folded into source state.
   *
   * Its presence is what distinguishes "the run finished" from "the run stopped
   * because it no longer knew what it was doing" — a distinction the terminal
   * status alone used to hide.
   */
  source_transition_failure: (RoundObservationOutcome["halt"] & { round: number }) | null;
  /** Checkpoints the database rejected. Empty is the healthy state. */
  checkpoint_failures: Array<{ round: number; reason: string }>;
  /**
   * Ordered-source progression: which sources were finished and where the run
   * moved next. Empty under single-source execution.
   *
   * This is what makes "the search is exhausted" auditable. Production plan
   * 43fb7313 reported `search_exhausted` with three sources still pending and no
   * record of the distinction anywhere on the result.
   */
  source_progression: {
    active_source: string | null;
    exhausted_sources: Array<{ source: string | null; reason: string; round: number }>;
    advances: Array<{ from: string | null; to: string | null; reason: string; round: number }>;
  };
}

import type { CompanyBrainHardConstraints } from "./companyIcpFilter.ts";

export interface QuotaControllerOpts {
  /** Company Brain HARD constraints. Absent => not enforced (legacy callers). */
  brainConstraints?: CompanyBrainHardConstraints | null;
  brainPolicyHash?: string | null;
  requestedLeadCount: number;
  quotaPolicy?: QuotaPolicy;
  bounds?: Partial<QuotaControllerBounds>;
  limits?: Partial<CompoundLimits>;
  vertical?: Vertical;
  now?: string;
  workspaceId?: string;
  taskId?: string | null;
  /** Wall-clock budget; defaults sit below the Edge Function limit. */
  executionBudget?: Partial<ExecutionBudget>;
  /** Injectable clock so tests can simulate a platform kill without sleeping. */
  clock?: () => number;
  log?: (msg: string, meta?: unknown) => void;
}

/**
 * What one completed round actually produced, in full-funnel terms.
 *
 * Handed to `onRoundComplete` so a caller can build a source observation from
 * MEASURED outcomes rather than from raw provider rows. Raw volume is the one
 * number that reliably lies: four hundred jobs that collapse into three companies
 * and zero contactable founders is not a good round, and a strategy decision made
 * from `raw_rows` alone would read it as one.
 *
 * Scalars and the existing `FunnelSummary` only — no candidate objects, so the
 * controller stays free of any dependency on what a caller does with them.
 */
export interface RoundObservationInput {
  round: number;
  /** The round's measured funnel — the same one the checkpoint records. */
  funnel: FunnelSummary;
  rawRows: number;
  newUniqueJobs: number;
  newUniqueCompanies: number;
  newEligibleLeads: number;
  /** CONTACT-ready leads across the whole task, not just this round. */
  totalEligibleLeads: number;
  remainingQuota: number;
  remainingBudgetUsd: number;
  providerCalls: number;
  duplicatesRemoved: number;
  /** True when this round could not expand any further. */
  sourceExhausted: boolean;

  /**
   * THE FUNNEL STAGES, KEPT APART.
   *
   * Every count below is a measurement of one stage, in that stage's own units.
   * They exist because a summary that collapses them cannot distinguish failures
   * with opposite remedies — most importantly "no company was ever resolved" from
   * "companies were resolved and the Brain rejected them". An observer that only
   * saw `companies_rejected` reported the first as the second for a whole
   * production run, and drove a title-broadening round at a bottleneck that was
   * never about titles.
   *
   * Optional so every existing caller and test stays valid unchanged.
   */
  stages?: {
    /** Rows the provider returned, before any normalization. */
    providerRows: number;
    /** Rows that normalized into a usable job record. */
    normalizedJobs: number;
    /** Jobs whose title matched the requested role family. */
    titleMatches: number;
    /** Jobs dropped because the title was not the requested family. */
    titleRejections: number;
    /** Jobs dropped because the location was outside the requested geography. */
    geographyRejections: number;
    /** Companies whose identity resolved from an accepted job. */
    companiesResolved: number;
    /** Companies the Company Brain actually evaluated. */
    companiesEvaluated: number;
    /** Companies that passed the Company Brain. */
    companiesQualified: number;
    /** Companies the Company Brain evaluated and rejected. */
    companiesRejectedByBrain: number;
    /** Safe reason codes only, never payloads. */
    companyRejectionReasons: Record<string, number>;
    peopleSearched: number;
    employerVerified: number;
    contactReady: number;
  };
}

/** What a round-completion hook may contribute back to the checkpoint. */
export interface RoundObservationOutcome {
  /** Slices to store alongside the quota state, keyed by their owner's constant. */
  checkpointSlices?: Record<string, unknown>;
  /**
   * STOP. The observer could not establish what happens next.
   *
   * The hook owns source progression — broadening, advancement, stopping — so a
   * failure there is not missing telemetry, it is a runtime that no longer knows
   * its own state. Continuing would run the next round against stale state, hit
   * the duplicate-input guard, and return empty batches while the diagnostics
   * claimed everything was fine.
   *
   * Safe codes only. No exception payloads, prompts, provider records or contacts.
   */
  halt?: { code: string; reason: string; diagnostics?: Record<string, unknown> };
}

export interface QuotaControllerDeps extends CompoundExecutionDeps {
  /**
   * Called ONCE after each round is finalized and before the checkpoint is
   * written, so anything the hook records is saved with the round it describes.
   *
   * The smallest possible seam. The controller remains the sole quota authority
   * and the sole round loop; this only lets another authority observe a completed
   * round and hand back state to persist. It cannot change the quota, the terminal
   * status, or whether another round runs.
   */
  onRoundComplete?: (input: RoundObservationInput) => Promise<RoundObservationOutcome | void>;
  /**
   * READ-ONLY: does another approved discovery source remain runnable?
   *
   * Title exhaustion and SEARCH exhaustion are different facts, and this module
   * could only observe the first. Every `search_exhausted` branch below is really
   * "this source's title strategies are spent" — so production plan 43fb7313
   * ended the entire mission with LinkedIn, Glassdoor and ATS still `pending` and
   * the ordered state explicitly reading `pending_next_action:
   * advance_to_next_source`.
   *
   * This asks the ordered-source authority a question; it does not let that
   * authority answer for this one. The controller still decides the terminal
   * status, still owns the round loop, and still owns the quota.
   */
  pendingDiscoverySource?: () => {
    pending: boolean;
    stepId?: string | null;
    capability?: string | null;
    actorKey?: string | null;
  };
  /** INJECTED planner. Never called by this module in tests or offline runs. */
  proposeBroadening?: BroadeningPlannerFn;
  /** Safe provenance for the most recent planner call. */
  plannerMetadata?: () => PlannerMetadata | null;
  /** Restart-safe paid-call ledger backed by tool_calls (no migration). */
  durableIdempotency?: ToolCallReader;
  /** Checkpoint store over tasks.result (no migration). */
  stateStore?: SourcingStateStore;
}

export async function runCompanyFirstQuotaController(
  intent: LeadEntityIntent,
  deps: QuotaControllerDeps,
  opts: QuotaControllerOpts,
): Promise<QuotaControllerResult> {
  const bounds = { ...DEFAULT_QUOTA_BOUNDS, ...opts.bounds };
  const policy = opts.quotaPolicy ?? DEFAULT_QUOTA_POLICY;
  const requested = opts.requestedLeadCount;
  const log = opts.log ?? (() => {});

  const rounds: RoundRecord[] = [];
  const expansions: string[] = [];
  const dedupedCandidates: CompoundCandidate[] = [];
  const seenLeadKeys = new Set<string>();
  const seenCompanyKeys = new Set<string>();
  const seenJobUrls = new Set<string>();
  const writeBoundary = newWriteBoundary();
  const persisted: QuotaControllerResult["persisted"] = [];

  const constraints: SourcingConstraints = await buildSourcingConstraints(intent, {
    maxRawJobs: opts.limits?.rawJobs, maxCompanies: opts.limits?.verifiedCompanies,
    maxPeopleLookups: opts.limits?.founderLookups, peoplePerCompany: opts.limits?.foundersPerCompany,
  });
  const plan = await buildInitialPlan(constraints, intent.job_search_spec.original_query.slice(0, 120));
  const attemptedStrategies: string[] = [];
  const planSources: PlanSource[] = [];
  const bottlenecks: QuotaControllerResult["bottlenecks"] = [];
  const forecasts: CostForecast[] = [];
  const planValidations: QuotaControllerResult["plan_validations"] = [];
  const plannerMetadata: QuotaControllerResult["planner_metadata"] = [];
  const idempotency: QuotaControllerResult["idempotency"] = [];
  const ledger = newIdempotencyLedger();
  let lastFunnel: FunnelSummary | null = null;
  let lastBottleneck: BottleneckKind | null = null;

  // ---- ORDERED-SOURCE PROGRESSION ----------------------------------------
  //
  // The round loop below broadens TITLES. Under ordered multi-source execution it
  // also has to be able to move to the next SOURCE, because a title strategy
  // being spent on Indeed says nothing about LinkedIn. Three things become
  // per-source rather than global:
  //
  //   sourceRound          the round number the planner sees, so a new source
  //                        starts from the exact-title strategy again
  //   attemptedStrategies  a strategy hash is "already attempted" per source
  //   the title ledger     via deltaTitles(state, titles, activeSourceKey)
  //
  // Without all three, advancing would immediately re-derive "already searched"
  // and end the mission anyway.
  const initialSource = deps.pendingDiscoverySource?.();
  let activeSourceKey: string | null = initialSource?.actorKey ?? initialSource?.capability ?? null;
  let sourceRound = 1;
  const exhaustedSources: Array<{ source: string | null; reason: string; round: number }> = [];
  const sourceAdvances: Array<{ from: string | null; to: string | null; reason: string; round: number }> = [];
  /**
   * Sources this run has already activated.
   *
   * Advancing re-runs the same global round number, so this is what guarantees
   * termination: a source is entered at most once, and an oracle that kept
   * reporting the same step as pending would stop being able to advance rather
   * than spinning the loop.
   */
  const activatedSources = new Set<string>([activeSourceKey ?? "__initial__"]);

  /**
   * The current source's strategies are spent. Advance, checkpoint, or exhaust.
   *
   * Returns what the caller must do. The controller keeps the decision — this
   * only distinguishes "this source is finished" from "the search is finished".
   */
  const onSourceStrategiesSpent = (
    round: number,
    why: string,
    canRunAnother: boolean,
  ): "advance" | "checkpoint" | "exhaust" => {
    const next = deps.pendingDiscoverySource?.();
    if (!next?.pending) return "exhaust";
    const to = next.actorKey ?? next.capability ?? null;
    // Never re-enter a source. Without this an oracle that keeps naming the same
    // step would spin, because advancing replays the same global round.
    if (to === null || activatedSources.has(to)) return "exhaust";
    exhaustedSources.push({ source: activeSourceKey, reason: why, round });
    if (!canRunAnother) {
      // Truthful checkpoint: the next source is named, nothing is claimed done.
      sourceAdvances.push({ from: activeSourceKey, to, reason: `${why}; deferred to continuation`, round });
      return "checkpoint";
    }
    sourceAdvances.push({ from: activeSourceKey, to, reason: why, round });
    activeSourceKey = to;
    activatedSources.add(to);
    sourceRound = 1;
    attemptedStrategies.length = 0;
    return "advance";
  };
  /** Set only when the round observer could not establish the next action. */
  let transitionFailure: (RoundObservationOutcome["halt"] & { round: number }) | null = null;
  /** Checkpoints the database refused. Surfaced on the result, never swallowed. */
  const checkpointFailures: Array<{ round: number; reason: string }> = [];

  /**
   * One checkpoint write, with the outcome REPORTED.
   *
   * A rejected checkpoint used to be invisible: the store swallowed it and the
   * run carried on spending with nothing to resume from. Recording it on the
   * result is what makes "continuation will restart from round one" something an
   * operator can see instead of discover from an invoice.
   */
  const saveCheckpoint = async (status: string, patch?: Record<string, unknown>): Promise<void> => {
    if (!deps.stateStore || !taskId || !state) return;
    // A store that reports nothing is treated as success: older implementations
    // (and every injected test fake) return void, and inventing a failure from an
    // absent signal would be worse than having no signal.
    const saved = await deps.stateStore.save(taskId, state, status, patch);
    if (saved && saved.ok === false) {
      checkpointFailures.push({ round: state.current_round, reason: saved.reason ?? "unknown" });
      log("checkpoint rejected — continuation will not resume from here", {
        round: state.current_round, reason: saved.reason,
      });
    }
  };

  const deadline: ExecutionDeadline = createExecutionDeadline(opts.executionBudget, opts.clock);
  const nowIso = () => opts.now ?? new Date().toISOString();
  const taskId = opts.taskId ?? null;
  const wsId = opts.workspaceId ?? "";

  // RESUME: load a prior checkpoint for this exact task/workspace.
  let state: CompanyFirstSourcingState | null = null;
  if (deps.stateStore && taskId) {
    const loaded = await deps.stateStore.load(taskId);
    if (stateBelongsTo(loaded, wsId, taskId) && isResumable(loaded)) state = loaded;
  }
  const resumedFromRound = state ? state.current_round : 1;
  if (!state) {
    state = newSourcingState({ workspaceId: wsId, taskId: taskId ?? "no-task", requestedLeadCount: requested, quotaPolicy: policy, now: nowIso() });
  } else {
    // Rehydrate dedupe + accounting so a continuation never re-pays or double-counts.
    for (const u of state.seen_job_urls) seenJobUrls.add(u);
    for (const c of state.seen_company_keys) seenCompanyKeys.add(c);
    for (const k of state.seen_lead_keys) seenLeadKeys.add(k);
    for (const h of state.attempted_strategy_hashes) { attemptedStrategies.push(h); ledger.claim(h); }
    for (const r of state.completed_rounds) rounds.push(r as unknown as RoundRecord);
  }

  // Quota progress from EARLIER invocations. New candidates add on top; the
  // seen_lead_keys set stops the same lead being counted twice.
  const carriedEligible = state.eligible_leads;
  const carriedPersisted = new Set(state.persisted_lead_keys);
  let jobsCalls = 0, peopleCalls = 0, budget = state.actual_cost;
  let continuationRequired = false;
  let rawJobs = 0, verifiedCompanies = 0, peopleCandidates = 0;
  let terminal: CompanyFirstTerminalStatus | null = null;
  let terminalReason = "";

  if (!Number.isInteger(requested) || requested < 1) {
    return finish("invalid_request", `requested_lead_count must be a positive integer (got ${requested})`);
  }

  for (let round = resumedFromRound; round <= bounds.maxRounds; round++) {
    // TIME BOUNDARY — never begin a round that cannot finish safely.
    if (deadline.softExpired() || !deadline.canAfford("jobs")) {
      continuationRequired = true;
      terminal = "continuation_required";
      terminalReason = `safe execution window reached after ${Math.round(deadline.elapsedMs() / 1000)}s; ${rounds.length} round(s) checkpointed`;
      break;
    }
    const eligibleBefore = carriedEligible + countEligible(dedupedCandidates, policy);
    const remainingBefore = remainingLeadCount(requested, eligibleBefore);
    if (remainingBefore === 0) { terminal = "completed"; terminalReason = "quota reached"; break; }
    if (jobsCalls >= bounds.maxJobsCalls) { terminal = "search_exhausted"; terminalReason = "jobs-actor call budget reached"; break; }
    if (budget + bounds.costPerJobsCall > bounds.hardBudget) { terminal = "budget_exhausted"; terminalReason = "next round would exceed the hard budget"; break; }

    // ---- PLAN → VALIDATE → FORECAST, all before any provider call ---------
    let roundPlan: RoundPlan | null = null;
    let planSource: PlanSource = "deterministic_only";

    if (round > 1 && deps.proposeBroadening && deadline.canAfford("planner")) {
      // The planner sees ONLY typed summaries — never raw provider text.
      const input = sanitizePlannerInput(constraints, { requested, eligible: eligibleBefore, remaining: remainingBefore }, lastFunnel, lastBottleneck, attemptedStrategies, Math.max(0, bounds.hardBudget - budget));
      try {
        const proposal = await deps.proposeBroadening(input);
        if (!proposal) { planSource = "ai_unavailable_fallback_used"; }
        else if (scanProposalForInjection(proposal)) { planSource = "ai_rejected_fallback_used"; }
        else {
          const candidateRound: RoundPlan = {
            ...(deterministicRoundPlan(constraints, round, lastBottleneck) ?? { round_number: round, goal: "ai", title_queries: [], posting_window_days: null, raw_job_limit: constraints.soft.maxRawJobs, company_selection_limit: constraints.soft.maxCompanies, people_lookup_limit: constraints.soft.maxPeopleLookups, people_per_company: constraints.soft.peoplePerCompany, approved_actor_keys: [...constraints.soft.approvedActorKeys], proposed_changes: [], risk: "low", rationale: "", expected_bottleneck_impact: "unknown" }),
            title_queries: proposal.title_queries ?? [],
            goal: proposal.goal ?? "ai-proposed titles",
            rationale: proposal.rationale ?? "ai proposal",
          };
          const v = await validateRoundPlan(candidateRound, constraints, constraints.hard, attemptedStrategies);
          planValidations.push({ round, approved: v.approvedTitles, rejected: v.rejectedTitles, violations: v.violations });
          if (v.ok) { roundPlan = { ...candidateRound, title_queries: v.approvedTitles }; planSource = "ai_approved"; }
          else { planSource = "ai_rejected_fallback_used"; }
        }
      } catch { planSource = "ai_unavailable_fallback_used"; }
      const pm = deps.plannerMetadata?.();
      if (pm) plannerMetadata.push({ ...pm, round, status: planSource as PlannerMetadata["status"] });
    }

    // Deterministic fallback whenever the AI path did not yield an approved round.
    if (!roundPlan) roundPlan = deterministicRoundPlan(constraints, sourceRound, lastBottleneck);
    if (!roundPlan) {
      // TITLE exhaustion for THIS source, not the search.
      const move = onSourceStrategiesSpent(round, "no approved expansion remains for this job family", deadline.canAfford("jobs"));
      if (move === "advance") { round -= 1; continue; }
      if (move === "checkpoint") {
        continuationRequired = true;
        terminal = "continuation_required";
        terminalReason = "current source exhausted; next approved source deferred to continuation";
        break;
      }
      terminal = "search_exhausted"; terminalReason = "no approved expansion remains for this job family"; break;
    }

    // Scoped to the source: the same titles are a NEW strategy for a new provider.
    roundPlan.strategy_hash = await shortHash({
      titles: roundPlan.title_queries.slice().sort(), round: sourceRound, source: activeSourceKey ?? "default",
    });
    if (attemptedStrategies.includes(roundPlan.strategy_hash)) {
      const move = onSourceStrategiesSpent(round, "the only remaining strategy was already attempted", deadline.canAfford("jobs"));
      if (move === "advance") { round -= 1; continue; }
      if (move === "checkpoint") {
        continuationRequired = true;
        terminal = "continuation_required";
        terminalReason = "current source exhausted; next approved source deferred to continuation";
        break;
      }
      terminal = "search_exhausted"; terminalReason = "the only remaining strategy was already attempted"; break;
    }

    // Cost is forecast and approved BEFORE the provider is touched.
    const forecast: CostForecast = forecastRoundCost(roundPlan, budget, { ...DEFAULT_COST_POLICY, softBudget: bounds.softBudget, hardBudget: bounds.hardBudget, costPerJobsCall: bounds.costPerJobsCall, costPerPeopleCall: bounds.costPerPeopleCall });
    forecasts.push(forecast);
    if (!forecast.approved) { terminal = "budget_exhausted"; terminalReason = `round refused before execution: ${forecast.refusal_reason}`; break; }

    // Idempotency: the same paid round is never charged twice on a retry.
    // The ACTIVE source's key, not a constant. With `apify_jobs` hardcoded, the
    // same titles on a different provider produced the same key, so source 2
    // would have been refused as a duplicate of source 1's paid call.
    const idemKey = roundIdempotencyKey({
      taskId: opts.taskId ?? null, workspaceId: opts.workspaceId ?? "", round,
      strategyHash: roundPlan.strategy_hash, actorKey: activeSourceKey ?? "apify_jobs",
    });
    if (!ledger.claim(idemKey)) {
      // DUPLICATE INPUT IS NOT SEARCH EXHAUSTION. The strategy is unavailable;
      // nothing was invoked and nothing was charged. Advance if a source remains.
      const move = onSourceStrategiesSpent(round, "identical paid round already executed (in-process)", deadline.canAfford("jobs"));
      if (move === "advance") { round -= 1; continue; }
      if (move === "checkpoint") {
        continuationRequired = true;
        terminal = "continuation_required";
        terminalReason = "duplicate input blocked; next approved source deferred to continuation";
        break;
      }
      terminal = "search_exhausted"; terminalReason = "identical paid round already executed (in-process)"; break;
    }
    // RESTART-SAFE: an identical completed paid call in tool_calls is never repeated.
    if (deps.durableIdempotency) {
      const dur = await lookupDurableCall(deps.durableIdempotency, { workspaceId: opts.workspaceId ?? "", key: idemKey, now: opts.now });
      idempotency.push({ round, key: idemKey, kind: dur.kind, reason: dur.reason });
      if (dur.kind === "cached") {
        // The prior result already counted toward this run; do not re-charge and
        // do not count it twice. Still not search exhaustion — advance if another
        // approved source is pending.
        const move = onSourceStrategiesSpent(round, "an identical paid round already completed and was reused", deadline.canAfford("jobs"));
        if (move === "advance") { round -= 1; continue; }
        if (move === "checkpoint") {
          continuationRequired = true;
          terminal = "continuation_required";
          terminalReason = "duplicate input reused; next approved source deferred to continuation";
          break;
        }
        terminal = "search_exhausted";
        terminalReason = "an identical paid round already completed and was reused";
        break;
      }
    } else {
      idempotency.push({ round, key: idemKey, kind: "new", reason: "in-process ledger only" });
    }
    // The key travels with the envelope so tool_calls.input_json records it.
    const idempotencyStamp = idemKey;

    attemptedStrategies.push(roundPlan.strategy_hash);
    state.attempted_strategy_hashes.push(roundPlan.strategy_hash);
    planSources.push(planSource);
    // DELTA-ONLY, PER SOURCE: never re-send a title THIS source already searched.
    // Scoping matters — the global ledger meant Indeed's titles were treated as
    // spent for LinkedIn too, which is the branch that ended production plan
    // 43fb7313 with three sources still pending.
    const newTitles = deltaTitles(state, roundPlan.title_queries, activeSourceKey);
    if (newTitles.length === 0) {
      const move = onSourceStrategiesSpent(round, "every approved title for this family has already been searched", deadline.canAfford("jobs"));
      if (move === "advance") { round -= 1; continue; }
      if (move === "checkpoint") {
        continuationRequired = true;
        terminal = "continuation_required";
        terminalReason = "current source exhausted; next approved source deferred to continuation";
        break;
      }
      terminal = "search_exhausted";
      terminalReason = "every approved title for this family has already been searched";
      break;
    }
    // A completed jobs call for this exact key is reused, never re-paid.
    if (hasCompletedCall(state, idemKey)) {
      idempotency.push({ round, key: idemKey, kind: "cached", reason: "jobs call already completed in an earlier invocation" });
      continue;
    }
    const keywords = newTitles;
    const expansion = roundPlan.goal;
    if (!expansions.includes(expansion)) expansions.push(expansion);
    const roundLimits: Partial<CompoundLimits> = {
      ...opts.limits,
      rawJobs: roundPlan.raw_job_limit,
      verifiedCompanies: roundPlan.company_selection_limit,
      founderLookups: roundPlan.people_lookup_limit,
      foundersPerCompany: roundPlan.people_per_company,
    };

    let roundJobsCalls = 0, roundPeopleCalls = 0;
    const exec = await runAgentCompoundExecution(intent, {
      ...deps,
      invokeJobs: async (env, max) => { roundJobsCalls++; return deps.invokeJobs(env, max); },
      invokePeople: async (env, max) => { roundPeopleCalls++; return deps.invokePeople(env, max); },
      budgetProceed: () => {
        const spent = budget + roundJobsCalls * bounds.costPerJobsCall + roundPeopleCalls * bounds.costPerPeopleCall;
        // The HARD cap binds inside a round too — otherwise per-company people
        // calls could blow past it before the next round's check ran.
        const ceiling = Math.min(bounds.softBudget, bounds.hardBudget);
        return spent + bounds.costPerPeopleCall <= ceiling && (peopleCalls + roundPeopleCalls) < bounds.maxPeopleCalls;
      },
    }, {
      ...opts, limits: roundLimits, keywordQueriesOverride: keywords, idempotencyKey: idempotencyStamp,
      peopleIdempotencyKey: (companyKey: string) => roundIdempotencyKey({ taskId, workspaceId: wsId, round, strategyHash: `${roundPlan!.strategy_hash}:${companyKey}`, actorKey: "apify_people_search" }),
      peopleCallCompleted: (key: string) => {
        if (hasCompletedCall(state!, key)) return true;
        recordCompletedCall(state!, { idempotency_key: key, round, actor_key: "apify_people_search", company_key: key.split("::")[3] ?? null, item_count: 0, completed_at: nowIso() });
        return false;
      },
      persistCandidates: false,          // the controller owns persistence
    });

    jobsCalls += roundJobsCalls; peopleCalls += roundPeopleCalls;
    budget += roundJobsCalls * bounds.costPerJobsCall + roundPeopleCalls * bounds.costPerPeopleCall;
    writeBoundary.providerSideWrites += exec.writeBoundary.providerSideWrites;
    if (exec.writeBoundary.invariantViolation) writeBoundary.invariantViolation = exec.writeBoundary.invariantViolation;

    // ---- cross-round deduplication -----------------------------------------
    let dupes = 0, newJobs = 0, newCompanies = 0;
    for (const url of exec.run?.candidates.map((c) => c.jobEvidence.url) ?? []) {
      if (url && !seenJobUrls.has(url)) { seenJobUrls.add(url); newJobs++; }
    }
    const roundCandidates = exec.run?.candidates ?? [];
    for (const c of roundCandidates) {
      const key = leadIdentityKey(c);
      if (seenLeadKeys.has(key)) { dupes++; continue; }
      seenLeadKeys.add(key);
      const ck = c.account.dedupeKey ?? c.account.normalizedName ?? "";
      if (ck && !seenCompanyKeys.has(ck)) { seenCompanyKeys.add(ck); newCompanies++; }
      dedupedCandidates.push(c);
    }

    rawJobs += exec.run?.diagnostics.rawJobs ?? 0;
    verifiedCompanies += exec.run?.diagnostics.verifiedCompanies ?? 0;
    peopleCandidates += roundCandidates.length;
    writeBoundary.rawProviderItems += exec.writeBoundary.rawProviderItems;
    writeBoundary.normalizedJobs += exec.writeBoundary.normalizedJobs;
    writeBoundary.peopleResults += exec.writeBoundary.peopleResults;

    const eligibleAfter = carriedEligible + countEligible(dedupedCandidates, policy);
    const newEligible = eligibleAfter - eligibleBefore;

    rounds.push({
      round_number: round, requested_total: requested,
      eligible_before_round: eligibleBefore, remaining_before_round: remainingBefore,
      search_strategy: keywords.join(" | "), search_expansions: [expansion],
      provider_calls: roundJobsCalls + roundPeopleCalls, raw_rows: exec.writeBoundary.rawProviderItems,
      new_unique_jobs: newJobs, new_unique_companies: newCompanies,
      new_people: roundCandidates.length, new_eligible_leads: newEligible,
      rejections: roundCandidates.filter((c) => !isQuotaEligibleCandidate(c, policy)).length,
      duplicates_removed: dupes, budget_consumed: budget,
      remaining_after_round: remainingLeadCount(requested, eligibleAfter),
      terminal_reason: null,
    });

    // ---- MEASURED funnel → deterministic bottleneck → next round's goal ----
    const funnel: FunnelSummary = {
      ...emptyFunnelSummary(),
      raw_jobs: exec.writeBoundary.rawProviderItems,
      unique_jobs: newJobs,
      // TITLE-FAMILY IS A TITLE QUESTION. These two were derived from
      // `verifiedCompanies` — a COMPANY metric two stages downstream — so a run
      // whose titles matched perfectly reported `job_family_pass: 0` whenever no
      // company survived verification.
      //
      // Production run c34c0cad did exactly that: 50 raw jobs, of which
      // `classifyJobFamily` accepts 23 (18 sales_ops, 4 gtm_ops, 1 rev_ops), were
      // reported as 0 passing and 50 failing. `sourcingBottleneck` keys
      // `title_coverage` off this number, so the runtime concluded "title coverage
      // is too narrow" and drove a broadening round into Growth Operations and
      // Deal Desk — chasing a bottleneck that did not exist, while the real
      // failure (zero companies verified) went unreported.
      //
      // The pipeline already counted this correctly. `acceptedJobs` is the
      // title-family (and location) survivor count; the split below distinguishes
      // a title failure from a geography failure, because only one of them is an
      // argument for broadening titles.
      job_family_pass: exec.run?.diagnostics.acceptedJobs ?? 0,
      job_family_fail: exec.run?.diagnostics.droppedByFamily ?? 0,
      companies_qualified: exec.run?.diagnostics.verifiedCompanies ?? 0,
      // COMPANIES REJECTED IS A COMPANY COUNT. This was
      // `normalizedJobs - verifiedCompanies` — jobs minus companies, two
      // different units — so a round that resolved no company at all still
      // reported one "rejection" per normalized job. Production task c30fbc6d
      // reported 25 rejections having resolved zero companies, because 21 of its
      // 25 rows were dropped upstream at `missing_occurred_at` and the Company
      // Brain never saw them.
      //
      // `resolvedCompanies` is the identity stage; anything that resolved and did
      // not qualify is a real rejection. Both are company counts.
      companies_rejected: Math.max(
        0,
        (exec.run?.diagnostics.resolvedCompanies ?? 0) - (exec.run?.diagnostics.verifiedCompanies ?? 0),
      ),
      companies_missing_identity: roundCandidates.filter((c) => !c.account.dedupeKey).length,
      people_calls: roundPeopleCalls,
      profiles_returned: exec.writeBoundary.peopleResults,
      person_role_pass: roundCandidates.filter((c) => c.gates.person_role === "pass").length,
      employer_verified: roundCandidates.filter((c) => c.employer.outcome === "verified_match").length,
      employer_ambiguous: roundCandidates.filter((c) => c.employer.outcome === "ambiguous" || c.employer.outcome === "insufficient_evidence").length,
      contact: roundCandidates.filter((c) => c.verdict === "CONTACT").length,
      watch: roundCandidates.filter((c) => c.verdict === "WATCH").length,
      reject: roundCandidates.filter((c) => c.verdict === "REJECT").length,
      duplicates_removed: dupes,
      rejection_reason_counts: roundCandidates.reduce((acc: Record<string, number>, c) => {
        for (const [g, v] of Object.entries(c.gates)) if (v === "fail") acc[g] = (acc[g] ?? 0) + 1;
        return acc;
      }, {}),
    };
    lastFunnel = funnel;
    const expansionAvailable = deterministicRoundPlan(constraints, round + 1, null) !== null;
    const bn = classifyBottleneck(funnel, {
      remainingQuota: remainingLeadCount(requested, eligibleAfter),
      budgetRemaining: Math.max(0, bounds.hardBudget - budget),
      expansionAvailable,
    });
    lastBottleneck = bn.kind;
    bottlenecks.push({ round, kind: bn.kind, reason: bn.reason, remedy: remedyFor(bn.kind) });

    // ---- PER-ROUND guarded persistence: eligible/reviewable only, ONCE per lead.
    // Writing here (not only at the end) is what makes progress survive a kill.
    for (const cand of roundCandidates) {
      const lk = leadIdentityKey(cand);
      if (carriedPersisted.has(lk)) continue;
      const plan: CompoundPersistencePlan = buildCompoundPersistencePlan(cand, wsId);
      if (!plan.persistable) {                       // REJECT/SKIP → diagnostics only
        persisted.push({ ok: false, accountId: null, leadCandidateId: null, reason: plan.persistenceReason });
        continue;
      }
      writeBoundary.persistenceAttempts += 1;
      const pr = await deps.persist(plan);
      if (pr.ok) writeBoundary.persistedRecords += 1;
      carriedPersisted.add(lk);
      persisted.push({ ok: pr.ok, accountId: pr.accountId, leadCandidateId: pr.leadCandidateId, reason: pr.reason });
    }

    // ---- COMPANY ROWS: the qualified-but-pending companies reach the canonical
    // Workbench through the SAME writer. Before this, a company that cleared the
    // job gates, identity resolution and Company Brain but produced no verified
    // decision-maker was dropped entirely — the run showed raw job posts and an
    // empty Opportunities tab. These rows are account-stage and, by construction,
    // never quota-eligible: only a CONTACT person counts (see countEligible).
    for (const pending of exec.run?.pendingDecisionMakers ?? []) {
      const key = companyRowKey(pending);
      if (!key) continue;
      const ck = `company:${key}`;
      if (carriedPersisted.has(ck)) continue;
      const plan = buildCompanyRowPersistencePlan(pending, wsId);
      if (!plan.persistable) {
        persisted.push({ ok: false, accountId: null, leadCandidateId: null, reason: plan.persistenceReason });
        carriedPersisted.add(ck);
        continue;
      }
      writeBoundary.persistenceAttempts += 1;
      const pr = await deps.persist(plan);
      if (pr.ok) writeBoundary.persistedRecords += 1;
      carriedPersisted.add(ck);
      persisted.push({ ok: pr.ok, accountId: pr.accountId, leadCandidateId: pr.leadCandidateId, reason: pr.reason });
    }
    state.persisted_lead_keys = [...carriedPersisted];


    // ---- CHECKPOINT: a platform kill after this point loses nothing --------
    state.current_round = round + 1;
    state.eligible_leads = eligibleAfter;
    state.remaining_leads = remainingLeadCount(requested, eligibleAfter);
    // Recorded globally (audit trail) AND against the active source (delta gate).
    recordAttemptedTitles(state, keywords, activeSourceKey);
    // Rounds within the current source, so a later source re-plans from its own
    // exact-title strategy instead of inheriting this one's expansion depth.
    sourceRound += 1;
    state.seen_job_urls = [...seenJobUrls];
    state.seen_company_keys = [...seenCompanyKeys];
    state.seen_lead_keys = [...seenLeadKeys];
    state.estimated_cost = Number((state.estimated_cost + (forecast.estimated_provider_cost ?? 0)).toFixed(4));
    state.actual_cost = Number(budget.toFixed(4));
    state.next_action = "start_round";
    state.checkpoint_at = nowIso();
    recordCompletedCall(state, {
      idempotency_key: idemKey, round, actor_key: activeSourceKey ?? "apify_jobs", company_key: null,
      item_count: exec.writeBoundary.rawProviderItems, completed_at: nowIso(),
    });
    const checkpoint: RoundCheckpoint = {
      round_number: round, strategy_hash: roundPlan.strategy_hash,
      title_queries: roundPlan.title_queries, delta_titles: keywords,
      plan_source: planSource, planner_status: plannerMetadata.at(-1)?.status ?? null,
      funnel: Object.fromEntries(Object.entries(funnel).filter(([, v]) => typeof v === "number")) as Record<string, number>,
      eligible_after: eligibleAfter, remaining_after: remainingLeadCount(requested, eligibleAfter),
      estimated_cost: forecast.estimated_provider_cost ?? 0,
      actual_provider_calls: roundJobsCalls + roundPeopleCalls, completed_at: nowIso(),
    };
    state.completed_rounds.push(checkpoint);
    state.planner_metadata = plannerMetadata as unknown as Array<Record<string, unknown>>;

    // ---- ROUND OBSERVED --------------------------------------------------
    //
    // Before the save, so whatever the observer records is checkpointed with the
    // round it describes. A hook failure is contained: sourcing is the point of
    // this loop, and losing an observation must never lose a round's real work.
    let observerHalt: RoundObservationOutcome["halt"] | null = null;
    if (deps.onRoundComplete) {
      try {
        const outcome = await deps.onRoundComplete({
          round,
          funnel,
          rawRows: exec.writeBoundary.rawProviderItems,
          newUniqueJobs: newJobs,
          newUniqueCompanies: newCompanies,
          newEligibleLeads: newEligible,
          totalEligibleLeads: eligibleAfter,
          remainingQuota: remainingLeadCount(requested, eligibleAfter),
          remainingBudgetUsd: Math.max(0, bounds.hardBudget - budget),
          providerCalls: roundJobsCalls + roundPeopleCalls,
          duplicatesRemoved: dupes,
          // No further expansion exists, so this source has nothing left to try.
          sourceExhausted: !expansionAvailable,
          // Each stage reported in its own units, straight from the pipeline's
          // own counters — nothing here is derived by subtracting one stage's
          // count from another stage's.
          stages: {
            providerRows: exec.writeBoundary.rawProviderItems,
            normalizedJobs: exec.writeBoundary.normalizedJobs,
            titleMatches: exec.run?.diagnostics.acceptedJobs ?? 0,
            titleRejections: exec.run?.diagnostics.droppedByFamily ?? 0,
            geographyRejections: exec.run?.diagnostics.droppedByLocation ?? 0,
            companiesResolved: exec.run?.diagnostics.resolvedCompanies ?? 0,
            companiesEvaluated: exec.run?.diagnostics.companyBrain.evaluated ?? 0,
            companiesQualified: exec.run?.diagnostics.verifiedCompanies ?? 0,
            companiesRejectedByBrain: exec.run?.diagnostics.companyBrain.hardFail ?? 0,
            companyRejectionReasons: exec.run?.diagnostics.companyBrain.rejectReasons ?? {},
            peopleSearched: exec.run?.diagnostics.decisionMaker.searchesExecuted ?? 0,
            employerVerified: exec.run?.diagnostics.decisionMaker.employerVerified ?? 0,
            contactReady: exec.run?.diagnostics.decisionMaker.contactReady ?? 0,
          },
        });
        if (outcome?.checkpointSlices) {
          state.slices = { ...(state.slices ?? {}), ...outcome.checkpointSlices };
        }
        if (outcome?.halt) observerHalt = outcome.halt;
      } catch (e) {
        // A THROW IS A HALT, not a shrug. The observer is the only thing that
        // advances the source plan; if it failed we do not know what the next
        // action is, and inventing one is how a run spends money on the wrong
        // source. Only a safe category is kept — never the exception payload.
        observerHalt = {
          code: "source_observation_transition_failed",
          reason: safeObserverFailure(e),
          diagnostics: { phase: "unhandled", round },
        };
      }
    }

    // The checkpoint is written EITHER WAY, and before the halt is acted on. The
    // completed provider call is already recorded in `completed_calls`, so a
    // resumed run must never re-pay for it — losing that record to an observer
    // failure would turn a control-plane bug into a billing one.
    if (observerHalt) {
      state.terminal_status = "source_transition_failed";
      state.terminal_reason = observerHalt.code;
      state.next_action = "stopped";
    }
    if (deps.stateStore && taskId) {
      // `partial` — never leave the task at `running`.
      await saveCheckpoint("partial");
    }

    if (observerHalt) {
      log("company-first round observation failed; stopping", {
        round, code: observerHalt.code, reason: observerHalt.reason,
      });
      terminal = "source_transition_failed";
      terminalReason = observerHalt.reason;
      transitionFailure = { round, ...observerHalt };
      break;
    }

    log("company-first round finished", { round, eligibleAfter, remaining: remainingLeadCount(requested, eligibleAfter) });

    if (exec.status === "unable_to_compile_job_search") { terminal = "invalid_request"; terminalReason = exec.error ?? "job search could not be compiled"; break; }
    if (exec.status === "sourcing_failed") { terminal = "provider_failure"; terminalReason = exec.error ?? "jobs actor failed"; break; }
    if (remainingLeadCount(requested, eligibleAfter) === 0) { terminal = "completed"; terminalReason = "requested lead quota met"; break; }
  }

  if (!terminal) {
    terminal = rounds.length >= bounds.maxRounds ? "round_limit_reached" : "quota_not_met";
    terminalReason = terminal === "round_limit_reached"
      ? `maximum of ${bounds.maxRounds} sourcing rounds reached before the quota was met`
      : "sourcing ended without meeting the requested quota";
  }

  // FINALIZATION runs ONLY on a true terminal condition. A continuation must not
  // persist a partial result — the resuming invocation owns final persistence.
  if (continuationRequired) {
    if (deps.stateStore && taskId) {
      state.next_action = "start_round";
      state.checkpoint_at = nowIso();
      await saveCheckpoint("partial");
    }
    return finish("continuation_required", terminalReason);
  }
  if (!deadline.canAfford("persistence")) {
    if (deps.stateStore && taskId) { state.next_action = "finalize"; state.checkpoint_at = nowIso(); await saveCheckpoint("partial"); }
    return finish("continuation_required", "insufficient time remaining to finalize safely");
  }

  // Persistence already happened per round (guarded, once per lead).

  if (deps.stateStore && taskId) {
    state.terminal_status = terminal;
    state.terminal_reason = terminalReason;
    state.next_action = "stopped";
    state.checkpoint_at = nowIso();
    await saveCheckpoint(terminal === "completed" ? "completed" : "partial");
  }
  return finish(terminal, terminalReason);

  function finish(status: CompanyFirstTerminalStatus, reason: string): QuotaControllerResult {
    const eligible = carriedEligible + countEligible(dedupedCandidates, policy);
    return {
      terminal_status: status, terminal_reason: reason,
      requested_leads: requested, eligible_leads: eligible,
      remaining_leads: remainingLeadCount(requested, eligible),
      rounds_attempted: rounds.length, expansions_attempted: expansions,
      raw_jobs_processed: rawJobs, verified_companies: verifiedCompanies,
      people_candidates: peopleCandidates,
      provider_calls: jobsCalls + peopleCalls,
      provider_side_writes: writeBoundary.providerSideWrites,
      budget_consumed: Number(budget.toFixed(4)),
      rounds, candidates: dedupedCandidates, persisted, writeBoundary,
      plan, plan_sources: planSources, bottlenecks, cost_forecasts: forecasts, plan_validations: planValidations,
      planner_metadata: plannerMetadata, idempotency,
      source_transition_failure: transitionFailure,
      checkpoint_failures: checkpointFailures,
      source_progression: {
        active_source: activeSourceKey,
        exhausted_sources: exhaustedSources,
        advances: sourceAdvances,
      },
      continuation: {
        required: status === "continuation_required",
        next_action: status === "continuation_required" ? "start_round" : "finalize",
        next_round: status === "continuation_required" ? (state?.current_round ?? null) : null,
        checkpoint_at: state?.checkpoint_at ?? null,
        continuation_token: status === "continuation_required" ? taskId : null,
        resumed_from_round: resumedFromRound,
      },
    };
  }
}

/**
 * A short, safe category for an observer failure.
 *
 * The exception's own text is deliberately NOT kept: it can carry a provider
 * payload, a prompt fragment or a credential that happened to be in scope. A
 * category is enough to route an operator to the right subsystem.
 */
export function safeObserverFailure(e: unknown): string {
  const msg = String((e as { message?: unknown })?.message ?? "").toLowerCase();
  if (/observation|funnel/.test(msg)) return "observation_construction_failed";
  if (/fusion|evidence/.test(msg)) return "evidence_read_failed";
  if (/hash/.test(msg)) return "hash_generation_failed";
  if (/feedback|planner|model/.test(msg)) return "feedback_resolution_failed";
  if (/state|checkpoint|persist/.test(msg)) return "state_transition_failed";
  return "observer_unhandled_error";
}
