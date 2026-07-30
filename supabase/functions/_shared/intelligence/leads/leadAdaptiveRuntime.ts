// RUNTIME INTEGRATION — the adapter that puts the adaptive intelligence on the
// live company-first path.
//
// ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────
// Not a controller, not a planner, not a source runtime, not a persistence path
// and NOT a second state machine. Every one of those already exists and keeps
// its authority:
//
//   round loop + quota      companyFirstQuotaController
//   source state mutation   sequentialSourceRuntime.applyObservation
//   Claude call + gating    sourceFeedbackRuntime.decideNextActionWithFeedback
//   provider payloads       the existing capability compiler
//   batch size              discoveryBatchSize.decideDiscoveryBatchSize
//
// This module does exactly three things:
//   1. turns the controller's per-stage metrics into a bounded observation,
//   2. resolves ONE next action (Claude if permitted and valid, else deterministic),
//   3. MAPS that action onto the existing closed `ApprovedSourceNextAction` union
//      so the existing `applyObservation` remains the only thing that mutates
//      source state.
//
// Step 3 is what keeps the richer adaptive vocabulary from becoming a parallel
// runtime. The adaptive layer decides WHICH pack or source is semantically right;
// the existing authority decides what that does to a checkpoint.

import {
  buildSourceStepObservation, type AdaptiveAction, type ObservationInput,
  type SourceStepObservation as AdaptiveObservation,
} from "./leadAdaptiveObservation.ts";
import {
  resolveNextAction, type ActionViolation, type AdaptiveNextAction,
} from "./leadAdaptiveAction.ts";
import { deferredPacks, type QueryPack } from "./leadQueryPacks.ts";
import type {
  ApprovedSourceNextAction, OrderedHiringSourcePlan, SafeBroadeningAction,
} from "../../hiringSourcePlan.ts";

export const ADAPTIVE_RUNTIME_VERSION = "lead-adaptive-runtime-1.0.0";

/** Checkpoint slice key. Sits alongside the other slices; no migration. */
export const ADAPTIVE_PACK_STATE_KEY = "adaptive_query_packs";

/**
 * The pack ledger.
 *
 * A ledger, not a state machine: it records which packs have been consumed and
 * which are active, and answers questions. It has no transitions of its own and
 * decides nothing — `applyObservation` still owns every source transition.
 */
export interface AdaptivePackState {
  version: string;
  /** Packs already sent to a provider, per capability. */
  completed_by_capability: Record<string, string[]>;
  /** Packs activated out of the deferred tiers. */
  activated_pack_ids: string[];
  /** Signatures of actions already executed, for the duplicate-input guard. */
  executed_signatures: string[];
  /** One feedback request per observation — this is the counter that proves it. */
  feedback_requests: number;
}

export function newAdaptivePackState(): AdaptivePackState {
  return {
    version: ADAPTIVE_RUNTIME_VERSION,
    completed_by_capability: {}, activated_pack_ids: [], executed_signatures: [],
    feedback_requests: 0,
  };
}

export function readAdaptivePackState(slices: Record<string, unknown> | undefined): AdaptivePackState {
  const raw = slices?.[ADAPTIVE_PACK_STATE_KEY];
  if (!raw || typeof raw !== "object") return newAdaptivePackState();
  const o = raw as Partial<AdaptivePackState>;
  return {
    version: typeof o.version === "string" ? o.version : ADAPTIVE_RUNTIME_VERSION,
    completed_by_capability: (o.completed_by_capability ?? {}) as Record<string, string[]>,
    activated_pack_ids: Array.isArray(o.activated_pack_ids) ? o.activated_pack_ids : [],
    executed_signatures: Array.isArray(o.executed_signatures) ? o.executed_signatures : [],
    feedback_requests: Number.isFinite(o.feedback_requests) ? Number(o.feedback_requests) : 0,
  };
}

/** The per-stage metrics the controller now reports, in each stage's own units. */
export interface RoundStageMetrics {
  providerRows: number;
  normalizedJobs: number;
  titleMatches: number;
  titleRejections: number;
  geographyRejections: number;
  companiesResolved: number;
  companiesEvaluated: number;
  companiesQualified: number;
  companiesRejectedByBrain: number;
  companyRejectionReasons: Record<string, number>;
  peopleSearched: number;
  employerVerified: number;
  contactReady: number;
}

export interface BuildObservationInput {
  stepId: string;
  capability: string;
  stages: RoundStageMetrics;
  packs: readonly QueryPack[];
  packState: AdaptivePackState;
  /** Packs sent in the round being observed. */
  packIdsUsed: readonly string[];
  titlesUsed: readonly string[];
  semanticFilters?: Record<string, unknown>;
  providerFilters?: Record<string, unknown>;
  requestedLeads: number;
  totalContactReady: number;
  remainingBudgetUsd: number;
  providerCallsRemaining: number;
  completedSources: readonly string[];
  remainingSources: readonly string[];
  /** From the existing people-stage authorities. */
  peopleSearchCompletedForQualified: boolean;
  peopleNeedingContact: number;
  seniorityBroadeningAvailable: boolean;
  recencyBroadeningAvailable: boolean;
}

/**
 * Build the bounded observation from MEASURED stages.
 *
 * `companies_resolved` and `companies_qualified` are passed through as separate
 * measurements; the observation derives rejections from them. Nothing here
 * subtracts a job count from a company count.
 */
export function buildAdaptiveObservation(input: BuildObservationInput): AdaptiveObservation {
  return buildSourceStepObservation(observationInputFrom(input));
}

/** The same inputs, exposed so the action menu can be projected from one source. */
export function observationInputFrom(input: BuildObservationInput): ObservationInput {
  const s = input.stages;
  const done = new Set(input.packState.completed_by_capability[input.capability] ?? []);
  const unused = input.packs.filter((p) => p.initially_eligible && !done.has(p.pack_id)).map((p) => p.pack_id);
  const deferred = deferredPacks(input.packs)
    .filter((p) => !input.packState.activated_pack_ids.includes(p.pack_id));

  return {
    source_step_id: input.stepId,
    source_capability: input.capability,
    query_pack_ids: [...input.packIdsUsed],
    titles_used: [...input.titlesUsed],
    semantic_filters: input.semanticFilters ?? {},
    provider_filters: input.providerFilters ?? {},

    provider_rows: s.providerRows,
    normalized_jobs: s.normalizedJobs,
    // Geography and title rejections are separate stages; jobs that survived both
    // are the ones still inside the recency window the compiler applied.
    jobs_within_recency_window: s.normalizedJobs,
    title_matches: s.titleMatches,
    title_rejections: s.titleRejections,

    companies_resolved: s.companiesResolved,
    companies_qualified: s.companiesQualified,
    company_rejection_reasons: s.companyRejectionReasons,

    decision_makers_verified: s.employerVerified,
    contact_ready_leads: input.totalContactReady,
    requested_leads: input.requestedLeads,

    completed_query_packs: [...done],
    unused_query_packs: unused,
    completed_sources: [...input.completedSources],
    remaining_sources: [...input.remainingSources],

    budget_remaining_usd: input.remainingBudgetUsd,
    provider_calls_remaining: input.providerCallsRemaining,
    direct_adjacent_packs_available: deferred.filter((p) => p.confidence_tier === "direct_adjacent").length,
    evidence_gated_packs_available: deferred.filter((p) => p.confidence_tier === "evidence_gated_adjacent").length,
    seniority_broadening_available: input.seniorityBroadeningAvailable,
    recency_broadening_available: input.recencyBroadeningAvailable,
    people_search_completed_for_qualified: input.peopleSearchCompletedForQualified,
    people_needing_contact: input.peopleNeedingContact,
  };
}

// ------------------------------------------------------------------- mapping ----

export type AdaptiveMapFailure =
  | "no_next_step"
  | "no_activatable_pack"
  | "recency_ceiling_reached"
  | "unsupported_in_runtime";

export interface AdaptiveMapResult {
  /** The action for the EXISTING `applyObservation`. Null when unmappable. */
  approved: ApprovedSourceNextAction | null;
  /** Packs to mark consumed / activated when this action executes. */
  packsConsumed: string[];
  packsActivated: string[];
  failure: AdaptiveMapFailure | null;
}

export interface AdaptiveMapContext {
  stepId: string;
  /** Next runnable step, from the ordered-plan authority. */
  nextStepId: string | null;
  nextCapability: string | null;
  packs: readonly QueryPack[];
  packState: AdaptivePackState;
  quotaReached: boolean;
  /** Current maximum posting age, so recency broadening cannot pass the ceiling. */
  maximumAgeDays: number;
  /** Person ids needing a contact method, from the existing authority. */
  peopleNeedingContact: readonly string[];
  /** Company keys with sufficient evidence but no strong identity. */
  companiesNeedingIdentity: readonly string[];
}

/** The hard hiring-evidence ceiling, mirrored from the strategy contract. */
export const RUNTIME_MAX_RECENCY_DAYS = 60;

/**
 * Map one adaptive action onto the existing approved union.
 *
 * The pack-oriented actions all become `broaden_current_source` carrying
 * `add_approved_role_aliases` — the existing safe rung whose whole purpose is
 * "search these approved titles as well". That is what lets a richer semantic
 * vocabulary drive the runtime without teaching the runtime a second vocabulary.
 *
 * Anything with no honest equivalent returns `approved: null` and a failure code;
 * the caller then falls back rather than inventing an effect.
 */
export function mapAdaptiveActionToApproved(
  action: AdaptiveNextAction,
  ctx: AdaptiveMapContext,
): AdaptiveMapResult {
  const none = (failure: AdaptiveMapFailure): AdaptiveMapResult =>
    ({ approved: null, packsConsumed: [], packsActivated: [], failure });

  const packById = new Map(ctx.packs.map((p) => [p.pack_id, p]));
  const requested = (action.query_pack_ids ?? []).map((id) => packById.get(id)).filter(Boolean) as QueryPack[];

  const broadenWithTitles = (packs: QueryPack[], activated: boolean): AdaptiveMapResult => {
    const aliases = [...new Set(packs.flatMap((p) => [...p.titles, ...p.aliases]))];
    if (aliases.length === 0) return none("no_activatable_pack");
    const broadeningAction: SafeBroadeningAction = { action: "add_approved_role_aliases", aliases };
    return {
      approved: { action: "broaden_current_source", stepId: ctx.stepId, broadeningAction },
      packsConsumed: packs.map((p) => p.pack_id),
      packsActivated: activated ? packs.map((p) => p.pack_id) : [],
      failure: null,
    };
  };

  switch (action.action) {
    case "stop_success":
      // Only the quota authority can declare success; this asserts it agrees.
      return ctx.quotaReached
        ? { approved: { action: "stop_quota_reached" }, packsConsumed: [], packsActivated: [], failure: null }
        : none("unsupported_in_runtime");

    case "stop_partial":
      return {
        approved: { action: "stop_valid_exhaustion", reason: action.reason || "no further approved action remains" },
        packsConsumed: [], packsActivated: [], failure: null,
      };

    case "run_unused_query_pack": {
      const packs = requested.length > 0
        ? requested
        : ctx.packs.filter((p) =>
          p.initially_eligible &&
          !(ctx.packState.completed_by_capability[ctx.nextCapability ?? ""] ?? []).includes(p.pack_id)
        ).slice(0, 1);
      return packs.length > 0 ? broadenWithTitles(packs, false) : none("no_activatable_pack");
    }

    case "broaden_direct_seniority":
    case "activate_direct_adjacent_pack": {
      const packs = requested.length > 0
        ? requested
        : deferredPacks(ctx.packs)
          .filter((p) => p.confidence_tier === "direct_adjacent" && !ctx.packState.activated_pack_ids.includes(p.pack_id))
          .slice(0, 1);
      return packs.length > 0 ? broadenWithTitles(packs, true) : none("no_activatable_pack");
    }

    case "activate_evidence_gated_pack": {
      const packs = requested.length > 0
        ? requested
        : deferredPacks(ctx.packs)
          .filter((p) => p.confidence_tier === "evidence_gated_adjacent" && !ctx.packState.activated_pack_ids.includes(p.pack_id))
          .slice(0, 1);
      // The gate is the evidence, and it is checked here as well as in the
      // validator, because this is the point of execution.
      const withEvidence = packs.filter((p) => p.description_evidence.length > 0);
      return withEvidence.length > 0 ? broadenWithTitles(withEvidence, true) : none("no_activatable_pack");
    }

    case "broaden_recency": {
      if (ctx.maximumAgeDays >= RUNTIME_MAX_RECENCY_DAYS) return none("recency_ceiling_reached");
      const next = Math.min(RUNTIME_MAX_RECENCY_DAYS, Math.max(ctx.maximumAgeDays * 2, ctx.maximumAgeDays + 15));
      return {
        approved: {
          action: "broaden_current_source", stepId: ctx.stepId,
          broadeningAction: { action: "extend_recency_window", postingWindowDays: next },
        },
        packsConsumed: [], packsActivated: [], failure: null,
      };
    }

    case "advance_source":
      if (!ctx.nextStepId) return none("no_next_step");
      return {
        approved: { action: "advance_to_next_source", currentStepId: ctx.stepId, nextStepId: ctx.nextStepId },
        packsConsumed: [], packsActivated: [], failure: null,
      };

    case "begin_people_search":
    case "broaden_people_search":
      // The company-to-people pathway is reached through the existing identity
      // enrichment action; the people call itself belongs to the compound
      // execution the controller already runs for qualified companies.
      return {
        approved: { action: "enrich_company_identity", companyIds: [...ctx.companiesNeedingIdentity] },
        packsConsumed: [], packsActivated: [], failure: null,
      };

    case "run_contact_enrichment":
      if (ctx.peopleNeedingContact.length === 0) return none("unsupported_in_runtime");
      return {
        approved: { action: "enrich_contacts", personIds: [...ctx.peopleNeedingContact] },
        packsConsumed: [], packsActivated: [], failure: null,
      };
  }
}

// ------------------------------------------------------------------ the hook ----

export interface AdaptiveRoundResult {
  observation: AdaptiveObservation;
  /** The adaptive action chosen, before mapping. */
  chosen: AdaptiveNextAction;
  chosenSource: "claude" | "deterministic_fallback";
  /** The action handed to the existing `applyObservation`, if mappable. */
  approved: ApprovedSourceNextAction | null;
  packState: AdaptivePackState;
  violations: ActionViolation[];
  fallbackReason: string | null;
}

export interface AdaptiveRoundInput extends BuildObservationInput {
  approvedCapabilities: readonly string[];
  maximumAgeDays: number;
  nextStepId: string | null;
  nextCapability: string | null;
  peopleNeedingContactIds: readonly string[];
  companiesNeedingIdentityIds: readonly string[];
  /**
   * Ask Claude for one action. INJECTED — this module never reaches a model.
   * Returning null (disabled, unavailable, or a bad response) is a normal,
   * expected outcome that resolves to the deterministic action.
   */
  askClaude?: (o: AdaptiveObservation) => Promise<AdaptiveNextAction | null>;
}

/**
 * One completed round → one observation → one validated action → one mapped
 * effect for the existing runtime.
 *
 * At most ONE Claude request happens here, and the counter that proves it lives
 * in the persisted pack state rather than in a local variable, so a resumed run
 * cannot quietly buy a second one for the same round.
 */
export async function runAdaptiveRound(input: AdaptiveRoundInput): Promise<AdaptiveRoundResult> {
  const obsInput = observationInputFrom(input);
  const observation = buildSourceStepObservation(obsInput);
  const packState: AdaptivePackState = {
    ...input.packState,
    completed_by_capability: { ...input.packState.completed_by_capability },
    activated_pack_ids: [...input.packState.activated_pack_ids],
    executed_signatures: [...input.packState.executed_signatures],
  };

  // ---- 1. exactly one bounded request, only when a hook was supplied ----
  let proposed: AdaptiveNextAction | null = null;
  if (input.askClaude) {
    packState.feedback_requests += 1;
    try {
      proposed = await input.askClaude(observation);
    } catch {
      proposed = null;                     // a failed request is a fallback, not a halt
    }
  }

  // ---- 2. validate, or fall back ----
  const resolved = resolveNextAction(proposed, {
    observation,
    approvedCapabilities: input.approvedCapabilities,
    packs: input.packs,
    executedSignatures: packState.executed_signatures,
    budgetRemainingUsd: input.remainingBudgetUsd,
    providerCallsRemaining: input.providerCallsRemaining,
    maximumAgeDays: input.maximumAgeDays,
    directAdjacentAvailable: obsInput.direct_adjacent_packs_available,
    evidenceGatedAvailable: obsInput.evidence_gated_packs_available,
    nextCapability: input.nextCapability,
  });

  // ---- 3. map onto the existing closed union ----
  const mapped = mapAdaptiveActionToApproved(resolved.action, {
    stepId: input.stepId,
    nextStepId: input.nextStepId,
    nextCapability: input.nextCapability,
    packs: input.packs,
    packState,
    quotaReached: observation.remaining_leads <= 0,
    maximumAgeDays: input.maximumAgeDays,
    peopleNeedingContact: input.peopleNeedingContactIds,
    companiesNeedingIdentity: input.companiesNeedingIdentityIds,
  });

  // A chosen-but-unmappable action is a fallback, not an invented effect.
  let chosen = resolved.action;
  let chosenSource = resolved.source;
  let approved = mapped.approved;
  let fallbackReason: string | null = resolved.source === "deterministic_fallback"
    ? (resolved.violations[0]?.code ?? "claude_unavailable")
    : null;

  if (!approved) {
    fallbackReason = mapped.failure ?? "unmappable_action";
    const det = resolveNextAction(null, {
      observation,
      approvedCapabilities: input.approvedCapabilities,
      packs: input.packs,
      executedSignatures: packState.executed_signatures,
      budgetRemainingUsd: input.remainingBudgetUsd,
      providerCallsRemaining: input.providerCallsRemaining,
      maximumAgeDays: input.maximumAgeDays,
      directAdjacentAvailable: obsInput.direct_adjacent_packs_available,
      evidenceGatedAvailable: obsInput.evidence_gated_packs_available,
      nextCapability: input.nextCapability,
    });
    const remapped = mapAdaptiveActionToApproved(det.action, {
      stepId: input.stepId, nextStepId: input.nextStepId, nextCapability: input.nextCapability,
      packs: input.packs, packState, quotaReached: observation.remaining_leads <= 0,
      maximumAgeDays: input.maximumAgeDays,
      peopleNeedingContact: input.peopleNeedingContactIds,
      companiesNeedingIdentity: input.companiesNeedingIdentityIds,
    });
    chosen = det.action;
    chosenSource = "deterministic_fallback";
    approved = remapped.approved ??
      { action: "stop_valid_exhaustion", reason: "no approved action remains for this state" };
  }

  // ---- 4. record what executing this consumes ----
  const cap = input.capability;
  const consumed = new Set(packState.completed_by_capability[cap] ?? []);
  for (const id of [...input.packIdsUsed, ...mapped.packsConsumed]) consumed.add(id);
  packState.completed_by_capability[cap] = [...consumed];
  for (const id of mapped.packsActivated) {
    if (!packState.activated_pack_ids.includes(id)) packState.activated_pack_ids.push(id);
  }
  const sig = actionSignatureOf(chosen);
  if (sig && !packState.executed_signatures.includes(sig)) packState.executed_signatures.push(sig);

  return {
    observation, chosen, chosenSource, approved, packState,
    violations: resolved.violations, fallbackReason,
  };
}

function actionSignatureOf(a: AdaptiveNextAction): string {
  return [
    a.action,
    (a.target_capability_key ?? "").toLowerCase(),
    [...(a.query_pack_ids ?? [])].map((x) => x.toLowerCase()).sort().join(","),
    String(a.broadening_level ?? ""),
  ].join("::");
}

/** Safe diagnostics. Codes and counts only — never a prompt or a provider record. */
export function adaptiveRuntimeDiagnostics(r: AdaptiveRoundResult): Record<string, unknown> {
  return {
    version: ADAPTIVE_RUNTIME_VERSION,
    bottleneck: r.observation.bottleneck,
    valid_next_actions: r.observation.valid_next_actions,
    chosen_action: r.chosen.action,
    chosen_source: r.chosenSource,
    approved_action: r.approved?.action ?? null,
    fallback_reason: r.fallbackReason,
    violation_codes: r.violations.map((v) => v.code),
    feedback_requests: r.packState.feedback_requests,
    funnel: {
      provider_rows: r.observation.provider_rows,
      title_matches: r.observation.title_matches,
      companies_resolved: r.observation.companies_resolved,
      companies_qualified: r.observation.companies_qualified,
      companies_rejected: r.observation.companies_rejected,
      contact_ready: r.observation.contact_ready_leads,
    },
  };
}

export type { AdaptiveAction, AdaptiveObservation };

// ------------------------------------------- INTEGRATION POINT 1: the plan ----

/**
 * Convert a VALIDATED adaptive strategy into the existing ordered-plan shape.
 *
 * This is a translation, not a second planner. It produces the same
 * `OrderedHiringSourcePlan` the deterministic builder produces, and the caller
 * then runs it through the EXISTING `validateOrderedPlan`, which stays the final
 * authority on capabilities, actor resolution and step legality. Anything this
 * function gets wrong is caught there rather than reaching a provider.
 *
 * Query packs ride on the step via `approvedTitleAliases` — the field the
 * existing compiler already reads — so pack titles reach the real Actor payload
 * through the established path and never as provider JSON.
 */
export function strategyToOrderedPlanSteps(
  strategy: {
    source_plan: ReadonlyArray<{
      step_id: string; capability_key: string; purpose: string;
      query_pack_ids: string[];
      semantic_filters: { countries?: string[]; maximum_age_days?: number; employment_types?: string[]; workplace_types?: string[] };
      rationale?: string;
    }>;
    query_packs: readonly QueryPack[];
    recency_policy: { maximum_age_days: number };
    broadening_ladder: readonly string[];
  },
  opts: { candidateTarget: number; minimumQualifiedCompanies?: number },
): OrderedHiringSourcePlan["steps"] {
  const packById = new Map(strategy.query_packs.map((p) => [p.pack_id, p]));

  return strategy.source_plan.map((step, i) => {
    const packs = step.query_pack_ids.map((id) => packById.get(id)).filter(Boolean) as QueryPack[];
    const titles = [...new Set(packs.flatMap((p) => p.titles))];
    const aliases = [...new Set(packs.flatMap((p) => [...p.titles, ...p.aliases]))];
    const exclusions = [...new Set(packs.flatMap((p) => p.negative_patterns))];

    // The FIRST step opens the mission; later steps activate only while quota
    // remains, so a met quota stops the plan rather than walking it.
    const activation: "initial" | "remaining_contact_quota" = i === 0 ? "initial" : "remaining_contact_quota";
    const role = i === 0 ? "precision_discovery" : i === 1 ? "broad_discovery" : "recall_fallback";

    return {
      stepId: step.step_id,
      order: i + 1,
      capability: step.capability_key as OrderedHiringSourcePlan["steps"][number]["capability"],
      role: role as OrderedHiringSourcePlan["steps"][number]["role"],
      reason: step.rationale || step.purpose,
      activationCondition: activation,
      semanticIntent: {
        approvedTitleAliases: aliases,
        geography: step.semantic_filters.countries?.[0],
        postingWindowDays: Math.min(
          step.semantic_filters.maximum_age_days ?? strategy.recency_policy.maximum_age_days,
          RUNTIME_MAX_RECENCY_DAYS,
        ),
        employmentTypes: step.semantic_filters.employment_types,
        candidateTarget: opts.candidateTarget,
        exclusionConcepts: exclusions.length > 0 ? exclusions : undefined,
        // `roleFamily` carries the pack's own label so a diagnostic can say WHICH
        // semantic slice produced a round, not merely which source did.
        roleFamily: packs[0]?.label,
      },
      successCondition: {
        minimumQualifiedCompanies: opts.minimumQualifiedCompanies ?? 1,
      },
      broadeningLadder: [],
      advanceConditions: ["source_exhausted", "no_safe_broadening_remaining"],
      stopConditions: ["contact_ready_quota_reached", "budget_exhausted", "valid_exhaustion"],
      nextStepId: strategy.source_plan[i + 1]?.step_id,
    } as OrderedHiringSourcePlan["steps"][number];
  });
}

/** Titles the compiler will actually send for a step, given the packs it carries. */
export function titlesForStep(
  packIds: readonly string[], packs: readonly QueryPack[],
): string[] {
  const byId = new Map(packs.map((p) => [p.pack_id, p]));
  return [...new Set(packIds.flatMap((id) => byId.get(id)?.titles ?? []))];
}
