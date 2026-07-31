// LOGICAL STRATEGIST CONFIGURATION.
//
// The strategy owner never names a vendor or a concrete model. It asks for the
// "primary" or "escalation" slot and this module resolves it from environment
// configuration, so swapping providers/models is a config change, not a code
// change.
//
//   LEAD_STRATEGIST_PROVIDER          lovable_ai | openai   (default lovable_ai)
//   LEAD_STRATEGIST_PRIMARY_MODEL     default openai/gpt-5.6-luna
//   LEAD_STRATEGIST_ESCALATION_MODEL  default openai/gpt-5.6-terra
//   LEAD_STRATEGIST_TIMEOUT_MS        default 20000
//   LEAD_STRATEGIST_MAX_COMPLETION_TOKENS  default 1600

import type { StrategistProviderId, StrategistTier } from "./provider.ts";

export const DEFAULT_PRIMARY_MODEL = "openai/gpt-5.6-luna";
export const DEFAULT_ESCALATION_MODEL = "openai/gpt-5.6-terra";
export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_COMPLETION_TOKENS = 1600;

export const STRATEGIST_PROVIDER_IDS: readonly StrategistProviderId[] = ["lovable_ai", "openai"];

export interface LeadStrategistConfig {
  provider: StrategistProviderId;
  primaryModel: string;
  escalationModel: string;
  timeoutMs: number;
  maxCompletionTokens: number;
}

export type EnvReader = (key: string) => string | undefined;

const denoEnv: EnvReader = (key) => {
  try {
    return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(key);
  } catch {
    return undefined;
  }
};

function str(env: EnvReader, key: string, fallback: string): string {
  const v = env(key)?.trim();
  return v ? v : fallback;
}

function num(env: EnvReader, key: string, fallback: number): number {
  const v = Number(env(key)?.trim());
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export function normalizeProviderId(raw: string | undefined | null): StrategistProviderId {
  const v = (raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (v === "openai") return "openai";
  if (v === "lovable_ai" || v === "lovable" || v === "lovableai") return "lovable_ai";
  return "lovable_ai";
}

export function resolveLeadStrategistConfig(env: EnvReader = denoEnv): LeadStrategistConfig {
  return {
    provider: normalizeProviderId(env("LEAD_STRATEGIST_PROVIDER")),
    primaryModel: str(env, "LEAD_STRATEGIST_PRIMARY_MODEL", DEFAULT_PRIMARY_MODEL),
    escalationModel: str(env, "LEAD_STRATEGIST_ESCALATION_MODEL", DEFAULT_ESCALATION_MODEL),
    timeoutMs: num(env, "LEAD_STRATEGIST_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
    maxCompletionTokens: num(env, "LEAD_STRATEGIST_MAX_COMPLETION_TOKENS", DEFAULT_MAX_COMPLETION_TOKENS),
  };
}

export function modelForTier(tier: StrategistTier, cfg: LeadStrategistConfig): string {
  return tier === "escalation" ? cfg.escalationModel : cfg.primaryModel;
}

export function allowedModels(cfg: LeadStrategistConfig): readonly string[] {
  return cfg.primaryModel === cfg.escalationModel
    ? [cfg.primaryModel]
    : [cfg.primaryModel, cfg.escalationModel];
}
