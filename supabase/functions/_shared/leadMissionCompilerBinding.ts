// THE PRODUCTION EDGE FOR GPT MISSION COMPILATION.
//
// `leadMissionCompiler` is pure: it builds a payload and reads a proposal. This
// module is the only place that decides whether a model runs at all, which one,
// and how many times.
//
// ── WHY A SEPARATE MODULE ────────────────────────────────────────────────────
// The same reason `semanticClassificationBinding` is one: `run-agent` is capped
// at TWO kernel imports by `intelligenceFlags` test 32.E, and pilot-chat should
// not grow a strategist import either. The facade is assembled here.
//
// ── SAFETY ───────────────────────────────────────────────────────────────────
//   * OFF by default. BOTH a flag AND a workspace allow-list must pass, and an
//     empty allow-list enables nobody — there is no global switch.
//   * ONE call per mission. Compilation is a single interpretive act; a retry
//     loop here would be a budget with no ceiling.
//   * NO ESCALATION. Interpreting a sentence never justifies the expensive tier.
//   * FAILS TO THE DETERMINISTIC PARSER, never to an error. A model that is
//     down, slow or wrong must cost the user nothing but a less precise mission.
//   * Nothing here reads a credential, and no provider name is ever sent.
//
// Pure apart from the injected facade. No provider import, no network.

import { createStrategistGenerateJson } from "./leadStrategyFeedbackOwner.ts";
import type { GenerateJsonFn } from "./intelligence/plannerWrapper.ts";
import {
  buildMissionCompilerPayload, MISSION_COMPILER_SYSTEM_PROMPT,
  type CompilerPromptContext,
} from "./leadMissionCompiler.ts";

export type EnvReader = (key: string) => string | undefined;

export const MISSION_COMPILER_FLAG = "GPT_LEAD_MISSION_COMPILER";
export const MISSION_COMPILER_WORKSPACES_ENV = "GPT_LEAD_MISSION_COMPILER_WORKSPACES";
export const MISSION_COMPILER_MODEL_ENV = "GPT_LEAD_MISSION_COMPILER_MODEL";

/**
 * The chosen compiler. Overridable by env, never by user or model input.
 *
 * MUST be a CANONICAL id (vendor-prefixed), because that is what the strategist
 * adapter's allow-list is built from — `allowedModels()` reads the configured
 * `LEAD_STRATEGIST_*` models, which are canonical. An unprefixed id is the
 * OpenAI *wire* form; the adapter rejects it with `model_not_allowed` before
 * the request is ever sent, and `proposeMission` reports that as "no proposal".
 * The result is a compiler that silently never runs. Keep this prefixed.
 */
export const DEFAULT_MISSION_COMPILER_MODEL = "openai/gpt-5.6-luna";

const ENABLED_VALUES: ReadonlySet<string> = new Set(["true", "1", "enabled"]);

export type CompilerEnablementReason =
  | "enabled" | "flag_off" | "no_workspace_allowlist" | "workspace_not_allowed";

export interface CompilerEnablement {
  enabled: boolean;
  reason: CompilerEnablementReason;
  model: string | null;
}

/**
 * May this workspace have its query interpreted by a model?
 *
 * Never throws. A missing env permission resolves to OFF, because a compiler
 * that fails open is one that changes how money is spent without being asked.
 */
export function isMissionCompilerEnabled(
  workspaceId: string, read?: EnvReader,
): CompilerEnablement {
  const get: EnvReader = read ?? ((k) => {
    try { return Deno.env.get(k); } catch { return undefined; }
  });
  const off = (reason: CompilerEnablementReason): CompilerEnablement =>
    ({ enabled: false, reason, model: null });

  const raw = get(MISSION_COMPILER_FLAG);
  if (typeof raw !== "string" || !ENABLED_VALUES.has(raw.trim().toLowerCase())) {
    return off("flag_off");
  }
  const allow = String(get(MISSION_COMPILER_WORKSPACES_ENV) ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (allow.length === 0) return off("no_workspace_allowlist");
  if (!allow.includes(String(workspaceId))) return off("workspace_not_allowed");

  return {
    enabled: true,
    reason: "enabled",
    model: (get(MISSION_COMPILER_MODEL_ENV) ?? "").trim() || DEFAULT_MISSION_COMPILER_MODEL,
  };
}

export interface MissionCompilerBinding {
  /** Null when disabled — the caller then uses the deterministic parser. */
  proposeMission: ((ctx: CompilerPromptContext) => Promise<unknown>) | null;
  enablement: CompilerEnablement;
  /** Safe task diagnostics. Never a prompt, credential or model output. */
  diagnostics: Record<string, unknown>;
}

export function buildMissionCompilerBinding(input: {
  workspaceId: string;
  read?: EnvReader;
  /** Injected in tests. Production uses the configured strategist adapter. */
  generate?: GenerateJsonFn;
}): MissionCompilerBinding {
  const enablement = isMissionCompilerEnabled(input.workspaceId, input.read);
  const base = {
    enabled: enablement.enabled,
    reason: enablement.reason,
    model: enablement.model,
    calls_allowed: enablement.enabled ? 1 : 0,
  };

  if (!enablement.enabled) {
    return { proposeMission: null, enablement, diagnostics: base };
  }

  const generate = input.generate ?? createStrategistGenerateJson({
    allowEscalation: false,
    model: enablement.model ?? DEFAULT_MISSION_COMPILER_MODEL,
  });

  return {
    enablement,
    diagnostics: base,
    proposeMission: async (ctx: CompilerPromptContext) => {
      try {
        const result = await generate({
          systemPrompt: MISSION_COMPILER_SYSTEM_PROMPT,
          messages: [{
            role: "user",
            content: JSON.stringify(buildMissionCompilerPayload(ctx)),
          }],
        } as never);
        // The facade reports failure in-band. A null here is a SAFE outcome:
        // `compileLeadMission` reads it as "no proposal" and the deterministic
        // parser answers, which is exactly the intended degradation.
        return (result as { ok?: boolean; json?: unknown })?.ok
          ? (result as { json?: unknown }).json
          : null;
      } catch {
        // A THROW MUST NOT COST A WORKFLOW. Interpreting the query is an
        // enhancement; the run is still perfectly capable without it.
        return null;
      }
    },
  };
}
