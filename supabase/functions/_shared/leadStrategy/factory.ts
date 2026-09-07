// PROVIDER SELECTION. The only place that maps configuration → adapter.

import { allowedModels, resolveLeadStrategistConfig, type EnvReader, type LeadStrategistConfig } from "./config.ts";
import { LovableAIStrategistProvider } from "./adapters/lovableAi.ts";
import { OpenAIStrategistProvider } from "./adapters/openai.ts";
import type { FetchLike, OpenAiCompatibleOptions } from "./adapters/shared.ts";
import type { QualifiedLeadStrategistProvider } from "./provider.ts";

export interface StrategistFactoryOptions {
  config?: LeadStrategistConfig;
  env?: EnvReader;
  fetchImpl?: FetchLike;
  apiKey?: string | null;
  /**
   * Where this provider's model spend is recorded, and what bounds it.
   *
   * This is "the only place that maps configuration → adapter", so it is the
   * only place the seam needs threading. Without it the transport's telemetry
   * went nowhere.
   */
  onModelCall?: OpenAiCompatibleOptions["onModelCall"];
  budget?: OpenAiCompatibleOptions["budget"];
}

export function createLeadStrategistProvider(
  opts: StrategistFactoryOptions = {},
): { provider: QualifiedLeadStrategistProvider; config: LeadStrategistConfig } {
  const config = opts.config ?? resolveLeadStrategistConfig(opts.env);
  const models = allowedModels(config);
  const provider = config.provider === "openai"
    ? new OpenAIStrategistProvider({
      allowedModels: models, apiKey: opts.apiKey, fetchImpl: opts.fetchImpl,
      onModelCall: opts.onModelCall, budget: opts.budget,
    })
    : new LovableAIStrategistProvider({
      allowedModels: models, apiKey: opts.apiKey, fetchImpl: opts.fetchImpl,
      onModelCall: opts.onModelCall, budget: opts.budget,
    });
  return { provider, config };
}

export { allowedModels, resolveLeadStrategistConfig };
export { LovableAIStrategistProvider, OpenAIStrategistProvider };
