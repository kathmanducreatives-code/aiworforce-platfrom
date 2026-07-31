// SHARED OPENAI-COMPATIBLE TRANSPORT.
//
// Both adapters speak the OpenAI chat-completions wire format, so the request
// body, the response parsing and the error normalization are written ONCE here.
// An adapter only supplies its endpoint, credential and provider id — which is
// exactly what keeps the canonical result byte-identical across providers.

import { extractJson } from "../aiProvider.ts";
import {
  DEFAULT_MAX_COMPLETION_TOKENS, DEFAULT_TIMEOUT_MS,
} from "./config.ts";
import type {
  StrategistCall, StrategistProviderId, StrategistResult,
} from "./provider.ts";

/** Fetch seam so contract tests never touch the network. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * The exact body every provider receives:
 *  - `reasoning_effort: "none"` is required by the gpt-5.6-* chat models.
 *  - `max_tokens` / non-default `temperature` are rejected by GPT-5 models;
 *    only `max_completion_tokens` may cap the response.
 */
export function buildStrategistRequestBody(
  call: StrategistCall,
  wireModel = call.model,
): Record<string, unknown> {
  return {
    model: wireModel,
    messages: [
      { role: "system", content: call.systemPrompt },
      { role: "user", content: call.userMessage },
    ],
    reasoning_effort: "none",
    max_completion_tokens: call.maxCompletionTokens ?? DEFAULT_MAX_COMPLETION_TOKENS,
    response_format: { type: "json_object" },
  };
}

export function normalizeHttpError(status: number): string {
  if (status === 429) return "rate_limited";
  if (status === 402) return "credits_exhausted";
  return "provider_error";
}

export interface OpenAiCompatibleOptions {
  provider: StrategistProviderId;
  endpoint: string;
  headers: Record<string, string>;
  /** Model id as the wire expects it (may differ from the canonical id). */
  wireModel?: string;
  fetchImpl?: FetchLike;
}

/**
 * One canonical execution path. `model` in the result is always the CANONICAL
 * model id (`call.model`), never the vendor-specific wire id, so downstream
 * provenance is provider-independent.
 */
export async function completeOpenAiCompatible(
  call: StrategistCall,
  opts: OpenAiCompatibleOptions,
): Promise<StrategistResult> {
  const started = Date.now();
  const doFetch: FetchLike = opts.fetchImpl ?? ((i, init) => fetch(i, init));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), call.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const res = await doFetch(opts.endpoint, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", ...opts.headers },
      body: JSON.stringify(buildStrategistRequestBody(call, opts.wireModel ?? call.model)),
    });
    clearTimeout(timer);
    const text = await res.text();
    const latencyMs = Date.now() - started;

    if (!res.ok) {
      return {
        ok: false,
        model: call.model,
        provider: opts.provider,
        content: "",
        latencyMs,
        error: `${opts.provider} ${res.status}: ${text.slice(0, 300)}`,
        errorCode: normalizeHttpError(res.status),
      };
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return {
        ok: false, model: call.model, provider: opts.provider, content: text.slice(0, 300),
        latencyMs, error: `json_parse_failed: ${String(e)}`, errorCode: "json_parse_failed",
      };
    }

    const choices = data?.choices as Array<{ message?: { content?: string } }> | undefined;
    const content = choices?.[0]?.message?.content ?? "";
    try {
      return {
        ok: true, model: call.model, provider: opts.provider, content,
        json: extractJson(content), latencyMs, usage: data?.usage,
      };
    } catch (e) {
      return {
        ok: false, model: call.model, provider: opts.provider, content, latencyMs,
        usage: data?.usage, error: `json_parse_failed: ${String(e)}`, errorCode: "json_parse_failed",
      };
    }
  } catch (e) {
    clearTimeout(timer);
    const msg = String((e as Error)?.message ?? e);
    return {
      ok: false, model: call.model, provider: opts.provider, content: "",
      latencyMs: Date.now() - started, error: msg.slice(0, 200),
      errorCode: /abort/i.test(msg) ? "timeout" : "network_error",
    };
  }
}

export function modelNotAllowed(
  call: StrategistCall,
  provider: StrategistProviderId,
): StrategistResult {
  return {
    ok: false, model: call.model, provider, content: "", latencyMs: 0,
    error: `model_not_allowed:${call.model}`, errorCode: "model_not_allowed",
  };
}

export function missingCredential(
  call: StrategistCall,
  provider: StrategistProviderId,
  keyName: string,
): StrategistResult {
  return {
    ok: false, model: call.model, provider, content: "", latencyMs: 0,
    error: `${keyName} missing`, errorCode: "no_provider",
  };
}
