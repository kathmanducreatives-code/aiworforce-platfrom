// THE PROVIDER-INDEPENDENT STRATEGIST FACADE.
//
// This is the ONLY surface the qualified-lead runtime is allowed to depend on.
// It exposes exactly two questions:
//
//     createInitialStrategy(request)  -> canonical plan
//     chooseNextAction(request)       -> canonical single next action
//
// Everything that makes the answer trustworthy — the canonical policy, the one
// prompt builder, validation, one-shot escalation, the deterministic fallback
// and the observability record — lives on THIS side of the seam and is byte
// identical for every provider. An adapter only knows how to post a
// system+user message to a model and hand back parsed JSON.
//
// Consequence: swapping Lovable AI for direct OpenAI (or anything added later)
// is a configuration change. No runtime file below imports an adapter.

import {
  adaptiveActionFor, LEAD_FEEDBACK_ACTIONS, LEAD_FEEDBACK_POLICY_VERSION,
  type FeedbackObservationSignals, type LeadFeedbackAction,
} from "../leadStrategyFeedbackOwner.ts";
import { runLeadStrategy, type LeadStrategyResolution } from "../leadStrategyOwner.ts";
import type {
  LeadStrategyMission, LeadStrategyRoundContext,
} from "../leadStrategyContract.ts";
import { resolveLeadStrategistConfig, modelForTier, type LeadStrategistConfig } from "./config.ts";
import { createLeadStrategistProvider } from "./factory.ts";
import {
  LEAD_STRATEGIST_POLICY_VERSION, LEAD_STRATEGIST_PROMPT_SCHEMA_VERSION,
  buildStrategistUserMessage, promptHash, strategistSystemPrompt,
  type ActorCapabilityCard, type StrategistBrainContext, type StrategistContextInput,
} from "./policy.ts";
import {
  buildStrategistObservability, emitStrategistObservability,
  type StrategistObservabilityRecord, type StrategistObservabilitySink,
} from "./observability.ts";
import {
  providerToCallFn, type QualifiedLeadStrategistProvider, type StrategistCallFn,
} from "./provider.ts";

// ------------------------------------------------------------- requests -----

export interface QualifiedLeadStrategyRequest {
  mission: LeadStrategyMission;
  context: LeadStrategyRoundContext;
  brain?: StrategistBrainContext;
  actorCapabilityCards?: ActorCapabilityCard[];
  providerLimitations?: string[];
  workspaceId?: string | null;
  taskId?: string | null;
  /** FALSE keeps the resolution fully deterministic and makes zero requests. */
  enabled?: boolean;
}

export interface QualifiedLeadFeedbackRequest extends QualifiedLeadStrategyRequest {
  signals: FeedbackObservationSignals;
  allowedActions?: readonly LeadFeedbackAction[];
  sourceObservation?: Record<string, unknown> | null;
}

// ------------------------------------------------------------ responses -----

export interface CanonicalStrategyResponse extends LeadStrategyResolution {
  observability: StrategistObservabilityRecord;
}

export type NextActionAuthority = "model_primary" | "model_escalation" | "deterministic";

export interface CanonicalNextActionResponse {
  action: LeadFeedbackAction;
  reason: string;
  authority: NextActionAuthority;
  observability: StrategistObservabilityRecord;
}

export interface QualifiedLeadStrategist {
  readonly providerId: string;
  createInitialStrategy(request: QualifiedLeadStrategyRequest): Promise<CanonicalStrategyResponse>;
  chooseNextAction(request: QualifiedLeadFeedbackRequest): Promise<CanonicalNextActionResponse>;
}

export interface StrategistFacadeOptions {
  /** Explicit adapter. Defaults to the configured one — tests inject stubs. */
  provider?: QualifiedLeadStrategistProvider;
  /** Lowest-level seam; wins over `provider`. */
  callModel?: StrategistCallFn;
  config?: LeadStrategistConfig;
  observability?: StrategistObservabilitySink;
  allowEscalation?: boolean;
  timeoutMs?: number;
}

const emptyBrain: StrategistBrainContext = {};

function contextInput(
  req: QualifiedLeadFeedbackRequest,
  purpose: "initial_strategy" | "next_action",
  allowedActions: readonly string[],
  outputSchema: Record<string, unknown>,
): StrategistContextInput {
  return {
    purpose,
    user_query: req.mission.original_query,
    brain: req.brain ?? emptyBrain,
    requested_contact_quota: req.mission.requested_lead_count,
    hiring_role_intent: req.mission.requested_titles,
    decision_maker_roles: req.mission.decision_maker_roles,
    geography: req.mission.geography,
    recency_days: null,
    actor_capability_cards: req.actorCapabilityCards ?? [],
    provider_limitations: req.providerLimitations ?? [],
    remaining_budget: { actions: req.context.remaining_quota, usd: req.context.remaining_budget_usd },
    completed_query_packs: req.context.attempted_query_packs,
    completed_sources: req.context.attempted_sources,
    source_observation: req.sourceObservation ?? null,
    allowed_actions: [...allowedActions],
    output_schema: outputSchema,
  };
}

const NEXT_ACTION_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    action: { type: "string" },
    reason: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["action", "reason"],
};

export function createQualifiedLeadStrategist(
  opts: StrategistFacadeOptions = {},
): QualifiedLeadStrategist {
  const config = opts.config ?? resolveLeadStrategistConfig();
  const adapter = opts.provider
    ?? createLeadStrategistProvider({ config }).provider;
  const call: StrategistCallFn = opts.callModel ?? providerToCallFn(adapter);
  const providerId = opts.provider?.id ?? config.provider;
  const timeoutMs = opts.timeoutMs ?? config.timeoutMs;

  async function createInitialStrategy(
    req: QualifiedLeadStrategyRequest,
  ): Promise<CanonicalStrategyResponse> {
    const resolution = await runLeadStrategy({
      mission: req.mission,
      context: req.context,
      callModel: call,
      enabled: req.enabled,
      allowEscalation: opts.allowEscalation,
      timeoutMs,
      workspaceId: req.workspaceId ?? undefined,
    });

    const p = resolution.provenance;
    const system = strategistSystemPrompt("initial_strategy");
    const user = buildStrategistUserMessage(
      contextInput(req as QualifiedLeadFeedbackRequest, "initial_strategy", [], {}),
    );
    const observability = buildStrategistObservability({
      purpose: "initial_strategy",
      policyVersion: LEAD_STRATEGIST_POLICY_VERSION,
      promptSchemaVersion: LEAD_STRATEGIST_PROMPT_SCHEMA_VERSION,
      promptHash: promptHash(system, user),
      provider: p.provider ?? providerId,
      model: p.model,
      escalated: p.escalated,
      modelRequests: p.model_requests,
      latencyMs: p.latency_ms,
      outcome: p.source === "openai_escalation"
        ? "model_escalation_approved"
        : p.source === "openai_primary"
        ? "model_primary_approved"
        : "deterministic_fallback",
      status: p.status,
      failureReason: p.failure_reason,
      workspaceId: req.workspaceId ?? null,
      taskId: req.taskId ?? null,
      round: req.context.round,
      usage: p.usage,
    });
    emitStrategistObservability(observability, opts.observability);
    return { ...resolution, observability };
  }

  async function chooseNextAction(
    req: QualifiedLeadFeedbackRequest,
  ): Promise<CanonicalNextActionResponse> {
    const allowed = req.allowedActions ?? LEAD_FEEDBACK_ACTIONS;
    const deterministic = adaptiveActionFor(req.signals);
    const system = strategistSystemPrompt("next_action");
    const user = buildStrategistUserMessage(
      contextInput(req, "next_action", allowed, NEXT_ACTION_SCHEMA),
    );
    const hash = promptHash(system, user);

    const finish = (
      action: LeadFeedbackAction,
      reason: string,
      authority: NextActionAuthority,
      meta: {
        model: string | null; escalated: boolean; requests: number; latency: number;
        status: string; failure: string | null; usage?: unknown; provider?: string | null;
      },
    ): CanonicalNextActionResponse => {
      const observability = buildStrategistObservability({
        purpose: "next_action",
        policyVersion: `${LEAD_STRATEGIST_POLICY_VERSION}+${LEAD_FEEDBACK_POLICY_VERSION}`,
        promptSchemaVersion: LEAD_STRATEGIST_PROMPT_SCHEMA_VERSION,
        promptHash: hash,
        provider: meta.provider ?? providerId,
        model: meta.model,
        escalated: meta.escalated,
        modelRequests: meta.requests,
        latencyMs: meta.latency,
        outcome: authority === "model_escalation"
          ? "model_escalation_approved"
          : authority === "model_primary"
          ? "model_primary_approved"
          : "deterministic_fallback",
        status: meta.status,
        failureReason: meta.failure,
        workspaceId: req.workspaceId ?? null,
        taskId: req.taskId ?? null,
        round: req.context.round,
        usage: meta.usage,
      });
      emitStrategistObservability(observability, opts.observability);
      return { action, reason, authority, observability };
    };

    if (req.enabled === false) {
      return finish(deterministic.action, deterministic.reason, "deterministic", {
        model: null, escalated: false, requests: 0, latency: 0,
        status: "deterministic_only", failure: "disabled",
      });
    }

    const tiers: Array<"primary" | "escalation"> = opts.allowEscalation === false
      ? ["primary"]
      : ["primary", "escalation"];
    let requests = 0;
    let latency = 0;
    let lastModel: string | null = null;
    let lastProvider: string | null = null;
    let lastReason = "no_attempt";
    let usage: unknown;

    for (const tier of tiers) {
      const model = modelForTier(tier, config);
      lastModel = model;
      requests += 1;
      let result;
      try {
        result = await call({ model, systemPrompt: system, userMessage: user, timeoutMs });
      } catch (e) {
        lastReason = `call_threw:${String((e as Error)?.message ?? e).slice(0, 80)}`;
        continue;
      }
      latency += result.latencyMs ?? 0;
      usage = result.usage ?? usage;
      lastProvider = result.provider ?? providerId;
      if (!result.ok) {
        lastReason = result.errorCode ?? result.error ?? "model_call_failed";
        continue;
      }
      const parsed = (result.json ?? {}) as Record<string, unknown>;
      const action = typeof parsed.action === "string" ? parsed.action.trim() : "";
      if (!(allowed as readonly string[]).includes(action)) {
        lastReason = `rejected:action_not_allowed:${action || "missing"}`;
        continue;
      }
      const reason = typeof parsed.reason === "string"
        ? parsed.reason.replace(/\s+/g, " ").trim().slice(0, 240)
        : "";
      return finish(
        action as LeadFeedbackAction,
        reason || "strategist_selected",
        tier === "escalation" ? "model_escalation" : "model_primary",
        {
          model, escalated: tier === "escalation", requests, latency,
          status: tier === "escalation" ? "model_escalation_approved" : "model_primary_approved",
          failure: null, usage, provider: lastProvider,
        },
      );
    }

    return finish(deterministic.action, deterministic.reason, "deterministic", {
      model: lastModel, escalated: tiers.length > 1, requests, latency,
      status: "model_fallback_used", failure: lastReason, usage, provider: lastProvider,
    });
  }

  return { providerId, createInitialStrategy, chooseNextAction };
}
