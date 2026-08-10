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
//   * Nothing here reads a credential, and no provider name is ever sent.
//
// ── ON FAILING TO THE DETERMINISTIC PARSER ───────────────────────────────────
//
// THE ARCHITECTURAL RULE, which this module does not yet implement:
//
//     new lead request → GPT raw-query Mission compiler → canonical Mission
//                      → execution
//
//     compilation fails or returns invalid output → RETRY, then an explicit
//     compilation failure. Never a silent fall back to regex interpretation of
//     the user's sentence.
//
// Today a null proposal degrades to `parseLeadMissionDeterministic`, and this
// comment used to call that a safety property — "fails to the deterministic
// parser, never to an error". It is not one. Regex interpretation of a raw
// sentence is a DIFFERENT reading of the request, not a lower-resolution copy of
// the same one: R1's gold fixtures showed it inventing personas the user never
// named and discarding companies the user supplied. Serving that silently under
// an outage means answering a question nobody asked, with the user's money, and
// reporting success.
//
// So the current degradation is MIGRATION-ERA BEHAVIOUR, kept only because the
// compiler is off by default and nothing else answers yet. It is not the target
// and must not be defended as one. The deterministic parsers may remain during
// migration for shadow comparison, historical compatibility and migration
// verification — never as the final semantic authority, and never as the outage
// fallback for a new request.
//
// Replacing it with retry-then-explicit-failure is R2's job. Nothing in this
// commit changes behaviour.
//
// Pure apart from the injected facade. No provider import, no network.

import { createStrategistGenerateJson } from "./leadStrategyFeedbackOwner.ts";
import type { GenerateJsonFn } from "./intelligence/plannerWrapper.ts";
import {
  buildMissionCompilerPayload, MISSION_COMPILER_SYSTEM_PROMPT,
  type CompilerPromptContext,
} from "./leadMissionCompiler.ts";
import { DEFAULT_LEAD_INTELLIGENCE_MODEL } from "./leadIntelligenceModel.ts";

export type EnvReader = (key: string) => string | undefined;

export const MISSION_COMPILER_FLAG = "GPT_LEAD_MISSION_COMPILER";
export const MISSION_COMPILER_WORKSPACES_ENV = "GPT_LEAD_MISSION_COMPILER_WORKSPACES";
export const MISSION_COMPILER_MODEL_ENV = "GPT_LEAD_MISSION_COMPILER_MODEL";

/**
 * The chosen compiler. Overridable by env, never by user or model input.
 *
 * Canonical by construction — see `leadIntelligenceModel.ts`. Do NOT replace
 * this with a literal: an unprefixed id is the OpenAI *wire* form, and the
 * adapter rejects it with `model_not_allowed` before the request is ever sent,
 * which `proposeMission` reports as "no proposal". That is precisely how this
 * compiler silently never ran.
 */
export const DEFAULT_MISSION_COMPILER_MODEL: string = DEFAULT_LEAD_INTELLIGENCE_MODEL;

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
        // The facade reports failure in-band. `compileLeadMission` reads a null
        // as "no proposal" and the deterministic parser answers.
        //
        // MIGRATION-ERA, NOT THE TARGET — see the doctrine block at the top of
        // this file. Under the architectural rule a failed compilation must
        // retry and then fail explicitly; it must not hand the request to a
        // different, regex-derived reading of the sentence. R2 replaces this.
        return (result as { ok?: boolean; json?: unknown })?.ok
          ? (result as { json?: unknown }).json
          : null;
      } catch {
        // A throw is reported as "no proposal" for the same migration-era reason
        // as above. "Interpreting the query is an enhancement; the run is
        // perfectly capable without it" was the old justification and it is
        // wrong: without the interpretation the run answers a differently-read
        // request. Retry-then-explicit-failure replaces this in R2.
        return null;
      }
    },
  };
}
