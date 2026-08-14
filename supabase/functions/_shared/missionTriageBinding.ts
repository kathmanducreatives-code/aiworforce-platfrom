// THE PRODUCTION EDGE FOR MISSION TRIAGE.
//
// Same shape as `missionEvaluationBinding` and `semanticClassificationBinding`,
// deliberately: one pattern for "a model call the pipeline may make", so there
// is one place to look for whether a stage is live and one place it can be
// switched off.
//
// ── SAFETY ───────────────────────────────────────────────────────────────────
//   * OFF by default. BOTH the flag AND the workspace allow-list must pass; an
//     empty allow-list enables nobody, so there is no single global switch.
//   * NO ESCALATION. Triage is a cheap, high-volume pass and never justifies the
//     escalation tier.
//   * BOUNDED BY BATCHES, not by companies. A hundred candidates cost four calls.
//   * DISABLED IS NOT EXCLUDED. With the flag off no call is made and every
//     company keeps the deterministic prequalification verdict it already had —
//     the previous behaviour exactly, not a pool of silent rejections.
//   * A FAILED BATCH IS UNCERTAIN, NEVER IRRELEVANT. Nothing a model failure
//     does may remove a company from the run.
//
// Pure apart from the injected facade. No provider import, no network.

import { createStrategistGenerateJson } from "./leadStrategyFeedbackOwner.ts";
import type { GenerateJsonFn } from "./intelligence/plannerWrapper.ts";
import { DEFAULT_LEAD_INTELLIGENCE_MODEL } from "./leadIntelligenceModel.ts";
import { MISSION_TRIAGE_PROMPT, TRIAGE_BATCH_SIZE } from "./missionTriage.ts";

export type EnvReader = (key: string) => string | undefined;

export const MISSION_TRIAGE_FLAG = "MISSION_TRIAGE";
export const MISSION_TRIAGE_WORKSPACES_ENV = "MISSION_TRIAGE_WORKSPACES";
export const MISSION_TRIAGE_MODEL_ENV = "MISSION_TRIAGE_MODEL";
export const MISSION_TRIAGE_MAX_BATCHES_ENV = "MISSION_TRIAGE_MAX_BATCHES";

export const DEFAULT_TRIAGE_MODEL: string = DEFAULT_LEAD_INTELLIGENCE_MODEL;

/**
 * Batches one task may pay for.
 *
 * SIX, which at 25 companies per batch covers 150 candidates — comfortably more
 * than discovery returns. The cap exists so a pathological pool cannot turn a
 * cheap stage into an expensive one.
 */
export const DEFAULT_MAX_TRIAGE_BATCHES = 6;

const ENABLED_VALUES: ReadonlySet<string> = new Set(["true", "1", "enabled"]);

export type TriageEnablementReason =
  | "enabled" | "flag_off" | "no_workspace_allowlist" | "workspace_not_allowed";

export interface TriageEnablement {
  enabled: boolean;
  reason: TriageEnablementReason;
  model: string | null;
  maxBatches: number;
}

/** BOTH conditions, no wildcard. Never throws: a missing env resolves to OFF. */
export function isMissionTriageEnabled(
  workspaceId: string, read?: EnvReader,
): TriageEnablement {
  const get: EnvReader = read ?? ((k) => {
    try { return Deno.env.get(k); } catch { return undefined; }
  });
  const off = (reason: TriageEnablementReason): TriageEnablement =>
    ({ enabled: false, reason, model: null, maxBatches: 0 });

  const raw = get(MISSION_TRIAGE_FLAG);
  if (typeof raw !== "string" || !ENABLED_VALUES.has(raw.trim().toLowerCase())) {
    return off("flag_off");
  }
  const allow = String(get(MISSION_TRIAGE_WORKSPACES_ENV) ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (allow.length === 0) return off("no_workspace_allowlist");
  if (!allow.includes(String(workspaceId))) return off("workspace_not_allowed");

  const parsed = Number(get(MISSION_TRIAGE_MAX_BATCHES_ENV));
  return {
    enabled: true,
    reason: "enabled",
    model: (get(MISSION_TRIAGE_MODEL_ENV) ?? "").trim() || DEFAULT_TRIAGE_MODEL,
    // The env may LOWER the cap, never raise it.
    maxBatches: Number.isFinite(parsed) && parsed > 0
      ? Math.min(Math.floor(parsed), DEFAULT_MAX_TRIAGE_BATCHES)
      : DEFAULT_MAX_TRIAGE_BATCHES,
  };
}

export interface MissionTriageBinding {
  /** Null when disabled — the pipeline then makes no model call at all. */
  triageCompanies: ((payload: Record<string, unknown>) => Promise<unknown>) | null;
  batchesRemaining: number;
  batchSize: number;
  enablement: TriageEnablement;
  diagnostics: Record<string, unknown>;
}

export interface BuildTriageBindingInput {
  workspaceId: string;
  read?: EnvReader;
  /** Injected in tests. Production uses the configured strategist adapter. */
  generate?: GenerateJsonFn;
  /** Candidates expected, so the batch allowance is never larger than the work. */
  poolSize?: number;
}

export function buildMissionTriageBinding(
  input: BuildTriageBindingInput,
): MissionTriageBinding {
  const enablement = isMissionTriageEnabled(input.workspaceId, input.read);
  const pool = Math.max(0, Math.trunc(input.poolSize ?? 0));
  const needed = pool > 0 ? Math.ceil(pool / TRIAGE_BATCH_SIZE) : enablement.maxBatches;
  const batches = Math.min(enablement.maxBatches, needed);

  const base = {
    enabled: enablement.enabled,
    reason: enablement.reason,
    model: enablement.model,
    batches_allowed: enablement.enabled ? batches : 0,
    batch_size: TRIAGE_BATCH_SIZE,
    pool_size: pool,
    cap: DEFAULT_MAX_TRIAGE_BATCHES,
  };

  if (!enablement.enabled) {
    return {
      triageCompanies: null,
      batchesRemaining: 0,
      batchSize: TRIAGE_BATCH_SIZE,
      enablement,
      diagnostics: { ...base, skip_reason: enablement.reason },
    };
  }

  const generate = input.generate ?? createStrategistGenerateJson({
    allowEscalation: false,
    model: enablement.model ?? DEFAULT_TRIAGE_MODEL,
  });

  return {
    triageCompanies: async (payload: Record<string, unknown>) => {
      const result = await generate({
        systemPrompt: MISSION_TRIAGE_PROMPT,
        messages: [{ role: "user", content: JSON.stringify(payload) }],
      } as never);
      // Failure is reported in-band; the strict parser turns anything unusable
      // into UNCERTAIN for the whole batch, which is safe.
      return (result as { ok?: boolean; json?: unknown })?.ok
        ? (result as { json?: unknown }).json
        : null;
    },
    batchesRemaining: batches,
    batchSize: TRIAGE_BATCH_SIZE,
    enablement,
    diagnostics: base,
  };
}

export interface TriageCounters {
  batches_made?: number;
  companies_triaged?: number;
  relevant?: number;
  uncertain?: number;
  irrelevant?: number;
}

/** Task-level diagnostics: what was allowed, and what actually happened. */
export function triageTaskDiagnostics(
  binding: MissionTriageBinding,
  observed: TriageCounters | null | undefined,
): Record<string, unknown> {
  return {
    ...binding.diagnostics,
    batches_made: Number(observed?.batches_made ?? 0),
    companies_triaged: Number(observed?.companies_triaged ?? 0),
    relevant: Number(observed?.relevant ?? 0),
    uncertain: Number(observed?.uncertain ?? 0),
    irrelevant: Number(observed?.irrelevant ?? 0),
  };
}
