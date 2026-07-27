// BOUNDED CLAUDE SOURCE FEEDBACK — the CONTRACT.
//
// PR #107 planned an ordered source sequence, #108 executes it one step at a time,
// #109 fuses what each source produced into canonical evidence. This adds ONE
// bounded interpretation step between "a source attempt finished" and "the next
// action is activated":
//
//   validated structured observation
//     -> the EXISTING model gateway
//     -> one structured recommendation
//     -> deterministic validation
//     -> the EXISTING deterministic fallback
//     -> the EXISTING sequential executor
//
// CLAUDE INTERPRETS. AGENTORY EXECUTES. Claude may recommend exactly one action
// from `ApprovedSourceNextAction` — PR #107's own closed union, not a second one.
// It cannot reach a provider, change task state, change what qualifies, or decide
// that anything counts toward quota.
//
// WHAT THIS MODULE OWNS: the request and response shapes, the projection of which
// actions are currently AVAILABLE, the deterministic-only cases that must never
// cost a model call, and the hashes that make one observation ask at most once.
//
// WHAT IT DELEGATES, and never reimplements:
//   approved action union      hiringSourcePlan.ts     (ApprovedSourceNextAction)
//   deterministic decision     hiringSourcePlan.ts     (decideNextAction)
//   safe broadening ladder     hiringSourcePlan.ts     (SafeBroadeningAction)
//   execution state            sourceExecutionState.ts
//   fused evidence             hiringEvidenceFusion.ts
//   hashing                    planHash.ts
//   feature flags              intelligence/intelligenceFlags.ts
//
// PURE. No network, provider, model or database access.

import { canonicalJson, sha256Hex } from "./planHash.ts";
import {
  decideNextAction, isSafeBroadeningAction,
  type ApprovedSourceNextAction, type OrderedHiringSourcePlan, type OrderedSourceStep,
  type SafeBroadeningAction, type SourceStepObservation,
} from "./hiringSourcePlan.ts";
import { isStepFinished, stepOf, type SourceExecutionState } from "./sourceExecutionState.ts";
import {
  companyHasDeadListing,
  type FuseSourceOutcome, type HiringEvidenceFusionState,
} from "./hiringEvidenceFusion.ts";

export const SOURCE_FEEDBACK_VERSION = "claude-source-feedback-v1";
export const SOURCE_FEEDBACK_PROMPT_VERSION = "source-feedback-prompt-1.0.0";
export const SOURCE_FEEDBACK_POLICY_VERSION = "source-feedback-policy-1.0.0";

/** Key inside the existing company-first checkpoint. No new column, no migration. */
export const SOURCE_FEEDBACK_KEY = "source_feedback";

/** Env var holding the comma-separated workspace allow-list. */
export const CLAUDE_SOURCE_FEEDBACK_WORKSPACES_ENV = "CLAUDE_SOURCE_FEEDBACK_WORKSPACES";

/**
 * Hard ceiling on feedback calls per task.
 *
 * Conservative on purpose. A five-step plan has at most a handful of checkpoints,
 * and the value of a second opinion falls off sharply after the first two — while
 * the cost does not. Below the plan's own provider-call ceiling by construction.
 */
export const MAX_SOURCE_FEEDBACK_CALLS_PER_TASK = 3;

/** Bounds on every text field that reaches, or returns from, the model. */
export const FEEDBACK_BOUNDS = {
  maxReasonChars: 240,
  maxListItems: 20,
  maxIdChars: 128,
  maxPriorActions: 8,
} as const;

// ------------------------------------------------------- fused observation ---

/**
 * What PR #109's fusion knows about the batch that just ran.
 *
 * Separate from `SourceStepObservation` because that contract is PR #107's and
 * describes one source's raw funnel. These are the FUSED numbers — unique canonical
 * events, canonical companies, evidence sufficiency — and they are what a strategy
 * decision must actually be made from. Twenty-five duplicate postings are real rows
 * and zero new evidence; only the second number may look like progress.
 */
export interface FusedEvidenceMetrics {
  normalizedSignals: number;
  uniqueSignals: number;
  canonicalCompanies: number;
  evidenceSufficient: number;
  evidencePending: number;
  staleEvidence: number;
  conflictingEvidence: number;
  duplicatesCollapsed: number;
  peopleSearchesPrevented: number;
}

export function emptyFusedMetrics(): FusedEvidenceMetrics {
  return {
    normalizedSignals: 0, uniqueSignals: 0, canonicalCompanies: 0,
    evidenceSufficient: 0, evidencePending: 0, staleEvidence: 0, conflictingEvidence: 0,
    duplicatesCollapsed: 0, peopleSearchesPrevented: 0,
  };
}

/**
 * Read the fused metrics out of PR #109's state.
 *
 * Every number is READ, never recomputed: evidence sufficiency belongs to the
 * timing authority, dead listings to the freshness policy, conflicts to
 * reconciliation. A second calculation here would be a second policy, and the one
 * time this repository had two hiring policies they diverged.
 */
export function fusedMetricsFrom(
  state: HiringEvidenceFusionState | null | undefined,
  last?: FuseSourceOutcome | null,
): FusedEvidenceMetrics {
  if (!state) return emptyFusedMetrics();
  const companies = Object.values(state.companies);

  return {
    normalizedSignals: last?.counts.signalsProduced ?? 0,
    uniqueSignals: Object.keys(state.signals).length,
    canonicalCompanies: companies.length,
    evidenceSufficient: companies.filter((c) => c.latestTimingDecision === "timing_sufficient").length,
    evidencePending: companies.filter((c) =>
      c.latestTimingDecision === undefined || c.latestTimingDecision === "missing_timing_evidence").length,
    staleEvidence: companies.filter((c) => companyHasDeadListing(state, c.companyKey)).length,
    conflictingEvidence: companies.filter((c) => c.conflicts.length > 0).length,
    duplicatesCollapsed: last?.counts.duplicatesCollapsed ?? 0,
    // Companies this batch touched again without changing anything, whose one
    // decision-maker search had already run: the paid people calls fusion avoided.
    peopleSearchesPrevented: (last?.unchangedCompanyKeys ?? [])
      .filter((k) => state.companies[k]?.peopleSearchCompleted).length,
  };
}

/**
 * A deterministic hash over the fused evidence picture.
 *
 * Built from the per-company evidence hashes PR #109 already computes, sorted, so
 * the order sources ran in cannot change it.
 */
export async function fusedEvidenceHash(state: HiringEvidenceFusionState | null | undefined): Promise<string> {
  const companies = Object.values(state?.companies ?? {})
    .map((c) => `${c.companyKey}:${c.evidenceHash}`)
    .sort();
  return await sha256Hex(canonicalJson({ companies }));
}

// ------------------------------------------------------ available actions ----

/**
 * The actions that are valid RIGHT NOW.
 *
 * This is the menu, and it is the only thing the model is shown. An action absent
 * from this list cannot be recommended, so "Claude invented a source" is not a
 * failure mode the validator has to catch after the fact — the option was never
 * on the table.
 */
export type AvailableBoundedAction =
  | { action: "broaden_current_source"; stepId: string; broadeningActions: SafeBroadeningAction[] }
  | { action: "advance_to_next_source"; currentStepId: string; nextStepId: string }
  | { action: "verify_selected_jobs"; companyIds: string[] }
  | { action: "enrich_company_identity"; companyIds: string[] }
  | { action: "enrich_contacts"; personIds: string[] }
  | { action: "stop_valid_exhaustion" };

/**
 * Downstream facts the projection needs and cannot derive from the plan.
 *
 * Supplied by the caller from the EXISTING fused state and canonical task state —
 * this module never re-derives company identity, evidence sufficiency or contact
 * readiness, all of which already have authorities.
 */
export interface FeedbackProjectionContext {
  /** Companies with a resolved ATS type + slug. Gates verification. */
  atsIdentitiesAvailable: number;
  /** Canonical company keys whose hiring evidence is weak, stale or conflicting. */
  companiesForVerification: string[];
  /** Canonical company keys with sufficient evidence but no strong identity. */
  companiesNeedingIdentity: string[];
  /** Canonical person ids that are qualified but have no contact method. */
  peopleNeedingContact: string[];
  /** Every canonical company key in task state. Referential integrity for the validator. */
  knownCompanyIds: string[];
  /** Every canonical person id in task state. */
  knownPersonIds: string[];
}

export function emptyProjectionContext(): FeedbackProjectionContext {
  return {
    atsIdentitiesAvailable: 0,
    companiesForVerification: [], companiesNeedingIdentity: [], peopleNeedingContact: [],
    knownCompanyIds: [], knownPersonIds: [],
  };
}

/** Unused rungs of a step's own approved ladder, in ladder order. */
export function remainingBroadening(
  step: OrderedSourceStep,
  observation: SourceStepObservation,
): SafeBroadeningAction[] {
  const used = new Set(observation.broadeningActionsUsed ?? []);
  return (step.broadeningLadder ?? []).filter((b) => isSafeBroadeningAction(b) && !used.has(b.action));
}

/**
 * Project the currently-valid action set.
 *
 * Every branch answers a question about the CURRENT state, never about ambition:
 * budget and call ceilings first (an action nobody can pay for is not an option),
 * then the step's own remaining ladder, then the validated successor, then the
 * enrichment actions — each gated on there being something that actually needs it.
 */
export function projectAvailableActions(args: {
  plan: OrderedHiringSourcePlan;
  state: SourceExecutionState;
  observation: SourceStepObservation;
  context?: FeedbackProjectionContext;
}): AvailableBoundedAction[] {
  const { plan, state, observation } = args;
  const ctx = args.context ?? emptyProjectionContext();
  const out: AvailableBoundedAction[] = [];

  // Quota is the completion authority. A satisfied request has no next action to
  // choose between, so the menu is empty and the decision is mandatory.
  if (observation.totalContactReady >= plan.completionCondition.target) return out;

  const budgetRemains = observation.remainingBudgetUsd > 0
    && state.cumulative_cost < plan.maximumEstimatedCostUsd;
  const callsRemain = state.provider_calls < plan.maximumProviderCalls;

  const step = plan.steps.find((s) => s.stepId === observation.stepId);
  const record = stepOf(state, observation.stepId);

  if (step && budgetRemains && callsRemain) {
    if (
      !observation.sourceExhausted
      && (!record || !isStepFinished(record))
      && observation.attempt < plan.maximumBroadeningAttempts
    ) {
      const rungs = remainingBroadening(step, observation);
      if (rungs.length > 0) {
        out.push({ action: "broaden_current_source", stepId: step.stepId, broadeningActions: rungs });
      }
    }

    // The validated successor, and only a successor that is not already finished.
    const next = step.nextStepId ? plan.steps.find((s) => s.stepId === step.nextStepId) : undefined;
    const nextRecord = next ? stepOf(state, next.stepId) : null;
    if (next && (!nextRecord || !isStepFinished(nextRecord))) {
      out.push({ action: "advance_to_next_source", currentStepId: step.stepId, nextStepId: next.stepId });
    }

    // Verification is conditional on identity, never on ambition: without a resolved
    // company and ATS slug there is nothing to verify and the call cannot succeed.
    const verificationStep = plan.steps.find((s) => s.role === "verification");
    const verificationRecord = verificationStep ? stepOf(state, verificationStep.stepId) : null;
    if (
      verificationStep && (!verificationRecord || !isStepFinished(verificationRecord))
      && ctx.atsIdentitiesAvailable > 0 && ctx.companiesForVerification.length > 0
    ) {
      out.push({ action: "verify_selected_jobs", companyIds: boundIds(ctx.companiesForVerification) });
    }
  }

  // Enrichment does not consume a discovery step, but it does cost money.
  if (budgetRemains && ctx.companiesNeedingIdentity.length > 0) {
    out.push({ action: "enrich_company_identity", companyIds: boundIds(ctx.companiesNeedingIdentity) });
  }
  if (budgetRemains && ctx.peopleNeedingContact.length > 0) {
    out.push({ action: "enrich_contacts", personIds: boundIds(ctx.peopleNeedingContact) });
  }

  // Honest exhaustion is offered ONLY when nothing else is. Presenting "stop" beside
  // real options would let a model end a run that still had quota and budget.
  if (out.length === 0) out.push({ action: "stop_valid_exhaustion" });

  return out;
}

// ------------------------------------------------ mandatory determinism ------

export interface MandatoryDecision {
  action: ApprovedSourceNextAction;
  reason:
    | "quota_reached"
    | "budget_exhausted"
    | "provider_call_limit"
    | "no_available_action"
    | "single_valid_action";
}

/**
 * The cases where semantic judgment adds nothing, so no model call is made.
 *
 * A model call is only justified when two or more SAFE alternatives exist and
 * choosing between them needs interpretation. Everything else already has one right
 * answer, and paying a model to restate it is waste with a failure mode attached.
 */
export function mandatoryDeterministicAction(
  plan: OrderedHiringSourcePlan,
  state: SourceExecutionState,
  observation: SourceStepObservation,
  available: AvailableBoundedAction[],
): MandatoryDecision | null {
  const deterministic = () => decideNextAction(plan, observation);

  if (observation.totalContactReady >= plan.completionCondition.target) {
    return { action: deterministic(), reason: "quota_reached" };
  }
  if (observation.remainingBudgetUsd <= 0 || state.cumulative_cost >= plan.maximumEstimatedCostUsd) {
    return { action: deterministic(), reason: "budget_exhausted" };
  }
  if (state.provider_calls >= plan.maximumProviderCalls) {
    return { action: deterministic(), reason: "provider_call_limit" };
  }

  const real = available.filter((a) => a.action !== "stop_valid_exhaustion");
  if (real.length === 0) return { action: deterministic(), reason: "no_available_action" };
  if (real.length === 1) return { action: deterministic(), reason: "single_valid_action" };
  return null;
}

// --------------------------------------------------------- the request -------

export interface ClaudeSourceFeedbackRequest {
  version: typeof SOURCE_FEEDBACK_VERSION;

  taskContext: {
    taskIdHash: string;
    workspaceIdHash: string;
    sourcePlanHash: string;
    companyBrainPolicyHash: string;
  };

  mission: {
    companyCategory?: string[];
    industries?: string[];
    businessModels?: string[];
    stages?: string[];
    employeeRange?: { min?: number; max?: number };

    requiredTrigger: string[];
    roleFamily?: string;
    approvedRoleAliases: string[];
    geography?: string;

    decisionMakerRoles: string[];
    requestedContactReadyCount: number;
  };

  currentStep: {
    stepId: string;
    order: number;
    capability: string;
    role: string;
    attempt: number;
    purpose: string;
  };

  sourceObservation: {
    rawResults: number;
    normalizedSignals: number;
    uniqueSignals: number;
    canonicalCompanies: number;

    companyBrainPass: number;
    companyBrainFail: number;

    evidenceSufficient: number;
    evidencePending: number;
    staleEvidence: number;
    conflictingEvidence: number;

    strongIdentity: number;
    peopleSearched: number;
    employerVerified: number;
    contactReady: number;

    incrementalContactReady: number;
    totalContactReady: number;
    remainingQuota: number;
  };

  rejectionSummary: {
    wrongRole: number;
    wrongGeography: number;
    companyBrainMismatch: number;
    insufficientEvidence: number;
    staleEvidence: number;
    conflictingEvidence: number;
    missingIdentity: number;
    missingDecisionMaker: number;
    employerMismatch: number;
    missingContactMethod: number;
  };

  runtimeLimits: {
    remainingBudgetUsd: number;
    remainingProviderCalls: number;
    remainingSourceSteps: number;
    remainingBroadeningAttempts: number;
  };

  availableActions: AvailableBoundedAction[];

  priorActions: Array<{ action: string; stepId?: string; outcomeSummary: string }>;
}

export interface BuildFeedbackRequestInput {
  plan: OrderedHiringSourcePlan;
  state: SourceExecutionState;
  observation: SourceStepObservation;
  fused: FusedEvidenceMetrics;
  available: AvailableBoundedAction[];
  taskIdHash: string;
  workspaceIdHash: string;
  companyBrainPolicyHash: string;
  priorActions?: Array<{ action: string; stepId?: string; outcomeSummary: string }>;
}

/**
 * Build the bounded, sanitized summary.
 *
 * EVERY field here is a count, an internal identifier or a semantic term the
 * mission profile already approved. There is no provider payload, no job
 * description, no company blurb, no URL, no Actor id, no raw Actor input and no
 * contact detail — not because they are filtered on the way out, but because the
 * shape has nowhere to put them.
 */
export function buildFeedbackRequest(input: BuildFeedbackRequestInput): ClaudeSourceFeedbackRequest {
  const { plan, state, observation, fused } = input;
  const p = plan.missionProfile;
  const step = plan.steps.find((s) => s.stepId === observation.stepId);

  const finishedSteps = state.steps.filter(isStepFinished).length;

  return {
    version: SOURCE_FEEDBACK_VERSION,

    taskContext: {
      taskIdHash: bound(input.taskIdHash, FEEDBACK_BOUNDS.maxIdChars),
      workspaceIdHash: bound(input.workspaceIdHash, FEEDBACK_BOUNDS.maxIdChars),
      sourcePlanHash: bound(plan.planHash, FEEDBACK_BOUNDS.maxIdChars),
      companyBrainPolicyHash: bound(input.companyBrainPolicyHash, FEEDBACK_BOUNDS.maxIdChars),
    },

    mission: {
      ...(p.companyCategory?.length ? { companyCategory: boundList(p.companyCategory) } : {}),
      ...(p.industries?.length ? { industries: boundList(p.industries) } : {}),
      ...(p.businessModels?.length ? { businessModels: boundList(p.businessModels) } : {}),
      ...(p.stages?.length ? { stages: boundList(p.stages) } : {}),
      ...(p.employeeRange ? { employeeRange: p.employeeRange } : {}),
      requiredTrigger: boundList(p.triggerRequirements),
      ...(p.hiring?.roleFamily ? { roleFamily: bound(p.hiring.roleFamily, FEEDBACK_BOUNDS.maxIdChars) } : {}),
      approvedRoleAliases: boundList(p.hiring?.approvedAliases ?? []),
      ...(p.hiring?.geography ? { geography: bound(p.hiring.geography, FEEDBACK_BOUNDS.maxIdChars) } : {}),
      decisionMakerRoles: boundList(p.decisionMakerRoles),
      requestedContactReadyCount: plan.completionCondition.target,
    },

    currentStep: {
      stepId: observation.stepId,
      order: step?.order ?? 0,
      capability: observation.capability,
      role: step?.role ?? "unknown",
      attempt: observation.attempt,
      // The step's own recorded reason — authored by the plan, never by a provider.
      purpose: bound(step?.reason ?? "", FEEDBACK_BOUNDS.maxReasonChars),
    },

    sourceObservation: {
      rawResults: observation.funnel.rawResults,
      normalizedSignals: fused.normalizedSignals,
      uniqueSignals: fused.uniqueSignals,
      canonicalCompanies: fused.canonicalCompanies,
      companyBrainPass: observation.funnel.companyBrainPass,
      companyBrainFail: observation.funnel.companyBrainFail,
      evidenceSufficient: fused.evidenceSufficient,
      evidencePending: fused.evidencePending,
      staleEvidence: fused.staleEvidence,
      conflictingEvidence: fused.conflictingEvidence,
      strongIdentity: observation.funnel.strongIdentity,
      peopleSearched: observation.funnel.peopleSearched,
      employerVerified: observation.funnel.employerVerified,
      contactReady: observation.funnel.contactReady,
      incrementalContactReady: observation.incrementalContactReady,
      totalContactReady: observation.totalContactReady,
      remainingQuota: observation.remainingQuota,
    },

    rejectionSummary: {
      wrongRole: observation.rejectionSummary.wrongRole,
      wrongGeography: observation.rejectionSummary.wrongGeography,
      companyBrainMismatch: observation.rejectionSummary.companyBrainMismatch,
      insufficientEvidence: fused.evidencePending,
      staleEvidence: fused.staleEvidence,
      conflictingEvidence: fused.conflictingEvidence,
      missingIdentity: observation.rejectionSummary.missingIdentity,
      missingDecisionMaker: observation.rejectionSummary.missingDecisionMaker,
      employerMismatch: observation.rejectionSummary.employerMismatch,
      missingContactMethod: observation.rejectionSummary.missingContactMethod,
    },

    runtimeLimits: {
      remainingBudgetUsd: round2(Math.max(0, observation.remainingBudgetUsd)),
      remainingProviderCalls: Math.max(0, plan.maximumProviderCalls - state.provider_calls),
      remainingSourceSteps: Math.max(0, plan.steps.length - finishedSteps),
      remainingBroadeningAttempts: Math.max(0, plan.maximumBroadeningAttempts - observation.attempt),
    },

    availableActions: input.available,

    priorActions: (input.priorActions ?? []).slice(-FEEDBACK_BOUNDS.maxPriorActions).map((a) => ({
      action: bound(a.action, FEEDBACK_BOUNDS.maxIdChars),
      ...(a.stepId ? { stepId: bound(a.stepId, FEEDBACK_BOUNDS.maxIdChars) } : {}),
      outcomeSummary: bound(a.outcomeSummary, FEEDBACK_BOUNDS.maxReasonChars),
    })),
  };
}

// --------------------------------------------------------- the response -----

export type SourceFeedbackReasonCode =
  | "quota_reached"
  | "low_source_volume"
  | "low_unique_company_yield"
  | "poor_company_brain_yield"
  | "insufficient_current_evidence"
  | "identity_gap"
  | "contact_gap"
  | "source_exhausted"
  | "better_precision_source_available"
  | "better_recall_source_available"
  | "budget_or_call_limit"
  | "valid_exhaustion";

export const SOURCE_FEEDBACK_REASON_CODES: readonly SourceFeedbackReasonCode[] = [
  "quota_reached", "low_source_volume", "low_unique_company_yield", "poor_company_brain_yield",
  "insufficient_current_evidence", "identity_gap", "contact_gap", "source_exhausted",
  "better_precision_source_available", "better_recall_source_available",
  "budget_or_call_limit", "valid_exhaustion",
];

export type ExpectedImprovement =
  | "raw_volume" | "unique_company_yield" | "company_brain_yield" | "evidence_strength"
  | "identity_resolution" | "contact_ready_yield" | "none";

export const EXPECTED_IMPROVEMENTS: readonly ExpectedImprovement[] = [
  "raw_volume", "unique_company_yield", "company_brain_yield", "evidence_strength",
  "identity_resolution", "contact_ready_yield", "none",
];

export type FeedbackConfidence = "high" | "medium" | "low";

export interface ClaudeSourceFeedbackResponse {
  version: typeof SOURCE_FEEDBACK_VERSION;
  recommendation: ApprovedSourceNextAction;
  reasonCode: SourceFeedbackReasonCode;
  /** SHORT. A diagnostic label, never a request for hidden reasoning. */
  conciseReason: string;
  expectedEffect: {
    expectedToImprove: ExpectedImprovement;
    confidence: FeedbackConfidence;
  };
  constraintsPreserved: true;
}

/** The only shape the model may return. Rendered into the prompt verbatim. */
export const SOURCE_FEEDBACK_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["strategy"],
  properties: {
    strategy: {
      type: "object",
      required: ["version", "recommendation", "reasonCode", "conciseReason", "expectedEffect", "constraintsPreserved"],
      additionalProperties: false,
      properties: {
        version: { const: SOURCE_FEEDBACK_VERSION },
        recommendation: {
          type: "object",
          description:
            "EXACTLY ONE action, copied from availableActions. For broaden_current_source "
            + "supply one broadeningAction object taken unchanged from that step's list.",
          properties: {
            action: {
              enum: [
                "broaden_current_source", "advance_to_next_source", "verify_selected_jobs",
                "enrich_company_identity", "enrich_contacts", "stop_valid_exhaustion",
              ],
            },
            stepId: { type: "string" },
            currentStepId: { type: "string" },
            nextStepId: { type: "string" },
            broadeningAction: { type: "object" },
            companyIds: { type: "array", items: { type: "string" } },
            personIds: { type: "array", items: { type: "string" } },
            reason: { type: "string" },
          },
          required: ["action"],
        },
        reasonCode: { enum: [...SOURCE_FEEDBACK_REASON_CODES] },
        conciseReason: { type: "string", maxLength: FEEDBACK_BOUNDS.maxReasonChars },
        expectedEffect: {
          type: "object",
          additionalProperties: false,
          required: ["expectedToImprove", "confidence"],
          properties: {
            expectedToImprove: { enum: [...EXPECTED_IMPROVEMENTS] },
            confidence: { enum: ["high", "medium", "low"] },
          },
        },
        constraintsPreserved: { const: true },
      },
    },
  },
};

// ------------------------------------------------------------- task state ---

export type SourceFeedbackStatus =
  | "not_requested"
  | "model_recommended"
  | "model_unavailable"
  | "model_timeout"
  | "invalid_response"
  | "rejected_by_validator"
  | "deterministic_fallback";

/**
 * The persisted record of ONE feedback checkpoint.
 *
 * Carries hashes, statuses and the two bounded actions — never a prompt, a raw
 * response, hidden reasoning, a credential or any provider content.
 */
export interface SourceFeedbackState {
  requestKey: string;
  observationHash: string;
  attemptedAt: string;

  status: SourceFeedbackStatus;

  recommendedAction?: ApprovedSourceNextAction;
  acceptedAction?: ApprovedSourceNextAction;

  reasonCode?: string;
  validationReasonCodes?: string[];

  modelProvider?: "anthropic";
  modelName?: string;
  promptVersion: string;
  policyVersion: string;
}

/** Every feedback checkpoint of one task, plus the call ledger. */
export interface SourceFeedbackLedger {
  version: typeof SOURCE_FEEDBACK_VERSION;
  /** Model calls actually ATTEMPTED. Bounded by MAX_SOURCE_FEEDBACK_CALLS_PER_TASK. */
  callsUsed: number;
  checkpoints: SourceFeedbackState[];
}

export function newFeedbackLedger(): SourceFeedbackLedger {
  return { version: SOURCE_FEEDBACK_VERSION, callsUsed: 0, checkpoints: [] };
}

/** The checkpoint already recorded for this request key, if any. */
export function checkpointFor(
  ledger: SourceFeedbackLedger | null | undefined,
  requestKey: string,
): SourceFeedbackState | null {
  return ledger?.checkpoints.find((c) => c.requestKey === requestKey) ?? null;
}

// ----------------------------------------------------------- idempotency ----

/**
 * A hash of what was OBSERVED.
 *
 * Deliberately excludes wall-clock time and every identifier that varies between
 * two runs of the same situation, so "the same observation" is a stable notion and
 * the request key below can be trusted to suppress a second call.
 */
export async function observationHash(
  observation: SourceStepObservation,
  fused: FusedEvidenceMetrics,
): Promise<string> {
  return await sha256Hex(canonicalJson({
    step: observation.stepId,
    capability: observation.capability,
    attempt: observation.attempt,
    funnel: observation.funnel,
    rejections: observation.rejectionSummary,
    incremental: observation.incrementalContactReady,
    total: observation.totalContactReady,
    remaining: observation.remainingQuota,
    exhausted: observation.sourceExhausted,
    broadeningUsed: [...(observation.broadeningActionsUsed ?? [])].sort(),
    fused,
  }));
}

/**
 * The deterministic identity of ONE feedback request.
 *
 * The same key must never trigger a second model call — after success, timeout,
 * an invalid response OR a deterministic fallback. A retry that re-asked after a
 * timeout would be paying twice for the same question, and a resumed task would
 * pay again for a question already answered.
 */
export async function feedbackRequestKey(args: {
  sourcePlanHash: string;
  stepId: string;
  attempt: number;
  observationHash: string;
  evidenceHash: string;
  remainingQuota: number;
}): Promise<string> {
  return await sha256Hex(canonicalJson({
    plan: args.sourcePlanHash,
    step: args.stepId,
    attempt: args.attempt,
    observation: args.observationHash,
    evidence: args.evidenceHash,
    quota: args.remainingQuota,
    policy: SOURCE_FEEDBACK_POLICY_VERSION,
  }));
}

// ---------------------------------------------------------------- helpers ---

function bound(v: unknown, max: number): string {
  const s = String(v ?? "").trim();
  return s.length > max ? s.slice(0, max) : s;
}

function boundList(v: readonly unknown[] | null | undefined): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    const s = bound(raw, FEEDBACK_BOUNDS.maxIdChars);
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
    if (out.length >= FEEDBACK_BOUNDS.maxListItems) break;
  }
  return out;
}

/**
 * Bound a list of internal identifiers.
 *
 * Anything email- or phone-shaped is DROPPED rather than truncated: an id list is
 * the one place a private contact detail could plausibly reach the prompt by
 * accident, and a partial email is still a partial email.
 */
export function boundIds(v: readonly string[] | null | undefined): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    const s = String(raw ?? "").trim();
    if (!s || s.length > FEEDBACK_BOUNDS.maxIdChars) continue;
    if (/@/.test(s)) continue;
    if (/(?:\+?\d[\s().-]?){7,}/.test(s)) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= FEEDBACK_BOUNDS.maxListItems) break;
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
