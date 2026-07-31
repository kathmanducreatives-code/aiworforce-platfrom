// DIRECT OPENAI adapter. Activated purely by configuration
// (LEAD_STRATEGIST_PROVIDER=openai) — no code change, no policy change.
//
// SERVER-SIDE ONLY: OPENAI_API_KEY is read from edge-function env and must
// never be exposed to the browser (no VITE_ prefix, never returned in a
// response body, never logged).

import {
  completeOpenAiCompatible, missingCredential, modelNotAllowed, type FetchLike,
} from "./shared.ts";
import type {
  QualifiedLeadStrategistProvider, StrategistCall, StrategistResult,
} from "../provider.ts";

export const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

/**
 * Canonical model ids carry a `openai/` vendor prefix (that is what gateways
 * expect). The direct OpenAI API wants the bare model id.
 */
export function toOpenAiWireModel(model: string): string {
  return model.startsWith("openai/") ? model.slice("openai/".length) : model;
}

export interface OpenAiStrategistOptions {
  allowedModels: readonly string[];
  apiKey?: string | null;
  fetchImpl?: FetchLike;
  endpoint?: string;
}

export class OpenAIStrategistProvider implements QualifiedLeadStrategistProvider {
  readonly id = "openai" as const;
  readonly allowedModels: readonly string[];

  constructor(private readonly opts: OpenAiStrategistOptions) {
    this.allowedModels = opts.allowedModels;
  }

  complete(call: StrategistCall): Promise<StrategistResult> {
    if (!this.allowedModels.includes(call.model)) {
      return Promise.resolve(modelNotAllowed(call, this.id));
    }
    const apiKey = this.opts.apiKey ?? readEnv("OPENAI_API_KEY");
    if (!apiKey) return Promise.resolve(missingCredential(call, this.id, "OPENAI_API_KEY"));

    return completeOpenAiCompatible(call, {
      provider: this.id,
      endpoint: this.opts.endpoint ?? OPENAI_CHAT_URL,
      headers: { Authorization: `Bearer ${apiKey}` },
      wireModel: toOpenAiWireModel(call.model),
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
