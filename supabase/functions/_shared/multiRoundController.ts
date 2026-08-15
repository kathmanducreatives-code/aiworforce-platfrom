// THE ROUND CONTROLLER. IT ORCHESTRATES; IT DOES NOT SOURCE.
//
// Every round is executed by the SAME capability engine the single-round path
// uses — mission, capability graph, provider containment, evidence
// normalization, grounded Brain, batch evaluation, pool ranking and the
// portfolio builder are all unchanged and unduplicated. Building a second
// sourcing engine here would mean two things that could disagree about what a
// company is, and the one in this file would be the one nobody tested against
// production.
//
// WHAT THIS ADDS is the loop and the judgement around it: pool companies across
// rounds so nothing is counted or evaluated twice, ask the planner what to try
// next, refuse anything the mission did not permit, and stop honestly.
//
// THE STOPPING RULE IS THE POINT. A request for 100 that finds 63 returns 63.
// Nothing here pads a list to reach a number, and nothing here reaches for
// people to make up the difference — the people stages are not reachable from a
// round at all, by construction in `roundPlanContract.ts`.
//
// PURE ORCHESTRATION. Every provider, model and persistence call is injected,
// so a three-round run is exercised end to end with zero Actor runs.

import {
  addRoundCandidates, selectForEvaluation,
  type PooledCompany, type RoundCandidate,
} from "./crossRoundDedupe.ts";
import {
  assessConcept, conceptHash, countsOf, decideNextRound, finalTerminalReason,
  newMultiRoundState, recordRound, roundMetrics, strategyForRound,
  type MultiRoundCounts, type MultiRoundState, type RoundLimits,
  type RoundQualityMetrics, type RoundRecord, type SearchConceptRecord,
} from "./multiRoundState.ts";
import {
  validateRoundPlan, type RoundPlanRejectionEntry, type ValidatedRoundPlan,
} from "./roundPlanContract.ts";
import type { PlanNextRoundFn } from "./multiRoundBinding.ts";
import type { LeadMissionV1 } from "./leadMission.ts";

export const MULTI_ROUND_CONTROLLER_VERSION = "multi-round-controller-v1" as const;

/** What one execution of the capability engine reported back. */
export interface RoundExecution {
  candidates: RoundCandidate[];
  /** Grounded verdicts produced THIS round, by pooled identity key. */
  groundedByKey?: Map<string, unknown>;
  pool: {
    hard_gated: number;
    eligible: number;
    evaluated: number;
    qualified: number;
    review: number;
    watch: number;
    delivered: number;
  } | null;
  providerCostUnits: number;
  modelCostUnits: number;
  providerOperations?: string[];
  /** Per-concept outcome, so exhaustion is measured rather than assumed. */
  conceptResults?: Array<{
    concept: string;
    resultCount: number;
    providerReportedNoMore?: boolean;
  }>;
  exhaustedCapabilities?: string[];
  providerFailed?: boolean;
  /** Keys whose stored verdict left them unresolved. */
  unresolvedKeys?: string[];
}

export interface MultiRoundCheckpoint {
  version: typeof MULTI_ROUND_CONTROLLER_VERSION;
  phase: "round_complete" | "round_started" | "planning";
  current_round: number;
  state: MultiRoundState;
  pool_keys: string[];
  next_action: string;
}

export interface MultiRoundDeps {
  /**
   * Run ONE round through the existing engine.
   *
   * `plan` is null for round 1 — the exact mission, unbroadened. For later
   * rounds it is a validated plan, and the caller translates it into mission
   * adjustments before invoking the engine.
   */
  runRound: (i: {
    round: number;
    strategy: ReturnType<typeof strategyForRound>;
    plan: ValidatedRoundPlan | null;
    /** Verdicts already paid for, so the engine restores instead of re-buying. */
    restoredGrounded: Map<string, unknown>;
    /** Only these need evaluating; everything else is restorable. */
    evaluateKeys: string[];
  }) => Promise<RoundExecution>;
  planNextRound: PlanNextRoundFn | null;
  limits: () => RoundLimits;
  onCheckpoint?: (cp: MultiRoundCheckpoint) => void | Promise<void>;
  log?: (msg: string, meta?: unknown) => void;
}

export interface MultiRoundResult {
  state: MultiRoundState;
  counts: MultiRoundCounts;
  pool: Map<string, PooledCompany>;
  metrics: RoundQualityMetrics[];
  concepts: SearchConceptRecord[];
  /** Every plan the planner proposed, and what code did with it. */
  plan_decisions: Array<{
    round: number;
    accepted: boolean;
    detail: string;
    expected_incremental_value?: string;
    rejections: RoundPlanRejectionEntry[];
  }>;
  terminal_reason: string;
}

/**
 * Run up to `maxRounds` sourcing rounds.
 *
 * ROUND 1 IS ALWAYS THE EXACT MISSION. It is never broadened merely because a
 * large number was requested — asking for 100 does not make a weaker company a
 * better match, and starting broad is how a run fills its quota with rows the
 * user did not want.
 */
export async function runMultiRoundSourcing(
  deps: MultiRoundDeps,
  opts: {
    mission: LeadMissionV1;
    requestedCount: number;
    maxRounds?: number;
    /** Restored from a checkpoint on a continuation. */
    resumeState?: MultiRoundState | null;
    resumePool?: Map<string, PooledCompany> | null;
    resumeGrounded?: Map<string, unknown> | null;
    resumeEvaluatedAt?: Map<string, number> | null;
  },
): Promise<MultiRoundResult> {
  const log = deps.log ?? (() => {});
  let state = opts.resumeState ?? newMultiRoundState({
    requestedCount: opts.requestedCount, maxRounds: opts.maxRounds,
  });
  let pool = opts.resumePool ?? new Map<string, PooledCompany>();
  const grounded = opts.resumeGrounded ?? new Map<string, unknown>();
  const evaluatedAt = opts.resumeEvaluatedAt ?? new Map<string, number>();

  const concepts: SearchConceptRecord[] = [];
  const metrics: RoundQualityMetrics[] = [];
  const planDecisions: MultiRoundResult["plan_decisions"] = [];
  let plan: ValidatedRoundPlan | null = null;
  let terminal = "";

  while (true) {
    const round = state.round_number + 1;
    const strategy = strategyForRound(round);

    // ── A ROUND MUST BE AFFORDABLE WHEN IT STARTS, NOT WHEN IT WAS DECIDED ──
    //
    // `decideNextRound` runs immediately after the PREVIOUS round, and the
    // planner call sits between that decision and this execution. The clock
    // keeps running across both. Task cc556f5e decided to start round 2 with
    // time to spare, spent it planning, and entered the round with nothing
    // left: the identity stage attempted zero of thirteen calls, the Brain was
    // reached by nobody, and the round's only effect was to overwrite a round
    // that had qualified two companies.
    //
    // `deps.limits()` reads the live clock, so asking it again here is the
    // difference between "we thought we could afford this" and "we can".
    //
    // ROUND 1 IS EXEMPT. It is the exact mission — the only round that can
    // produce anything at all — and in the executor it is already complete and
    // merely handed back, so refusing it would discard finished work.
    if (round > 1) {
      const entry = deps.limits();
      if (entry.cancelled || entry.deadlineReserveReached) {
        const reason = entry.cancelled ? "cancelled" : "deadline_reached";
        terminal = entry.cancelled
          ? "the workflow was cancelled before the round started"
          : "the checkpoint reserve was reached before the round started";
        state = { ...state, terminal_reason: reason };
        log("round_entry_refused", {
          round, strategy, reason, detail: terminal,
          shortfall: state.remaining_shortfall,
        });
        break;
      }
    }

    // ── WHICH COMPANIES STILL NEED A VERDICT ──────────────────────────────
    // Computed BEFORE the round so the engine is told what to restore rather
    // than re-buying every previous company's evaluation on every round.
    const selection = selectForEvaluation({
      pool, evaluatedAtRevision: evaluatedAt,
    });

    await deps.onCheckpoint?.({
      version: MULTI_ROUND_CONTROLLER_VERSION, phase: "round_started",
      current_round: round, state, pool_keys: [...pool.keys()],
      next_action: `execute round ${round} (${strategy})`,
    });

    log("round_start", {
      round, strategy, shortfall: state.remaining_shortfall,
      pool_size: pool.size, evaluate: selection.evaluate.length,
      restore: selection.restore.length,
    });

    const exec = await deps.runRound({
      round, strategy, plan,
      restoredGrounded: grounded,
      evaluateKeys: selection.evaluate,
    });

    // ── POOL THE DISCOVERIES ──────────────────────────────────────────────
    const before = pool.size;
    const added = addRoundCandidates(pool, exec.candidates);
    pool = added.pool;

    for (const [k, v] of exec.groundedByKey ?? new Map()) {
      grounded.set(k, v);
      // Stamp the revision the verdict was computed at, so a later merge that
      // changes the evidence invalidates exactly this verdict and no other.
      evaluatedAt.set(k, pool.get(k)?.evidence_revision ?? 1);
    }

    // ── MEASURE THE CONCEPTS ──────────────────────────────────────────────
    // Attributed at round granularity: a concept that ran in a round which
    // added nothing new is exhausted, which is the signal the next planner
    // needs to stop rewording it.
    for (const cr of exec.conceptResults ?? []) {
      const rec = assessConcept({
        concept: cr.concept, round,
        resultCount: cr.resultCount,
        uniqueNew: added.newCompanies.length,
        eligibleNew: exec.pool?.eligible ?? 0,
        deliveredNew: exec.pool?.delivered ?? 0,
        providerReportedNoMore: cr.providerReportedNoMore,
      });
      concepts.push(rec);
      if (rec.exhausted && !state.exhausted_search_concepts.includes(rec.concept_hash)) {
        state = {
          ...state,
          exhausted_search_concepts: [...state.exhausted_search_concepts, rec.concept_hash],
        };
      }
    }
    for (const c of exec.exhaustedCapabilities ?? []) {
      if (!state.exhausted_capabilities.includes(c)) {
        state = { ...state, exhausted_capabilities: [...state.exhausted_capabilities, c] };
      }
    }

    const record: RoundRecord = {
      round, strategy_type: strategy,
      capabilities: plan?.capabilities ?? [],
      search_concepts: plan?.search_concepts ?? [],
      signal_families: plan?.signal_families ?? [],
      company_types: plan?.company_types ?? [],
      employee_range: plan?.employee_range ?? { min: null, max: null },
      provider_operations: exec.providerOperations ?? [],
      discovered: exec.candidates.length,
      new_companies: added.newCompanies.length,
      hard_gated: exec.pool?.hard_gated ?? 0,
      eligible: exec.pool?.eligible ?? 0,
      new_evaluated_companies: (exec.groundedByKey?.size ?? 0),
      qualified: exec.pool?.qualified ?? 0,
      review: exec.pool?.review ?? 0,
      watch: exec.pool?.watch ?? 0,
      new_delivered_opportunities: Math.max(
        0, (exec.pool?.delivered ?? 0) - state.delivered_opportunity_count),
      provider_cost_units: exec.providerCostUnits,
      model_cost_units: exec.modelCostUnits,
    };

    // ── A ROUND THAT MEASURED NOTHING MUST NOT OVERWRITE ONE THAT DID ──────
    //
    // `recordRound` ASSIGNS these totals rather than accumulating them, and
    // that is right: they are POOL-level facts, and a round re-evaluates the
    // pool it inherited. But it is only right for a round that actually
    // reached evaluation.
    //
    // A round that never got there — the clock died, the provider failed,
    // discovery came back empty — reports zeros, and those zeros are ABSENCE
    // OF MEASUREMENT, not a finding that nothing qualifies. Assigning them
    // deletes everything the earlier rounds proved. In task cc556f5e round 1
    // qualified `idler.ai` (score 92) and `godela.ai` (score 91); round 2
    // reached the Brain with nobody, reported qualified 0, and both companies
    // were persisted as `deferred` with the run claiming zero qualified.
    //
    // This is the same rule the Brain already follows about empty grounding:
    // silence is not evidence. A round earns the right to restate the pool's
    // totals by evaluating something.
    const measured = exec.pool != null &&
      (exec.pool.evaluated > 0 || (exec.groundedByKey?.size ?? 0) > 0);
    state = recordRound(state, record, {
      // Always current: the controller owns the pool, and pooling is additive
      // whether or not this round evaluated anything.
      unique_companies: pool.size,
      ...(measured
        ? {
          eligible: exec.pool!.eligible,
          evaluated: exec.pool!.evaluated,
          qualified: exec.pool!.qualified,
          review: exec.pool!.review,
          watch: exec.pool!.watch,
          delivered: exec.pool!.delivered,
        }
        : {
          eligible: state.eligible_company_count,
          evaluated: state.evaluated_company_count,
          qualified: state.qualified_count,
          review: state.review_count,
          watch: state.watch_count,
          delivered: state.delivered_opportunity_count,
        }),
    });
    metrics.push(roundMetrics(record));

    log("round_complete", {
      round, discovered: record.discovered, new: record.new_companies,
      pool_growth: pool.size - before,
      delivered: state.delivered_opportunity_count,
      shortfall: state.remaining_shortfall,
      // "Did this round's numbers come from this round?" — the field that
      // separates a real zero from an unmeasured one.
      measured,
      carried_forward_totals: !measured,
    });

    await deps.onCheckpoint?.({
      version: MULTI_ROUND_CONTROLLER_VERSION, phase: "round_complete",
      current_round: round, state, pool_keys: [...pool.keys()],
      next_action: state.remaining_shortfall > 0 ? "consider another round" : "finish",
    });

    // ── MAY ANOTHER ROUND RUN AT ALL? ─────────────────────────────────────
    const limits = deps.limits();
    const decision = decideNextRound(state, {
      ...limits, providerFailed: exec.providerFailed ?? limits.providerFailed,
    });
    if (!decision.start) {
      terminal = decision.detail;
      state = { ...state, terminal_reason: finalTerminalReason(state, decision) };
      log("round_loop_stop", {
        terminal_reason: state.terminal_reason, detail: decision.detail,
      });
      break;
    }

    // ── ASK WHAT TO TRY NEXT ──────────────────────────────────────────────
    if (!deps.planNextRound) {
      state = { ...state, terminal_reason: finalTerminalReason(state, {
        start: false, terminal_reason: "quota_not_met", detail: "",
      }) };
      terminal = "no round planner is bound; a further round cannot be planned";
      break;
    }

    await deps.onCheckpoint?.({
      version: MULTI_ROUND_CONTROLLER_VERSION, phase: "planning",
      current_round: round, state, pool_keys: [...pool.keys()],
      next_action: "plan the next round",
    });

    const proposal = await deps.planNextRound({
      mission: opts.mission, state,
      remainingBudgetClass:
        state.provider_cost_units_used >= limits.maxProviderCostUnits ? "exhausted"
          : state.provider_cost_units_used > limits.maxProviderCostUnits / 2 ? "limited"
          : "ample",
      remainingDeadlineClass: state.deadline_state,
    });

    if (!proposal) {
      // AN UNREADABLE PLAN IS A STOP. Guessing at a broadening is the one
      // outcome that can spend money on a mission nobody agreed to.
      planDecisions.push({
        round: round + 1, accepted: false,
        detail: "the planner returned nothing usable", rejections: [],
      });
      state = { ...state, terminal_reason: "invalid_round_plan" };
      terminal = "the round planner returned no usable plan";
      break;
    }

    const validated = validateRoundPlan({ proposal, mission: opts.mission, state });
    if (!validated.ok) {
      planDecisions.push({
        round: round + 1, accepted: false, detail: validated.stop_detail,
        expected_incremental_value: proposal.expected_incremental_value,
        rejections: validated.rejections,
      });
      // TWO DIFFERENT ENDINGS. The planner choosing to stop is an honest
      // shortfall; code refusing its plan is an invalid plan. Reporting both
      // the same way would hide which one happened.
      const refused = validated.rejections.length > 0;
      state = {
        ...state,
        terminal_reason: refused
          ? "invalid_round_plan"
          : finalTerminalReason(state, {
            start: false, terminal_reason: "quota_not_met", detail: "",
          }),
      };
      terminal = validated.stop_detail;
      log("round_plan_refused", {
        round: round + 1, refused, detail: validated.stop_detail,
        rejections: validated.rejections.map((r) => r.reason),
      });
      break;
    }

    planDecisions.push({
      round: validated.plan.round, accepted: true, detail: validated.plan.reason,
      expected_incremental_value: validated.plan.expected_incremental_value,
      rejections: validated.plan.rejections,
    });
    plan = validated.plan;
  }

  return {
    state,
    counts: countsOf(state),
    pool,
    metrics,
    concepts,
    plan_decisions: planDecisions,
    terminal_reason: state.terminal_reason ?? "quota_not_met",
  };
}

/** Round-level observability for the Workbench. Counts only, no provider names. */
export function roundSummaryForWorkbench(r: MultiRoundResult) {
  return {
    requested: r.state.requested_opportunity_count,
    delivered: r.state.delivered_opportunity_count,
    qualified: r.state.qualified_count,
    review: r.state.review_count,
    watch: r.state.watch_count,
    shortfall: r.state.remaining_shortfall,
    rounds_used: r.state.round_number,
    terminal_reason: r.terminal_reason,
    // NOTHING IS UNLOCKED BY SOURCING. Present and zero rather than absent, so
    // "delivered" is never read as "contactable".
    founder_unlocked: 0,
    contact_unlocked: 0,
    contact_ready: 0,
    rounds: r.metrics.map((m) => ({
      round: m.round,
      discovered: m.discovered,
      new_unique: m.unique_added,
      hard_gated: m.hard_gated,
      eligible: m.evaluated,
      delivered: m.delivered,
      duplicate_rate: m.duplicate_rate,
      qualification_rate: m.qualification_rate,
    })),
  };
}
