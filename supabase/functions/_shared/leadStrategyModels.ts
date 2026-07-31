// UNIFIED LEAD-STRATEGY MODEL BINDING — OpenAI only, via Lovable's built-in AI
// gateway. GPT-5.6 Luna is the primary strategist; Terra is the single
// escalation. Gemini and Anthropic are deliberately unreachable from this path:
// the qualified-lead strategy owner must have exactly one model family so its
// behaviour is reproducible and auditable.
//
// This module does NOT go through `_shared/aiProvider.ts`'s `generateText`
// fallback chain on purpose — that chain would silently fall back to Gemini
// (and to `openai/gpt-5-mini`), and it sends `temperature` / `max_tokens`,
// which every GPT-5 family model rejects with a 400.

import { extractJson } from "./aiProvider.ts";

const LOVABLE_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

/** Primary strategist. Fast, low cost, handles the overwhelming majority of rounds. */
export const LEAD_STRATEGY_PRIMARY_MODEL = "openai/gpt-5.6-luna";
/** Single escalation. Used only when Luna fails validation or is unavailable. */
export const LEAD_STRATEGY_ESCALATION_MODEL = "openai/gpt-5.6-terra";

/** Every model this path may ever call. Anything else is a wiring bug. */
export const LEAD_STRATEGY_ALLOWED_MODELS: readonly string[] = [
  LEAD_STRATEGY_PRIMARY_MODEL,
  LEAD_STRATEGY_ESCALATION_MODEL,
];

export const LEAD_STRATEGY_MAX_COMPLETION_TOKENS = 1600;
export const LEAD_STRATEGY_TIMEOUT_MS = 20_000;

export type LeadStrategyModelTier = "primary" | "escalation";

export function modelForTier(tier: LeadStrategyModelTier): string {
  return tier === "escalation" ? LEAD_STRATEGY_ESCALATION_MODEL : LEAD_STRATEGY_PRIMARY_MODEL;
}

export interface LeadStrategyModelCall {
  model: string;
  systemPrompt: string;
  userMessage: string;
  timeoutMs?: number;
  maxCompletionTokens?: number;
}

export interface LeadStrategyModelResult {
  ok: boolean;
  model: string;
  json?: unknown;
  content: string;
  latencyMs: number;
  usage?: unknown;
  error?: string;
  errorCode?: string;
}

/** Injected in tests. Never touches the network there. */
export type LeadStrategyModelFn = (call: LeadStrategyModelCall) => Promise<LeadStrategyModelResult>;

/**
 * The exact request body the gateway receives. Exported so tests can assert the
 * GPT-5.6 contract without a live call:
 *  - `reasoning_effort: "none"` is REQUIRED for gpt-5.6-* chat completions.
 *  - `max_tokens` and non-default `temperature` are rejected by GPT-5 models;
 *    only `max_completion_tokens` may cap the response.
 */
export function buildLeadStrategyRequestBody(call: LeadStrategyModelCall): Record<string, unknown> {
  return {
    model: call.model,
    messages: [
      { role: "system", content: call.systemPrompt },
      { role: "user", content: call.userMessage },
    ],
    reasoning_effort: "none",
    max_completion_tokens: call.maxCompletionTokens ?? LEAD_STRATEGY_MAX_COMPLETION_TOKENS,
    response_format: { type: "json_object" },
  };
}

export const callLeadStrategyModel: LeadStrategyModelFn = async (call) => {
  const started = Date.now();
  if (!LEAD_STRATEGY_ALLOWED_MODELS.includes(call.model)) {
    return {
      ok: false, model: call.model, content: "", latencyMs: 0,
      error: `model_not_allowed:${call.model}`, errorCode: "model_not_allowed",
    };
  }
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    return { ok: false, model: call.model, content: "", latencyMs: 0, error: "LOVABLE_API_KEY missing", errorCode: "no_provider" };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), call.timeoutMs ?? LEAD_STRATEGY_TIMEOUT_MS);
  try {
    const res = await fetch(LOVABLE_GATEWAY_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(buildLeadStrategyRequestBody(call)),
    });
    clearTimeout(timer);
    const text = await res.text();
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      let code = `lovable_${res.status}`;
      if (res.status === 429) code = "rate_limited";
      else if (res.status === 402) code = "credits_exhausted";
      return { ok: false, model: call.model, content: "", latencyMs, error: `Lovable ${res.status}: ${text.slice(0, 300)}`, errorCode: code };
    }
    const data = JSON.parse(text);
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    try {
      return { ok: true, model: call.model, content, json: extractJson(content), latencyMs, usage: data?.usage };
    } catch (e) {
      return { ok: false, model: call.model, content, latencyMs, usage: data?.usage, error: `json_parse_failed: ${String(e)}`, errorCode: "json_parse_failed" };
    }
  } catch (e) {
    clearTimeout(timer);
    const msg = String((e as Error)?.message ?? e);
    return {
      ok: false, model: call.model, content: "", latencyMs: Date.now() - started,
      error: msg.slice(0, 200), errorCode: msg.includes("abort") ? "timeout" : "network_error",
    };
  }
};
