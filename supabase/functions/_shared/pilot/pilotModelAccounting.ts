import {
  MODEL_PRICES,
  type ModelUsage,
  priceModelCall,
  readModelUsage,
} from "../modelCostModel.ts";
import { PilotRefusal } from "./pilotPolicy.ts";
import type { PilotModelPolicy } from "./pilotTaskModelPolicy.ts";
export function reserveModelUsd(p: PilotModelPolicy): number {
  const price = MODEL_PRICES[p.model];
  if (!price || price.billed_by && price.billed_by !== "openai") {
    throw new PilotRefusal("pilot_model_price_unknown", 503);
  }
  // Reserve against full input cap, including fixed-schema/message overhead. No cache discount.
  const usd = Math.ceil(
    p.max_input_tokens * price.input_per_1m +
      p.max_output_tokens * price.output_per_1m,
  ) / 1_000_000;
  if (
    !Number.isFinite(usd) || usd <= 0 || usd > p.model_budget_usd ||
    usd > p.combined_budget_usd
  ) throw new PilotRefusal("pilot_model_budget_exhausted", 409);
  return usd;
}
export function accountModel(raw: unknown, model: string | null) {
  const usage = readModelUsage(raw);
  const counts = [
    usage.input_tokens,
    usage.output_tokens,
    usage.cached_input_tokens,
  ];
  const complete =
    counts.every((v) =>
      typeof v === "number" && Number.isSafeInteger(v) && v >= 0
    ) && usage.cached_input_tokens! <= usage.input_tokens!;
  // Existing pricing accepts partial counts. Pilot admission requires complete usage.
  const cost = model && complete ? priceModelCall({ model, usage }) : null;
  return {
    usage,
    estimated_cost_usd: cost?.estimated_usd ?? null,
    actual_cost_usd: null,
    cost_source: cost?.source === "event_priced"
      ? "event_priced" as const
      : "unknown" as const,
    accounting_uncertain: !complete || cost?.estimated_usd == null,
  };
}
export function emptyUsage(): ModelUsage {
  return { input_tokens: null, cached_input_tokens: null, output_tokens: null };
}
