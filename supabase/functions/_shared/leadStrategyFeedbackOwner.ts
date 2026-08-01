// ONE GPT OWNER FOR FEEDBACK AND PLAN-AWARE EXECUTION.
//
// The same strategist that authors the INITIAL strategy also interprets every
// later source observation. Before this module the runtime had two brains:
// Claude answered "what next?" through `sourceFeedbackRuntime`, while Gemini
// still authored later-round broadening. On
//
//     workflow = qualified_lead_sourcing  AND  execution_mode = company_first
//
// neither is reachable any more. Authority order is exactly the initial one:
//
//     configured primary strategist
//       -> one configured escalation model, only after INVALID output
//       -> the existing deterministic decision
//
// This module is PROVIDER-INDEPENDENT. It speaks to `StrategistCallFn`, never to
// Lovable AI, OpenAI or Anthropic, so switching providers is configuration.
//
// Nothing here executes. It returns a `GenerateJsonFn` the existing feedback
// runtime already knows how to use, plus the plan-aware budget the runtime asks
// before spending another action. Qualification, quota and persistence are
// untouched authorities.

import {
  callLeadStrategyModel, modelForTier, LEAD_STRATEGY_TIMEOUT_MS, LEAD_STRATEGY_PROVIDER,
  type LeadStrategyModelFn,
} from "./leadStrategyModels.ts";
import { providerToCallFn, type QualifiedLeadStrategistProvider } from "./leadStrategy/provider.ts";
import { leadStrategyOwnerApplies, type LeadStrategyGateInput } from "./leadStrategyOwner.ts";
import type { GenerateJsonFn } from "./intelligence/plannerWrapper.ts";
import type { GenerateOpts, GenerateResult } from "./aiProvider.ts";
import type { BottleneckKind } from "./sourcingBottleneck.ts";

export const LEAD_FEEDBACK_POLICY_VERSION = "lead-strategy-feedback-policy-1.0.0";

/** The gate is the initial-strategy gate. One workflow, one owner, no drift. */
export function leadFeedbackOwnerApplies(input: LeadStrategyGateInput): boolean {
  return leadStrategyOwnerApplies(input);
}

// ---------------------------------------------------------- action vocabulary

/**
 * The strategic actions the owner may choose between. A superset of the bounded
 * executable union in intent only: each maps onto an action the deterministic
 * runtime already knows how to run. Nothing new can be executed by naming it.
 */
export const LEAD_FEEDBACK_ACTIONS = [
  "run_unused_query_pack",
  "tighten_query_pack",
  "advance_source",
  "activate_direct_adjacent_pack",
  "activate_evidence_gated_pack",
  "begin_company_enrichment",
  "begin_people_search",
  "run_contact_enrichment",
  "stop_success",
  "stop_partial",
] as const;
export type LeadFeedbackAction = typeof LEAD_FEEDBACK_ACTIONS[number];

/**
 * The honest reading of a finished source attempt.
 *
 * Deliberately NOT "did we get rows?". Twenty-five off-family postings are rows
 * and zero progress; the correct response to them is a tighter query, not the
 * same query sent to a different Actor.
 */
export interface FeedbackObservationSignals {
  bottleneck: BottleneckKind | string | null;
  /** Share of returned titles outside the mission's role family. 0..1 */
  offFamilyRate: number;
  /** Companies rejected by Company Brain despite on-family titles. */
  companyBrainFail: number;
  /** Companies whose hiring signal is strong but whose evidence is missing. */
  evidencePending: number;
  /** Companies that passed Company Brain and have no decision-maker search yet. */
  qualifiedCompaniesAwaitingPeople: number;
  /** Verified people with no contact method. */
  peopleNeedingContact: number;
  unusedExactPacks: number;
  unusedAdjacentPacks: number;
  unusedSources: number;
  remainingQuota: number;
  contactReady: number;
}

export interface AdaptiveActionChoice {
  action: LeadFeedbackAction;
  reason: string;
}

/** Precision thresholds. Above this a source is producing noise, not leads. */
export const HIGH_NOISE_RATE = 0.5;

/**
 * The deterministic reading of an observation.
 *
 * This is the fallback AND the reference the strategist is scored against: a
 * model recommendation that cannot be executed resolves to exactly this.
 */
export function adaptiveActionFor(s: FeedbackObservationSignals): AdaptiveActionChoice {
  if (s.remainingQuota <= 0) {
    return { action: "stop_success", reason: "contact_quota_reached" };
  }
  // Contact-side progress first: a verified person one enrichment away from
  // CONTACT is worth more than any new discovery call.
  if (s.peopleNeedingContact > 0) {
    return { action: "run_contact_enrichment", reason: "verified_people_missing_contact_evidence" };
  }
  if (s.qualifiedCompaniesAwaitingPeople > 0) {
    return { action: "begin_people_search", reason: "qualified_companies_without_decision_makers" };
  }
  if (s.evidencePending > 0) {
    return { action: "begin_company_enrichment", reason: "company_evidence_missing" };
  }
  // Relevant titles, wrong companies: the query intent is right, the SOURCE is
  // pointed at the wrong population. Preserve the titles, change the source.
  if (s.companyBrainFail > 0 && s.offFamilyRate < HIGH_NOISE_RATE && s.unusedSources > 0) {
    return { action: "advance_source", reason: "company_brain_rejection_preserve_title_intent" };
  }
  // Noise: tighten before spending another source on the same bad query.
  if (s.offFamilyRate >= HIGH_NOISE_RATE) {
    if (s.unusedExactPacks > 0) {
      return { action: "tighten_query_pack", reason: "poor_source_precision_tighten_before_advancing" };
    }
    if (s.unusedSources > 0) {
      return { action: "advance_source", reason: "excessive_title_noise_no_tighter_pack_available" };
    }
  }
  if (s.unusedExactPacks > 0) {
    return { action: "run_unused_query_pack", reason: "exact_pack_remains_unused" };
  }
  if (s.unusedSources > 0) {
    return { action: "advance_source", reason: "unused_relevant_source_remains" };
  }
  if (s.unusedAdjacentPacks > 0) {
    return { action: "activate_direct_adjacent_pack", reason: "exact_coverage_exhausted" };
  }
  return {
    action: s.contactReady > 0 ? "stop_partial" : "stop_partial",
    reason: "valid_exhaustion_no_remaining_action",
  };
}

// -------------------------------------------------------- plan-aware budget --

export interface PlanAwareBudgetInput {
  unusedExactPacks: number;
  unusedAdjacentPacks: number;
  unusedSources: number;
  remainingQuota: number;
  remainingBudgetUsd: number;
  /** Per-source observed quality, -1 (noise) .. 1 (precise). */
  sourceQuality?: Record<string, number>;
  actionsSpent: number;
}

/** Hard upper safety bound. No plan, however rich, may exceed it. */
export const MAX_PLAN_AWARE_ACTIONS = 12;

export interface PlanAwareBudget {
  allowed: number;
  remaining: number;
  exhausted: boolean;
  reason: string;
}

/**
 * The blind "stop after three rounds" rule replaced by one that can count.
 *
 * A run with four unused exact packs and two untried sources is not finished at
 * round three; a run whose every remaining source has produced only noise is
 * finished at round one. The budget is what the plan can still legitimately do,
 * clamped by money, quota and a hard ceiling.
 */
export function planAwareActionBudget(input: PlanAwareBudgetInput): PlanAwareBudget {
  if (input.remainingQuota <= 0) {
    return { allowed: input.actionsSpent, remaining: 0, exhausted: true, reason: "quota_reached" };
  }
  if (input.remainingBudgetUsd <= 0) {
    return { allowed: input.actionsSpent, remaining: 0, exhausted: true, reason: "budget_exhausted" };
  }

  const quality = input.sourceQuality ?? {};
  const scores = Object.values(quality);
  // Every remaining source having produced noise is evidence about the NEXT one.
  const allNoisy = scores.length > 0 && scores.every((v) => v <= -0.5);

  let allowed = input.unusedExactPacks
    + input.unusedAdjacentPacks
    + input.unusedSources
    // Progression actions: enrichment, people search, contact enrichment.
    + 3;
  if (allNoisy) allowed = Math.min(allowed, input.actionsSpent + 1);
  allowed = Math.max(1, Math.min(allowed, MAX_PLAN_AWARE_ACTIONS));

  const remaining = Math.max(0, allowed - input.actionsSpent);
  return {
    allowed,
    remaining,
    exhausted: remaining <= 0,
    reason: remaining <= 0
      ? (allNoisy ? "source_quality_history_exhausted" : "plan_action_budget_exhausted")
      : "actions_remain",
  };
}

// -------------------------------------------------- the provider-independent
// -------------------------------------------------- generate seam

export interface StrategistGenerateOpts {
  /** Injected in tests; defaults to the configured adapter. */
  callModel?: LeadStrategyModelFn;
  provider?: QualifiedLeadStrategistProvider;
  timeoutMs?: number;
  /** One escalation attempt after INVALID output. Default true. */
  allowEscalation?: boolean;
}

/**
 * Adapt the strategist to the `GenerateJsonFn` seam the feedback runtime uses.
 *
 * Handing the existing runtime this function is the whole of the unification:
 * the prompt assembly, bounded action menu, validation, checkpointing and
 * deterministic fallback stay exactly where they are, and the brain behind them
 * becomes the one strategy owner. `taskType`, `preferredProvider` and every
 * other Gemini/Claude routing hint on `GenerateOpts` is deliberately IGNORED —
 * on this workflow there is nothing else to route to.
 */
export function createStrategistGenerateJson(opts: StrategistGenerateOpts = {}): GenerateJsonFn {
  const call: LeadStrategyModelFn = opts.callModel
    ?? (opts.provider ? providerToCallFn(opts.provider) : callLeadStrategyModel);
  const providerId = opts.provider?.id ?? LEAD_STRATEGY_PROVIDER;
  let escalatedOnce = false;

  return async (gen: GenerateOpts): Promise<GenerateResult> => {
    const systemPrompt = gen.systemPrompt ?? "";
    const userMessage = gen.messages
      .filter((m) => m.role !== "system")
      .map((m) => m.content)
      .join("\n\n");

    const model = modelForTier("primary");
    const result = await call({
      model,
      systemPrompt,
      userMessage,
      timeoutMs: opts.timeoutMs ?? LEAD_STRATEGY_TIMEOUT_MS,
    });

    if (result.ok) {
      return {
        ok: true,
        content: result.content,
        json: result.json,
        // The canonical result carries its own adapter id; the legacy provider
        // union only knows two names, so the transport is reported honestly and
        // the strategist id travels in `model`.
        provider: "lovable-ai",
        model: `${result.provider ?? providerId}:${result.model}`,
        usage: result.usage,
        latencyMs: result.latencyMs,
      };
    }

    // ONE ESCALATION, AND ONLY FOR OUTPUT THE STRATEGIST GOT WRONG. A rate limit
    // or a timeout is not a reasoning failure, and re-asking a bigger model to
    // fix an upstream outage just spends more money on the same outage.
    const invalidOutput = result.errorCode === "json_parse_failed";
    if (invalidOutput && !escalatedOnce && opts.allowEscalation !== false) {
      escalatedOnce = true;
      const escalation = await call({
        model: modelForTier("escalation"),
        systemPrompt,
        userMessage,
        timeoutMs: opts.timeoutMs ?? LEAD_STRATEGY_TIMEOUT_MS,
      });
      return {
        ok: escalation.ok,
        content: escalation.content,
        json: escalation.json,
        provider: escalation.ok ? "lovable-ai" : "none",
        model: `${escalation.provider ?? providerId}:${escalation.model}`,
        usage: escalation.usage,
        error: escalation.error,
        errorCode: escalation.errorCode,
        latencyMs: (result.latencyMs ?? 0) + (escalation.latencyMs ?? 0),
      };
    }

    return {
      ok: false,
      content: result.content,
      provider: "none",
      model: `${result.provider ?? providerId}:${result.model}`,
      error: result.error,
      errorCode: result.errorCode,
      latencyMs: result.latencyMs,
    };
  };
}
