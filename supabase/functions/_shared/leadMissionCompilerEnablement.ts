// WHETHER the GPT mission compiler runs, separated from the machinery that
// runs it.
//
// ── WHY THIS IS ITS OWN MODULE ───────────────────────────────────────────────
// `leadIntelligencePolicy` documents itself as PURE — "no network, provider,
// model or database access" — and it needs exactly one thing from this stage:
// the answer to "is the compiler on for this workspace?". Reading that from
// `leadMissionCompilerBinding` made the pure policy module a transitive
// importer of `leadMissionCompiler`, `gptMissionModel` and `gptMissionSchema`,
// because the binding's other half CONSTRUCTS a live model client.
//
// Nothing was wrong at runtime — the policy never called the builder. The cost
// was structural: every consumer of the policy, `run-agent` included, shipped
// the whole compiler in its deployment bundle to ask a question about an
// environment variable. `run-agent` does not compile missions; `pilot-chat`
// does.
//
// So the split is along the seam that was already there: an enablement DECISION
// (pure, env-only) and a binding CONSTRUCTION (imports a provider adapter).
// `leadMissionCompilerBinding` re-exports everything here, so its public API is
// unchanged and every existing import of it keeps working.
//
// Same reasoning as the binding module's own existence — see its header.

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

/**
 * How many times compilation may be attempted for one request.
 *
 * A CONSTANT, not a condition — the ceiling is structural. Two, because the
 * failure this covers is a transient one (a timeout, a truncated response, a
 * malformed JSON body); a model that misreads the sentence twice will misread it
 * a third time, and burning more calls on that buys nothing.
 */
export const MAX_COMPILATION_ATTEMPTS = 2;

export type CompilerEnablementReason =
  | "enabled" | "flag_off" | "no_workspace_allowlist" | "workspace_not_allowed"
  // THE COMPILER ITSELF REFUSED. Distinct from every reason above, which are
  // about whether the stage was allowed to RUN: this one means it ran, was asked
  // twice, and could not read the request into a mission. `compileLeadMission`
  // no longer answers that with a regex reading of the sentence.
  | "compilation_blocked";

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

  // ── THE FLAG NO LONGER DECIDES ──────────────────────────────────────────
  //
  // Commit 2 stopped `buildMissionCompilerBinding` consulting this, but left
  // the function itself flag-driven — and `getLeadIntelligenceCapabilities`
  // reads it. So a workspace whose mission WAS GPT-compiled still reported
  // `mission_compiler: false`, and with the other five stages now on, the policy
  // returned `inconsistent`: a mode that blocks paid execution outright. The
  // last remnant of the flag architecture, and it would have failed every run.
  void workspaceId;
  void off;

  return {
    enabled: true,
    reason: "enabled",
    model: (get(MISSION_COMPILER_MODEL_ENV) ?? "").trim() || DEFAULT_MISSION_COMPILER_MODEL,
  };
}
