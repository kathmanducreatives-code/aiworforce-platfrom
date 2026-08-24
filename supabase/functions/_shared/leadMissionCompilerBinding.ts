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
import type { GptDeps } from "./gptProvider.ts";
import {
  isUnrecoverableModelFailure, type ModelFailure, readModelFailure,
} from "./modelFailureContract.ts";


// The ENABLEMENT half of this stage — the flag names, the model id, the attempt
// ceiling, `CompilerEnablement` and `isMissionCompilerEnabled` — now lives in
// `leadMissionCompilerEnablement.ts`, so a caller that needs only the DECISION
// does not transitively import the compiler and its provider adapter. That
// caller is `leadIntelligencePolicy`, which is pure by contract.
//
// Everything is re-exported here unchanged: this module remains the single
// import site for the stage, and no existing importer had to move.
import {
  type CompilerEnablement, type CompilerEnablementReason, type EnvReader,
  isMissionCompilerEnabled, MAX_COMPILATION_ATTEMPTS,
} from "./leadMissionCompilerEnablement.ts";
export {
  DEFAULT_MISSION_COMPILER_MODEL, isMissionCompilerEnabled,
  MAX_COMPILATION_ATTEMPTS, MISSION_COMPILER_FLAG, MISSION_COMPILER_MODEL_ENV,
  MISSION_COMPILER_WORKSPACES_ENV,
} from "./leadMissionCompilerEnablement.ts";
export type {
  CompilerEnablement, CompilerEnablementReason, EnvReader,
} from "./leadMissionCompilerEnablement.ts";
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
  /**
   * The provider's own failure code, when one reached this layer.
   *
   * `quota_exhausted` is the one that matters: it is the only compilation
   * failure a person can actually fix, and it used to arrive here as nothing at
   * all. Null when no producer named a reason — which is now a distinct and
   * visible state rather than the default.
   */
  readonly providerCode: string | null;
  readonly providerDetail: string | null;

  constructor(
    workspaceId: string,
    enablementReason: CompilerEnablementReason,
    failure?: ModelFailure | null,
  ) {
    super(
      `mission compilation failed after ${MAX_COMPILATION_ATTEMPTS} attempt(s) for a ` +
      `workspace running the compiled-mission architecture (compiler enablement: ` +
      `${enablementReason}). No deterministic mission was substituted and no provider ` +
      `work was scheduled.` +
      (failure?.reported ? ` Provider reported: ${failure.code}.` : ""),
    );
    this.name = "MissionCompilationFailedError";
    this.workspaceId = workspaceId;
    this.enablementReason = enablementReason;
    this.providerCode = failure?.reported ? failure.code : null;
    this.providerDetail = failure?.detail ?? null;
  }
}

export interface MissionCompilerBinding {
  /** Null when disabled — the caller then uses the deterministic parser. */
  proposeMission: ((ctx: CompilerPromptContext) => Promise<unknown>) | null;
  enablement: CompilerEnablement;
  /** Safe task diagnostics. Never a prompt, credential or model output. */
  diagnostics: Record<string, unknown>;
  /**
   * Why the last compilation failed, in the PROVIDER's words.
   *
   * `proposeMission` answers `null` for every failure, which is the right
   * contract — the caller wants a mission or nothing. But it means the reason
   * dies at the return, and the reason is the whole difference between "the
   * model misread the request" and "the account has no credits".
   *
   * Read by the call site when it raises `MissionCompilationFailedError`, so a
   * quota outage surfaces as `quota_exhausted` rather than as a generic
   * compilation failure. Null before any attempt.
   */
  lastModelFailure: () => ModelFailure | null;
}

export function buildMissionCompilerBinding(input: {
  workspaceId: string;
  read?: EnvReader;
  /** Injected in tests. Production uses the configured strategist adapter. */
  generate?: GenerateJsonFn;
  /**
   * Where this stage's model spend is recorded.
   *
   * Optional, and its absence changes nothing but the ledger — the call still
   * runs and still logs. Passed down to `gptStructured` through `GptDeps`
   * rather than read from anywhere ambient, so the workspace and task a row is
   * attributed to are the ones this binding was built for.
   */
  onModelCall?: GptDeps["onModelCall"];
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
  const generate = input.generate ??
    createGptMissionGenerateJson({ onModelCall: input.onModelCall });

  // Binding-scoped so it survives `proposeMission` returning null. Reset at the
  // start of every call, so it can never describe an older attempt.
  let lastFailure: ModelFailure | null = null;

  return {
    enablement,
    diagnostics: base,
    lastModelFailure: () => lastFailure,
    proposeMission: async (ctx: CompilerPromptContext) => {
      const payload = JSON.stringify(buildMissionCompilerPayload(ctx));

      // BOUNDED RETRY, NOT A LOOP. The bound is a constant, so the worst case
      // is two calls whatever happens inside. A second attempt is made only when
      // the first produced nothing usable — a timeout, a refused model id, a
      // truncated or unparseable body. A model that misread the sentence
      // successfully returns a proposal and is never retried; `compileLeadMission`
      // judges that proposal, not this function.
      lastFailure = null;
      for (let attempt = 1; attempt <= MAX_COMPILATION_ATTEMPTS; attempt++) {
        try {
          const result = await generate({
            systemPrompt: MISSION_COMPILER_SYSTEM_PROMPT,
            messages: [{ role: "user", content: payload }],
          } as never);
          const r = result as { ok?: boolean; json?: unknown } | null | undefined;
          if (r?.ok && r.json != null) return r.json;

          // ── WHY IT FAILED, NOT JUST THAT IT DID ─────────────────────────
          //
          // This branch used to read `r.code` and `r.detail`. NO PRODUCER ON
          // THIS BOUNDARY HAS EVER EMITTED THOSE NAMES — `gptMissionModel` and
          // the strategist both send `errorCode` and `error` — so `code` was
          // always undefined, always fell through to the literal `"no_result"`,
          // and `detail` was always null.
          //
          // The comment that stood here said the branch existed to stop
          // dropping the reason. It dropped it anyway, and its log line looked
          // exactly like the bug it was meant to have fixed.
          //
          // On 2026-08-21 the OpenAI balance ran out: `insufficient_quota` was
          // in the body, was detected, survived two adapter layers as a code,
          // and died here — twice per message. `readModelFailure` is now the
          // only reader of this boundary and a test pins it against the real
          // producer sources.
          const failure = readModelFailure(result);
          lastFailure = failure;
          console.log("[mission-compiler][attempt-failed]", {
            attempt, of: MAX_COMPILATION_ATTEMPTS,
            code: failure.code,
            detail: failure.detail,
            // Distinguishes "the model failed and said why" from "nobody said
            // why" — the ambiguity that hid the original bug for its whole life.
            reported: failure.reported,
          });

          // NO SECOND ATTEMPT AGAINST AN EMPTY BALANCE. A retry cannot clear a
          // quota, and spending the caller's clock on one is how four silent
          // retries became a chat that answered nothing.
          if (isUnrecoverableModelFailure(failure.code)) {
            console.log("[mission-compiler][unrecoverable]", {
              code: failure.code,
              detail: failure.detail,
              note: "a human must act; further attempts cannot succeed",
            });
            break;
          }
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
