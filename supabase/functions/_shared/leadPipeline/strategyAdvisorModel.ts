// The production strategy advisor: GPT structured output whose ONLY possible
// answer is one id of DISCOVERY_STRATEGIES plus a sentence. The schema makes a
// provider name, actor, price or budget unrepresentable; `planStrategy` then
// accepts the pick only if its own deterministic checks already admitted it.
//
// Routed on the existing `discovery_actor_selection` stage (the nearest stage:
// choosing where discovery reads from), so the call appears in the cost trace.

import type { GenerateOpts, GenerateResult } from "../aiProvider.ts";
import { routeModel } from "../gptModelRouter.ts";
import { gptStructured, type GptDeps } from "../gptProvider.ts";
import type { GenerateJsonFn } from "../intelligence/plannerWrapper.ts";
import { DISCOVERY_STRATEGIES } from "./strategy.ts";

export const STRATEGY_ADVICE_SCHEMA = {
  name: "discovery_strategy_advice",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["strategy", "rationale"],
    properties: {
      strategy: { type: "string", enum: [...DISCOVERY_STRATEGIES] },
      rationale: { type: "string", maxLength: 400 },
    },
  },
} as const;

export function createStrategyAdvisorGenerateJson(deps: GptDeps = {}): GenerateJsonFn {
  return async (gen: GenerateOpts): Promise<GenerateResult> => {
    const started = Date.now();
    const route = routeModel("discovery_actor_selection");
    const r = await gptStructured<{ strategy: string; rationale: string }>({
      purpose: "lead_pipeline_strategy_advice",
      system: gen.systemPrompt ?? "",
      user: gen.messages.filter((m) => m.role !== "system").map((m) => m.content).join("\n\n"),
      schema: STRATEGY_ADVICE_SCHEMA as unknown as { name: string; schema: Record<string, unknown> },
      maxTokens: gen.maxTokens ?? 300,
      temperature: 0,
      model: route.model,
    } as never, deps);
    if (!r.ok) return { ok: false, content: "", provider: "openai", model: route.model, error: `${r.code}`, latencyMs: Date.now() - started } as GenerateResult;
    return { ok: true, content: JSON.stringify(r.value), json: r.value, provider: "openai", model: r.model, latencyMs: Date.now() - started } as GenerateResult;
  };
}
