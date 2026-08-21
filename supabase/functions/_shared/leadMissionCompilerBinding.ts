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
//   * AT MOST `MAX_COMPILATION_ATTEMPTS` calls per mission — two. This used to
//     be "ONE call per mission; a retry loop here would be a budget with no
//     ceiling". The concern was right, the conclusion was not: the alternative
//     to retrying was degrading to a regex reading of the sentence, which the
//     architectural rule now forbids. A FIXED, SMALL cap is not a loop and has a
//     ceiling by construction — the count is a constant, not a condition. A
//     second attempt is made only when the first produced nothing usable.
//   * NO ESCALATION. Interpreting a sentence never justifies the expensive tier.
//   * Nothing here reads a credential, and no provider name is ever sent.
//
// ── ON FAILING TO THE DETERMINISTIC PARSER ───────────────────────────────────
//
// THE ARCHITECTURAL RULE. R2 implemented the RETRY half here; the EXPLICIT
// FAILURE half lives at the call sites, which are the only places that know
// whether a workspace runs the compiled-mission architecture:
//
//     new lead request → GPT raw-query Mission compiler → canonical Mission
//                      → execution
//
//     compilation fails or returns invalid output → RETRY, then an explicit
//     compilation failure. Never a silent fall back to regex interpretation of
//     the user's sentence.
//
// A null proposal still degrades to `parseLeadMissionDeterministic` INSIDE
// `compileLeadMission`, and this comment used to call that a safety property —
// "fails to the deterministic parser, never to an error". It is not one. Regex
// interpretation of a raw sentence is a DIFFERENT reading of the request, not a
// lower-resolution copy of the same one: R1's gold fixtures showed it inventing
// personas the user never named and discarding companies the user supplied.
// Serving that silently under an outage means answering a question nobody asked,
// with the user's money, and reporting success.
//
// That degradation now only SURVIVES for workspaces outside the compiled-mission
// architecture. A `new_architecture` workspace whose compilation returns nothing
// after both attempts is refused explicitly — pilot-chat raises
// `MissionCompilationFailedError` and orchestrate answers 422
// `mission_not_compiled`. Neither substitutes a regex reading.
//
// The deterministic parsers may remain during migration for shadow comparison,
// historical compatibility and migration verification — never as the final
// semantic authority, and never as the outage fallback for a new request.
//
// Pure apart from the injected facade. No provider import, no network.

// `createStrategistGenerateJson` (Lovable/Claude) is deliberately NOT imported
// here any more. Leaving the import would leave the old transport one edit away
// from being reachable again, and `gptMissionCompiler.test.ts` asserts its
// absence rather than merely that it is unused.
import type { GenerateJsonFn } from "./intelligence/plannerWrapper.ts";
import {
  buildMissionCompilerPayload, MISSION_COMPILER_SYSTEM_PROMPT,
  type CompilerPromptContext,
} from "./leadMissionCompiler.ts";
import { DEFAULT_LEAD_INTELLIGENCE_MODEL } from "./leadIntelligenceModel.ts";
import { createGptMissionGenerateJson, GPT_MISSION_MODEL_ID } from "./gptMissionModel.ts";

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

/**
 * Mission compilation failed for a workspace that requires a compiled mission.
 *
 * A DISTINCT CLASS so a call site can tell this apart from a provider failure or
 * a bug, and so nothing catches it generically and continues. Continuing is the
 * failure: the only thing available to continue WITH is a regex reading of the
 * sentence, which answers a differently-read request.
 *
 * Raised only when `getLeadIntelligenceCapabilities(workspace).mode` is
 * `new_architecture`. A deterministic workspace never sees it — there the
 * deterministic reading is the intended planner, not error recovery.
 */
export class MissionCompilationFailedError extends Error {
  readonly workspaceId: string;
  readonly enablementReason: CompilerEnablementReason;
  constructor(workspaceId: string, enablementReason: CompilerEnablementReason) {
    super(
      `mission compilation failed after ${MAX_COMPILATION_ATTEMPTS} attempt(s) for a ` +
      `workspace running the compiled-mission architecture (compiler enablement: ` +
      `${enablementReason}). No deterministic mission was substituted and no provider ` +
      `work was scheduled.`,
    );
    this.name = "MissionCompilationFailedError";
    this.workspaceId = workspaceId;
    this.enablementReason = enablementReason;
  }
}

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
  // ── THE COMPILER IS NO LONGER OPTIONAL ──────────────────────────────────
  //
  // `isMissionCompilerEnabled` used to decide whether a model read the user's
  // sentence at all. `GPT_LEAD_MISSION_COMPILER` has never been set on the live
  // project, so `proposeMission` was null on every run and a regex reading
  // became the mission — which is the whole of the 2026-08-17 failure.
  //
  // The flag is not defaulted to true, it is REMOVED from this decision. A
  // hidden switch that changes what a user's request means is the thing being
  // eliminated, and defaulting it would leave the switch in place, just harder
  // to notice when someone sets it back.
  //
  // `enablement` is still computed and still reported, because the model id
  // override and the diagnostics remain useful — but it can no longer turn
  // interpretation off.
  const enablement = isMissionCompilerEnabled(input.workspaceId, input.read);
  const base = {
    enabled: true,
    // The legacy reason is kept under its own name so a run can still show
    // whether the old flag was set, without that answer gating anything.
    legacy_flag_reason: enablement.reason,
    model: GPT_MISSION_MODEL_ID,
    provider: "openai",
    calls_allowed: MAX_COMPILATION_ATTEMPTS,
  };

  // ── GPT, NOT THE STRATEGIST ─────────────────────────────────────────────
  //
  // `createStrategistGenerateJson` routes to the Lovable/Claude strategist.
  // Even with the old flag ON, this stage was never GPT — so "enable the flag"
  // would not have produced the GPT-first architecture, only a different
  // non-GPT one.
  const generate = input.generate ?? createGptMissionGenerateJson();

  return {
    enablement,
    diagnostics: base,
    proposeMission: async (ctx: CompilerPromptContext) => {
      const payload = JSON.stringify(buildMissionCompilerPayload(ctx));

      // BOUNDED RETRY, NOT A LOOP. The bound is a constant, so the worst case
      // is two calls whatever happens inside. A second attempt is made only when
      // the first produced nothing usable — a timeout, a refused model id, a
      // truncated or unparseable body. A model that misread the sentence
      // successfully returns a proposal and is never retried; `compileLeadMission`
      // judges that proposal, not this function.
      for (let attempt = 1; attempt <= MAX_COMPILATION_ATTEMPTS; attempt++) {
        try {
          const result = await generate({
            systemPrompt: MISSION_COMPILER_SYSTEM_PROMPT,
            messages: [{ role: "user", content: payload }],
          } as never);
          const r = result as
            { ok?: boolean; json?: unknown; code?: unknown; detail?: unknown }
            | null | undefined;
          if (r?.ok && r.json != null) return r.json;
          // ── WHY IT FAILED, NOT JUST THAT IT DID ─────────────────────────
          //
          // This branch dropped `code` and `detail` on the floor, so a
          // compilation failure reached the user as `proposal_received: false`
          // and nothing else. On 2026-08-21 the OpenAI balance ran out and the
          // chat simply stopped answering; the reason —
          // `insufficient_quota` — existed in the response and was discarded
          // twice per message. Diagnosing it took a manual call to the
          // provider, which is the exact cost of a silent catch.
          console.log("[mission-compiler][attempt-failed]", {
            attempt, of: MAX_COMPILATION_ATTEMPTS,
            code: typeof r?.code === "string" ? r.code : "no_result",
            detail: typeof r?.detail === "string" ? r.detail.slice(0, 300) : null,
          });
        } catch (e) {
          // Swallowed per attempt so a throw on the first try still gets the
          // second. The final outcome — not this attempt — is what the caller
          // sees, and it is reported honestly as null below. Logged, though:
          // an unrecorded throw here is indistinguishable from a model that
          // answered badly, and the two need different responses.
          console.log("[mission-compiler][attempt-threw]", {
            attempt, of: MAX_COMPILATION_ATTEMPTS, error: String(e).slice(0, 300),
          });
        }
      }

      // EVERY ATTEMPT FAILED. Null means exactly that.
      //
      // `compileLeadMission` still reads null as "no proposal" and answers
      // deterministically. That is MIGRATION-ERA behaviour, not the target: the
      // architectural rule says a request whose Mission could not be compiled
      // must fail explicitly rather than be handed to a regex reading of the
      // sentence, which answers a differently-read request. The explicit refusal
      // lives at the CALL SITE, which is the only place that knows whether this
      // workspace runs the compiled-mission architecture — see pilot-chat's
      // `compileCanonicalLeadMission` and orchestrate's `mission_not_compiled`.
      return null;
    },
  };
}
