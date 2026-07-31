// BACK-COMPAT SURFACE for the qualified-lead strategist.
//
// The real implementation now lives in `./leadStrategy/` and is fully
// provider-independent:
//
//   leadStrategy/provider.ts          canonical interface + result shape
//   leadStrategy/config.ts            LEAD_STRATEGIST_* logical configuration
//   leadStrategy/factory.ts           config → adapter
//   leadStrategy/adapters/shared.ts   one OpenAI-compatible transport
//   leadStrategy/adapters/lovableAi.ts
//   leadStrategy/adapters/openai.ts
//
// Policy, prompts, taxonomy, schemas, validation, escalation and the
// deterministic fallback are provider-independent and live outside all of them.
// This module keeps the historical names so existing imports keep working.

import {
  allowedModels, modelForTier as modelForTierCfg, resolveLeadStrategistConfig,
} from "./leadStrategy/config.ts";
import { createLeadStrategistProvider } from "./leadStrategy/factory.ts";
import { buildStrategistRequestBody } from "./leadStrategy/adapters/shared.ts";
import type {
  StrategistCall, StrategistCallFn, StrategistResult, StrategistTier,
} from "./leadStrategy/provider.ts";

const CONFIG = resolveLeadStrategistConfig();

/** Primary strategist slot (logical). Resolved from LEAD_STRATEGIST_PRIMARY_MODEL. */
export const LEAD_STRATEGY_PRIMARY_MODEL = CONFIG.primaryModel;
/** Single escalation slot (logical). Resolved from LEAD_STRATEGIST_ESCALATION_MODEL. */
export const LEAD_STRATEGY_ESCALATION_MODEL = CONFIG.escalationModel;
/** Every model this path may call under the active configuration. */
export const LEAD_STRATEGY_ALLOWED_MODELS: readonly string[] = allowedModels(CONFIG);
export const LEAD_STRATEGY_MAX_COMPLETION_TOKENS = CONFIG.maxCompletionTokens;
export const LEAD_STRATEGY_TIMEOUT_MS = CONFIG.timeoutMs;
export const LEAD_STRATEGY_PROVIDER = CONFIG.provider;

export type LeadStrategyModelTier = StrategistTier;
export type LeadStrategyModelCall = StrategistCall;
export type LeadStrategyModelResult = StrategistResult;
export type LeadStrategyModelFn = StrategistCallFn;

export function modelForTier(tier: LeadStrategyModelTier): string {
  return modelForTierCfg(tier, CONFIG);
}

export const buildLeadStrategyRequestBody = (call: LeadStrategyModelCall) =>
  buildStrategistRequestBody(call);

/** Provider-independent entry point: the configured adapter handles the call. */
export const callLeadStrategyModel: LeadStrategyModelFn = (call) =>
  createLeadStrategistProvider({ config: CONFIG }).provider.complete(call);

export { createLeadStrategistProvider, resolveLeadStrategistConfig };
