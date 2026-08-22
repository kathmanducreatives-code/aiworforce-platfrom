// THE MISSION IS COMPILED BY GPT, OR IT IS NOT COMPILED.
//
// ── WHAT THIS REPLACES ──────────────────────────────────────────────────────
//
// Mission compilation reached the model through `createStrategistGenerateJson`,
// which routes to the Lovable/Claude strategist — and only when
// `GPT_LEAD_MISSION_COMPILER` was set. On the live project that flag has never
// been set, so `proposeMission` was null, `compileLeadMission` read "nothing
// proposed", and a regex reading of the sentence became the mission.
//
// The 2026-08-17 run is what that cost. "Find 10 qualified AI startups in the
// United States that are currently hiring software engineers" compiled to
// `positive_keywords: []` with the verticals taken from the Company Brain
// (`field_provenance.company_profile.verticals = "company_brain"`). The word
// "AI" reached no provider; 30 companies were investigated against an ICP the
// user never asked for; 0 qualified.
//
// ── WHY THIS IS A `GenerateJsonFn` AND NOT A NEW PIPELINE ───────────────────
//
// The payload builder, the system prompt, the proposal parser, the validator
// and the bounded retry are all correct and already tested. The defect was
// never in that machinery — it was WHICH MODEL sat behind it and WHETHER it ran
// at all. Swapping only the model keeps the change reviewable and leaves every
// existing mission-compiler test meaningful.
//
// ── NO SECOND MODEL, AND NO SILENT DEGRADATION ──────────────────────────────
//
// There is deliberately no Claude fallback. Falling back to a different
// interpreter is exactly how a request for AI startups became a search for B2B
// companies with nobody told. When GPT cannot answer, this reports a failure
// and the caller refuses the run: a blocked run is recoverable, a confident
// wrong answer is not.
import { routeModel } from "./gptModelRouter.ts";
import { gptStructured, GPT_MODEL, type GptDeps } from "./gptProvider.ts";
import type { ModelRoute } from "./gptModelRouter.ts";
import { GPT_MISSION_SCHEMA } from "./gptMissionSchema.ts";
import type { GenerateOpts, GenerateResult } from "./aiProvider.ts";
import type { GenerateJsonFn } from "./intelligence/plannerWrapper.ts";

export const GPT_MISSION_MODEL_VERSION = "gpt-mission-model-v1" as const;

/** The provenance string a compiled mission carries. Asserted by tests. */
/**
 * The provenance string when nothing has been routed.
 *
 * KEPT ONLY AS A FALLBACK. The compiled mission records the model that ACTUALLY
 * read the sentence — `openai:gpt-5.6-luna`, or `openai:gpt-5.6-terra` when a
 * validation failure escalated — because "which model read this request?" was
 * the question that cost a day in the 2026-08-17 audit, and a constant answers
 * it wrongly the moment routing moves.
 */
export const GPT_MISSION_MODEL_ID = `openai:${GPT_MODEL}` as const;

/** The provenance string for a given route. */
export function missionModelIdFor(route: { model: string }): string {
  return `openai:${route.model}`;
}

/**
 * A `GenerateJsonFn` backed by OpenAI structured output.
 *
 * The schema is `GPT_MISSION_SCHEMA`, derived field-by-field from
 * `parseMissionProposal` — see `gptMissionSchema.ts`. The parser remains the
 * authority on what a proposal MEANS; the schema only guarantees the model
 * answers in a shape the parser can read.
 */
export function createGptMissionGenerateJson(
  deps: GptDeps = {},
  opts?: {
    /**
     * Run on this route instead of the stage default.
     *
     * How the escalation ladder re-runs compilation on Terra without this
     * module knowing an escalation exists.
     */
    route?: ModelRoute;
  },
): GenerateJsonFn {
  return async (gen: GenerateOpts): Promise<GenerateResult> => {
    const started = Date.now();

    const system = gen.systemPrompt ?? "";
    const user = gen.messages
      .filter((m) => m.role !== "system")
      .map((m) => m.content)
      .join("\n\n");

    // ROUTED, LIKE EVERY OTHER STAGE. This passed no tier, so it inherited
    // `reasoning` by default — the right answer nobody had made, and absent
    // from the run's cost trace. `gptModelRouter` is now the only place that
    // decides, and it says the same thing for a different, stated reason: one
    // call decides what the entire run is for.
    const route = opts?.route ?? routeModel("mission_compilation");
    const r = await gptStructured<Record<string, unknown>>({
      purpose: route.stage,
      system,
      user,
      schema: GPT_MISSION_SCHEMA,
      // THE ROUTER'S MODEL, NOT A TIER LOOKUP. `route` may be the primary
      // (Luna) or the escalation (Terra) — this function does not know or care
      // which, which is what keeps the ladder in one place.
      model: route.model,
      reasoningEffort: route.reasoning_effort,
      tier: route.tier,
      routing_reason: route.reason,
      // Compilation is a reading task, not a creative one: the same sentence
      // must compile the same way twice, or a run cannot be reproduced. The
      // builder DROPS this for a GPT-5 model, which rejects any non-default
      // value and is effectively greedy at low effort anyway.
      temperature: 0,
      maxTokens: gen.maxTokens ?? 4000,
    }, deps);

    const latencyMs = Date.now() - started;

    if (r.ok) {
      return {
        ok: true,
        content: JSON.stringify(r.value),
        json: r.value,
        // Reported honestly. This is neither the Lovable gateway nor Anthropic,
        // and a record claiming either would make "which model read this
        // request?" unanswerable all over again — the question that cost a day
        // in the 2026-08-17 audit.
        provider: "none",
        model: missionModelIdFor(route),
        latencyMs,
      };
    }

    return {
      ok: false,
      content: "",
      provider: "none",
      model: missionModelIdFor(route),
      // `gptProvider` never throws and never echoes the key — every failure is
      // already a redacted value carrying a branchable code.
      error: r.detail,
      errorCode: r.code,
      latencyMs,
    };
  };
}
