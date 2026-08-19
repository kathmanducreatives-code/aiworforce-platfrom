// THE LEAD-INTELLIGENCE STAGES RUN ON GPT.
//
// ── WHAT THIS REPLACES ──────────────────────────────────────────────────────
//
// `createStrategistGenerateJson` routes to the Lovable gateway / Claude. Every
// remaining intelligence stage used it:
//
//   grounded Company Brain qualification   groundedBrainBinding
//   full-pool grounded evaluation          poolEvaluationBinding
//   pool ranking / prioritisation          poolEvaluationBinding
//   mission / request evaluation           missionEvaluationBinding
//   mission triage                         missionTriageBinding
//   semantic company classification        semanticClassificationBinding
//
// Each was ALSO behind its own feature flag, and none of those flags was ever
// set on the live project — so the stages neither ran nor, had they run, would
// have been GPT. Turning the flags on would have produced a Claude pipeline,
// not the GPT-first one.
//
// ── WHY THIS SENDS NO JSON SCHEMA ───────────────────────────────────────────
//
// These stages answer through `intelligence/plannerWrapper`, which already
// parses the envelope, scans it for prompt injection, validates the strategy
// body and makes one constrained repair attempt. It is the authority on their
// shape.
//
// Declaring a strict OpenAI schema in front of it would create a SECOND
// definition of the same contract, and two definitions of one rule drift. The
// Commit 2 lesson applies exactly: a field the parser reads but the schema
// omits becomes unemittable, so the parser's handling of it turns into dead
// code and the constraint vanishes from every run without anyone noticing.
//
// So this asks for `json_object` — the answer is still guaranteed to be JSON —
// and leaves `plannerWrapper` as the single authority on what that JSON must
// contain. The mission compiler is the opposite case and DOES send a strict
// schema, because it has no equivalent downstream validator of its own.
//
// ── NO SECOND MODEL ─────────────────────────────────────────────────────────
//
// There is deliberately no Claude fallback and no escalation path. The old
// adapter escalated to a larger Claude model on a parse failure; that is a
// second interpreter by another name. A failure here is reported as a failure,
// and the caller decides — which for qualification means recording an ungrounded
// verdict rather than inventing a grounded one.
import {
  gptStructured, GPT_MODEL, modelForTier, type GptDeps, type GptTier,
} from "./gptProvider.ts";
import type { GenerateOpts, GenerateResult } from "./aiProvider.ts";
import type { GenerateJsonFn } from "./intelligence/plannerWrapper.ts";

export const GPT_STRATEGIST_VERSION = "gpt-strategist-v1" as const;

/** The provenance string every GPT-backed intelligence stage reports. */
export const GPT_STRATEGIST_MODEL_ID = `openai:${GPT_MODEL}` as const;

/**
 * A `GenerateJsonFn` backed by OpenAI, for stages whose shape is owned by
 * `plannerWrapper`.
 *
 * Drop-in for `createStrategistGenerateJson`: same signature, same result type,
 * different provider and no escalation.
 */
export interface StrategistRouting {
  /** Which model tier this stage needs. Defaults to `reasoning`. */
  tier?: GptTier;
  /** Why, in the caller's words. Persisted with the call. */
  reason?: string;
  /** Names the stage in diagnostics, so calls are separable per stage. */
  purpose?: string;
}

/**
 * @param routing Which tier this STAGE needs — see `GptTier`.
 *
 * Omitting it keeps the reasoning tier, which is the safe default: a stage that
 * has not stated what it needs must not be quietly downgraded.
 */
export function createGptStrategistGenerateJson(
  deps: GptDeps = {}, routing: StrategistRouting = {},
): GenerateJsonFn {
  const tier: GptTier = routing.tier ?? "reasoning";
  const modelId = `openai:${modelForTier(tier)}`;
  return async (gen: GenerateOpts): Promise<GenerateResult> => {
    const started = Date.now();

    const system = gen.systemPrompt ?? "";
    const user = gen.messages
      .filter((m) => m.role !== "system")
      .map((m) => m.content)
      .join("\n\n");

    const r = await gptStructured<Record<string, unknown>>({
      purpose: routing.purpose ?? "lead_intelligence_stage",
      system,
      user,
      // No `schema`: see the header. `plannerWrapper` owns the contract.
      temperature: gen.temperature ?? 0,
      maxTokens: gen.maxTokens ?? 4000,
      tier,
      routing_reason: routing.reason,
    }, deps);

    const latencyMs = Date.now() - started;

    if (r.ok) {
      return {
        ok: true,
        content: JSON.stringify(r.value),
        json: r.value,
        // Reported honestly — neither the Lovable gateway nor Anthropic. A
        // record claiming either would make "which model decided this?"
        // unanswerable, which is the question the 2026-08-17 audit could not
        // answer for any stage.
        provider: "none",
        model: modelId,
        latencyMs,
      };
    }

    return {
      ok: false,
      content: "",
      provider: "none",
      model: modelId,
      error: r.detail,
      errorCode: r.code,
      latencyMs,
    };
  };
}
