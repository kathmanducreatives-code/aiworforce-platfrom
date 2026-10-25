// A task-policy allowlist over existing transports, NOT another stage router.
export const PILOT_MODEL_REGISTRY = Object.freeze(
  [
    {
      provider: "openai",
      model: "gpt-4.1-mini",
      adapter: "gptStructured",
      schema: "pilot_model_probe_v1",
      schemas: ["pilot_model_probe_v1", "call_brief_v1"],
      implemented: true,
      enabled: false,
      reason:
        "Offline adapter only; account, T01 integration and native accounting acceptance pending",
    },
    {
      provider: "anthropic",
      model: null,
      adapter: null,
      schema: null,
      implemented: false,
      enabled: false,
      reason: "Pilot Claude adapter, consent and execution policy not verified",
    },
    {
      provider: "google",
      model: null,
      adapter: null,
      schema: null,
      implemented: false,
      enabled: false,
      reason: "Pilot Gemini adapter, consent and execution policy not verified",
    },
  ] as const,
);
export const PILOT_HARD_LIMITS = Object.freeze({
  runtime_attempts: 4,
  model_usd: 0.05,
  provider_usd: 0.20,
  combined_usd: 0.25,
});
