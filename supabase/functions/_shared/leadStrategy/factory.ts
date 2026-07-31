// PROVIDER SELECTION. The only place that maps configuration → adapter.

import { allowedModels, resolveLeadStrategistConfig, type EnvReader, type LeadStrategistConfig } from "./config.ts";
import { LovableAIStrategistProvider } from "./adapters/lovableAi.ts";
import { OpenAIStrategistProvider } from "./adapters/openai.ts";
import type { FetchLike } from "./adapters/shared.ts";
import type { QualifiedLeadStrategistProvider } from "./provider.ts";

export interface StrategistFactoryOptions {
  config?: LeadStrategistConfig;
  env?: EnvReader;
  fetchImpl?: FetchLike;
  apiKey?: string | null;
}

export function createLeadStrategistProvider(
  opts: StrategistFactoryOptions = {},
): { provider: QualifiedLeadStrategistProvider; config: LeadStrategistConfig } {
  const config = opts.config ?? resolveLeadStrategistConfig(opts.env);
  const models = allowedModels(config);
  const provider = config.provider === "openai"
    ? new OpenAIStrategistProvider({ allowedModels: models, apiKey: opts.apiKey, fetchImpl: opts.fetchImpl })
    : new LovableAIStrategistProvider({ allowedModels: models, apiKey: opts.apiKey, fetchImpl: opts.fetchImpl });
  return { provider, config };
}

export { allowedModels, resolveLeadStrategistConfig };
export { LovableAIStrategistProvider, OpenAIStrategistProvider };
