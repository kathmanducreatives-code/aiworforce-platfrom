// THE PRODUCTION EDGE FOR MULTI-ROUND SOURCING.
//
// A separate flag from Stage 1–3, because it is a separate risk: this one
// decides how many times a run may SPEND on discovery. Coupling it to the
// grounded Brain or the ranker would mean the first multi-round run and the
// first reordered Workbench arrive together with one rollback between them.
//
// SAFETY
//   * OFF by default; both a flag AND a workspace allow-list must pass.
//   * An empty allow-list enables nobody.
//   * Round count and budgets are resolved from the SERVER environment and
//     clamped. A misconfigured value can make a run smaller, never unbounded.
//   * The planner is a model call that returns a PROPOSAL. It authorises
//     nothing on its own; `validateRoundPlan` is what decides.
//
// Pure apart from the injected facade. No provider import, no network.

import { createStrategistGenerateJson } from "./leadStrategyFeedbackOwner.ts";
import type { GenerateJsonFn } from "./intelligence/plannerWrapper.ts";
import {
  buildRoundPlannerPayload, parseRoundPlan, ROUND_PLANNER_PROMPT,
  type RoundPlanProposal,
} from "./roundPlanContract.ts";
import { DEFAULT_MAX_ROUNDS } from "./multiRoundState.ts";

export type EnvReader = (key: string) => string | undefined;

export const MULTI_ROUND_FLAG = "MULTI_ROUND_SOURCING";
export const MULTI_ROUND_WORKSPACES_ENV = "MULTI_ROUND_SOURCING_WORKSPACES";
export const MULTI_ROUND_MAX_ROUNDS_ENV = "MULTI_ROUND_SOURCING_MAX_ROUNDS";
export const MULTI_ROUND_MAX_COST_ENV = "MULTI_ROUND_SOURCING_MAX_COST_UNITS";
export const MULTI_ROUND_MAX_MODEL_ENV = "MULTI_ROUND_SOURCING_MAX_MODEL_OPS";
export const MULTI_ROUND_MODEL_ENV = "MULTI_ROUND_SOURCING_MODEL";

export const DEFAULT_ROUND_MODEL = "gpt-5.6-luna";

/**
 * Ceilings a round controller may never exceed.
 *
 * Anchored to the provider ceiling the company-first controller already
 * enforces (`HARD_PROVIDER_CALL_CEILING = 12`), so multi-round sourcing cannot
 * quietly buy more provider calls than the single-round path was allowed.
 */
export const HARD_MAX_PROVIDER_COST_UNITS = 12;
export const HARD_MAX_MODEL_OPERATIONS = 24;

const ENABLED: ReadonlySet<string> = new Set(["true", "1", "enabled"]);

export type EnablementReason =
  | "enabled" | "flag_off" | "no_workspace_allowlist" | "workspace_not_allowed";

function gate(
  workspaceId: string, flag: string, listEnv: string, get: EnvReader,
): EnablementReason {
  const raw = get(flag);
  if (typeof raw !== "string" || !ENABLED.has(raw.trim().toLowerCase())) return "flag_off";
  const allow = String(get(listEnv) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allow.length === 0) return "no_workspace_allowlist";
  if (!allow.includes(String(workspaceId))) return "workspace_not_allowed";
  return "enabled";
}

export interface MultiRoundEnablement {
  enabled: boolean;
  reason: EnablementReason;
  maxRounds: number;
  maxProviderCostUnits: number;
  maxModelOperations: number;
  model: string | null;
}

/** Clamp into [1, hard], falling back to the hard ceiling on anything unusable. */
function clamp(raw: unknown, hard: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(1, Math.min(hard, Math.floor(n)));
}

export function isMultiRoundEnabled(
  workspaceId: string, read?: EnvReader,
): MultiRoundEnablement {
  const get: EnvReader = read ?? ((k) => {
    try { return Deno.env.get(k); } catch { return undefined; }
  });
  const reason = gate(workspaceId, MULTI_ROUND_FLAG, MULTI_ROUND_WORKSPACES_ENV, get);
  return {
    enabled: reason === "enabled",
    reason,
    maxRounds: clamp(get(MULTI_ROUND_MAX_ROUNDS_ENV), DEFAULT_MAX_ROUNDS, DEFAULT_MAX_ROUNDS),
    maxProviderCostUnits: clamp(
      get(MULTI_ROUND_MAX_COST_ENV), HARD_MAX_PROVIDER_COST_UNITS, HARD_MAX_PROVIDER_COST_UNITS),
    maxModelOperations: clamp(
      get(MULTI_ROUND_MAX_MODEL_ENV), HARD_MAX_MODEL_OPERATIONS, HARD_MAX_MODEL_OPERATIONS),
    model: reason === "enabled"
      ? ((get(MULTI_ROUND_MODEL_ENV) ?? "").trim() || DEFAULT_ROUND_MODEL)
      : null,
  };
}

export type PlanNextRoundFn = (
  payload: Parameters<typeof buildRoundPlannerPayload>[0],
) => Promise<RoundPlanProposal | null>;

export interface MultiRoundBinding {
  enabled: boolean;
  maxRounds: number;
  maxProviderCostUnits: number;
  maxModelOperations: number;
  /** Null when multi-round is off — the run stays single-round unchanged. */
  planNextRound: PlanNextRoundFn | null;
  plannerCallsAttempted: () => number;
  diagnostics: Record<string, unknown>;
}

export function buildMultiRoundBinding(input: {
  workspaceId: string;
  read?: EnvReader;
  generate?: GenerateJsonFn;
}): MultiRoundBinding {
  const e = isMultiRoundEnabled(input.workspaceId, input.read);
  let attempts = 0;

  const generate = input.generate ?? createStrategistGenerateJson({
    allowEscalation: false, model: e.model ?? DEFAULT_ROUND_MODEL,
  });

  return {
    enabled: e.enabled,
    maxRounds: e.maxRounds,
    maxProviderCostUnits: e.maxProviderCostUnits,
    maxModelOperations: e.maxModelOperations,
    plannerCallsAttempted: () => attempts,
    diagnostics: {
      enabled: e.enabled, reason: e.reason, max_rounds: e.maxRounds,
      max_provider_cost_units: e.maxProviderCostUnits,
      max_model_operations: e.maxModelOperations, model: e.model,
    },
    planNextRound: e.enabled
      ? async (payload) => {
        attempts++;
        try {
          const res = await generate({
            systemPrompt: ROUND_PLANNER_PROMPT,
            messages: [{
              role: "user",
              content: JSON.stringify(buildRoundPlannerPayload(payload)),
            }],
          } as never);
          const raw = (res as { ok?: boolean; json?: unknown })?.ok
            ? (res as { json?: unknown }).json : null;
          // A NULL PROPOSAL STOPS THE RUN. It never means "carry on with the
          // previous plan" — repeating a round that already fell short is the
          // one outcome guaranteed to spend without learning anything.
          return parseRoundPlan(raw);
        } catch {
          return null;
        }
      }
      : null,
  };
}
