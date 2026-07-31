// PROVIDER-INDEPENDENT STRATEGIST INTERFACE.
//
// Agentory owns the strategy. A provider is nothing more than "send this
// system+user message to a model, give me back parsed JSON". Policy, prompts,
// taxonomy, query-pack / source-plan schemas, validation, escalation rules,
// deterministic fallback and provenance all live OUTSIDE this file and are
// identical for every provider.
//
// Adding a provider must never require touching the contract, the validator or
// the strategy owner.

export type StrategistProviderId = "lovable_ai" | "openai";

export type StrategistTier = "primary" | "escalation";

/** Canonical, provider-agnostic request. */
export interface StrategistCall {
  /** Concrete model id resolved from logical configuration. */
  model: string;
  systemPrompt: string;
  userMessage: string;
  timeoutMs?: number;
  maxCompletionTokens?: number;
}

/** Canonical, provider-agnostic result. Byte-identical across adapters. */
export interface StrategistResult {
  ok: boolean;
  model: string;
  /** Which adapter produced this result. Never affects downstream behaviour. */
  provider?: StrategistProviderId;
  json?: unknown;
  content: string;
  latencyMs: number;
  usage?: unknown;
  error?: string;
  errorCode?: StrategistErrorCode | string;
}

/** Normalized failure vocabulary. Every adapter must map into exactly these. */
export type StrategistErrorCode =
  | "model_not_allowed"
  | "no_provider"
  | "rate_limited"
  | "credits_exhausted"
  | "provider_error"
  | "json_parse_failed"
  | "timeout"
  | "network_error";

export interface QualifiedLeadStrategistProvider {
  readonly id: StrategistProviderId;
  /** Concrete model ids this provider instance may call. */
  readonly allowedModels: readonly string[];
  complete(call: StrategistCall): Promise<StrategistResult>;
}

/** The function seam the strategy owner actually depends on. */
export type StrategistCallFn = (call: StrategistCall) => Promise<StrategistResult>;

export function providerToCallFn(provider: QualifiedLeadStrategistProvider): StrategistCallFn {
  return (call) => provider.complete(call);
}
