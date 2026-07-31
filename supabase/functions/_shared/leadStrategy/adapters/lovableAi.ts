// LOVABLE AI adapter. Currently the default provider.
//
// Contains ONLY transport concerns: endpoint, credential, provider id. No
// policy, no prompts, no taxonomy, no validation.

import {
  completeOpenAiCompatible, missingCredential, modelNotAllowed, type FetchLike,
} from "./shared.ts";
import type {
  QualifiedLeadStrategistProvider, StrategistCall, StrategistResult,
} from "../provider.ts";

export const LOVABLE_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

export interface LovableAiStrategistOptions {
  allowedModels: readonly string[];
  apiKey?: string | null;
  fetchImpl?: FetchLike;
  endpoint?: string;
}

export class LovableAIStrategistProvider implements QualifiedLeadStrategistProvider {
  readonly id = "lovable_ai" as const;
  readonly allowedModels: readonly string[];

  constructor(private readonly opts: LovableAiStrategistOptions) {
    this.allowedModels = opts.allowedModels;
  }

  complete(call: StrategistCall): Promise<StrategistResult> {
    if (!this.allowedModels.includes(call.model)) {
      return Promise.resolve(modelNotAllowed(call, this.id));
    }
    const apiKey = this.opts.apiKey ?? readEnv("LOVABLE_API_KEY");
    if (!apiKey) return Promise.resolve(missingCredential(call, this.id, "LOVABLE_API_KEY"));

    return completeOpenAiCompatible(call, {
      provider: this.id,
      endpoint: this.opts.endpoint ?? LOVABLE_GATEWAY_URL,
      headers: { Authorization: `Bearer ${apiKey}` },
      fetchImpl: this.opts.fetchImpl,
    });
  }
}

function readEnv(key: string): string | undefined {
  try {
    return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(key);
  } catch {
    return undefined;
  }
}
