// WHAT A MODEL CALL COST, AND HOW WE KNOW.
//
// ── THE STATE THIS REPLACES ─────────────────────────────────────────────────
//
// Nothing. Neither transport read `usage` off a response — not
// `prompt_tokens`, not `completion_tokens`, not the cached-input count — and no
// model spend of any kind was recorded anywhere. A run could be audited for
// Apify dollars down to the cent and could not answer "what did the models
// cost?" at all.
//
// That is why the routing question could not be settled by measurement. Every
// claim about which model to use was an argument about prices nobody was
// tracking against volumes nobody had counted.
//
// ── PROVENANCE, THE SAME FOUR GRADES AS PROVIDER COST ───────────────────────
//
// OpenAI returns exact token counts and does NOT return a charge. So a model
// call is `event_priced` by construction: computed from counts the provider
// itself reported and a price table we hold. That is a stronger position than
// the Apify side — where the row count is ours too — and it is still not
// `provider_reported`, because no dollar figure came from OpenAI.
//
// A model this table does not price is `unknown`, never zero. Adding a model to
// the router without adding it here should make the cost disappear from the
// audit, loudly, rather than quietly read as free.
//
// ── CACHED INPUT IS NOT A ROUNDING DETAIL ───────────────────────────────────
//
// Luna prices cached input at $0.02/1M against $0.20 uncached — a 10x
// difference — and every stage in this pipeline resends a large, stable system
// prompt. Pricing cached tokens at the full rate would overstate the model bill
// by more than the difference between two candidate models, which is exactly
// the decision this telemetry exists to inform.
//
// PURE. No network, no database, no clock.

import type { ExecutionCost } from "./executionLedger.ts";

export const MODEL_COST_MODEL_VERSION = "model-cost-model-v1" as const;

/** USD per 1,000,000 tokens. */
export interface ModelPrice {
  input_per_1m: number;
  /** Charged for the portion of input the provider served from its cache. */
  cached_input_per_1m: number;
  output_per_1m: number;
  /**
   * WHERE THE MONEY IS ACTUALLY BILLED.
   *
   * Not decoration. `google/gemini-3-flash-preview` reaches us through the
   * Lovable gateway, and a gateway's rate need not equal the model vendor's
   * published one — so "the provider charges $X" is not evidence about what
   * this system pays. Recording the billing surface is what makes a price
   * checkable against an invoice instead of against a blog post.
   */
  billed_by?: "openai" | "anthropic" | "google" | "lovable_gateway";
  /** Where the figure came from, so a wrong one is traceable to its source. */
  price_source?: string;
  /** When it was last confirmed. A price with no date is a rumour. */
  effective?: string;
}

/**
 * MODELS THIS SYSTEM CAN SELECT AND CANNOT PRICE.
 *
 * ── WHY THIS LIST EXISTS RATHER THAN A GUESS ───────────────────────────────
 *
 * Every one of these is reachable in production today. None has a price here,
 * and none is given one, because the calls go through the Lovable gateway whose
 * billing need not match any vendor's list price — a number copied from a
 * pricing page would look authoritative and be unverifiable, which is worse
 * than an honest gap.
 *
 * So they price as `unknown`, NEVER as `$0`. `priceModelCall` already draws
 * that distinction; `modelSpendCeiling` counts them in `unpriced_calls`; and
 * `ModelCallCollector`'s run budget bounds them by TOKENS AND CALLS instead,
 * which needs no price to work. Unknown cost is contained, not ignored.
 *
 * To retire an entry: take the real figure from a Lovable/Anthropic invoice,
 * add it to `MODEL_PRICES` with `billed_by`, `price_source` and `effective`,
 * and delete the name here. The test that reads this list will then require it.
 */
export const UNPRICED_MODELS: Readonly<Record<string, string>> = Object.freeze({
  "google/gemini-3-flash-preview":
    "chat, orchestration, agent execution and Company Brain — billed via the Lovable gateway",
  "google/gemini-2.5-flash-lite":
    "the helper tier — billed via the Lovable gateway",
  "openai/gpt-5-mini":
    "aiProvider's alternate-family fallback — billed via the Lovable gateway",
});

/**
 * The published list prices, as supplied 2026-08-21.
 *
 * KEYED ON THE BARE MODEL ID. Both transports are normalised into this shape
 * before lookup: one sends `gpt-4.1`, the other `openai/gpt-5.6-luna`, and a
 * table that had to know about both prefixes would be a table with two answers
 * for one model.
 *
 * Worth reading side by side, because it contradicts the intuition that a newer
 * model is a cheaper one:
 *
 *     gpt-4.1        $2.00 in / $8.00 out
 *     gpt-5.6-terra  $2.00 in / $12.00 out   ← 1.5x the OUTPUT of 4.1
 *     gpt-5.6-luna   $0.20 in / $1.20 out    ← 10x / 6.7x cheaper than 4.1
 *
 * So moving the planning stages from 4.1 to Terra would RAISE the model bill,
 * and moving them to Luna would cut it hard. Which of those is right depends on
 * whether a cheaper planner buys a worse Apify pool — a question this module
 * makes measurable and does not answer.
 */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = Object.freeze({
  "gpt-5.6-luna": {
    input_per_1m: 0.20, cached_input_per_1m: 0.02, output_per_1m: 1.20,
    billed_by: "openai", price_source: "published list price", effective: "2026-08-21",
  },
  "gpt-5.6-terra": { input_per_1m: 2.00, cached_input_per_1m: 0.20, output_per_1m: 12.00 },
  "gpt-5.6-sol": { input_per_1m: 5.00, cached_input_per_1m: 0.50, output_per_1m: 30.00 },
  "gpt-4.1": { input_per_1m: 2.00, cached_input_per_1m: 0.50, output_per_1m: 8.00 },
  "gpt-4.1-mini": { input_per_1m: 0.40, cached_input_per_1m: 0.10, output_per_1m: 1.60 },

  // ── THE ONE MODEL BILLED DIRECTLY BY ANTHROPIC ───────────────────────────
  //
  // Everything else here is a gateway model, which is why the neighbouring
  // UNPRICED_MODELS list refuses to price them: the Lovable gateway's rate need
  // not equal a vendor's published one, so a figure copied from a pricing page
  // would look authoritative and be unverifiable.
  //
  // THIS ONE IS DIFFERENT, and the difference is what makes the price legitimate.
  // `aiProvider` has two transports — `lovable-ai` via ai.gateway.lovable.dev,
  // and `anthropic` via api.anthropic.com using ANTHROPIC_API_KEY. This id is
  // `ANTHROPIC_MODEL`, used ONLY on the direct transport, so Anthropic invoices
  // it at their list price and the published number IS the billing basis.
  //
  // Confirmed against a real production call on 2026-09-10: the first Scribe
  // generation (task 20fc24e7) recorded provider "anthropic", model
  // claude-haiku-4-5-20251001, 3153 in / 308 out.
  //
  // KEYED ON THE EXACT DATED ID, deliberately, unlike the OpenAI entries whose
  // bare ids let `canonicalModelId` prefix-match dated snapshots. A future
  // `claude-haiku-4-5-<newdate>` may not carry today's rate, and prefix matching
  // would bill it silently at this one. An unrecognised snapshot prices as
  // `unknown` instead, which is visible in `unpriced_calls`.
  "claude-haiku-4-5-20251001": {
    input_per_1m: 1.00, cached_input_per_1m: 0.10, output_per_1m: 5.00,
    billed_by: "anthropic",
    price_source: "Anthropic published API pricing, platform.claude.com/docs/en/about-claude/pricing " +
      "(Claude Haiku 4.5: $1/MTok base input, $0.10/MTok cache hits, $5/MTok output)",
    effective: "2026-09-10",
  },
});

// ── IMAGE MODELS ────────────────────────────────────────────────────────────
//
// GPT image models bill by TOKEN, in three classes a text price cannot express:
// text input (the prompt), image input (reference images — none today) and
// image output (the picture). Their own table, so a text rate can never be
// applied to an image token or the other way round.
//
// DIRECTLY BILLED. `imageProvider` calls api.openai.com with OPENAI_API_KEY —
// no gateway between us and the vendor — so OpenAI's published rate IS the
// billing basis, the same reason `claude-haiku-4-5-20251001` may be priced and
// the gateway models may not.
//
// All three current models are listed, deliberately: `canonicalImageModelId`
// matches the longest known prefix, and with only `gpt-image-1` here a
// `gpt-image-1-mini` call would bill at 5x its rate and `gpt-image-1.5` at the
// wrong image rates.

/** USD per 1,000,000 tokens, per class. */
export interface ImageModelPrice {
  text_input_per_1m: number;
  cached_text_input_per_1m: number;
  image_input_per_1m: number;
  cached_image_input_per_1m: number;
  image_output_per_1m: number;
  billed_by: "openai";
  price_source: string;
  effective: string;
}

const OPENAI_IMAGE_PRICE_SOURCE =
  "OpenAI published API pricing, developers.openai.com/api/docs/pricing (Standard, per 1M tokens)";

export const IMAGE_MODEL_PRICES: Readonly<Record<string, ImageModelPrice>> = Object.freeze({
  "gpt-image-1": {
    text_input_per_1m: 5.00, cached_text_input_per_1m: 1.25,
    image_input_per_1m: 10.00, cached_image_input_per_1m: 2.50,
    image_output_per_1m: 40.00,
    billed_by: "openai", price_source: OPENAI_IMAGE_PRICE_SOURCE, effective: "2026-09-11",
  },
  "gpt-image-1-mini": {
    text_input_per_1m: 2.00, cached_text_input_per_1m: 0.20,
    image_input_per_1m: 2.50, cached_image_input_per_1m: 0.25,
    image_output_per_1m: 8.00,
    billed_by: "openai", price_source: OPENAI_IMAGE_PRICE_SOURCE, effective: "2026-09-11",
  },
  "gpt-image-1.5": {
    text_input_per_1m: 5.00, cached_text_input_per_1m: 1.25,
    image_input_per_1m: 8.00, cached_image_input_per_1m: 2.00,
    image_output_per_1m: 32.00,
    billed_by: "openai", price_source: OPENAI_IMAGE_PRICE_SOURCE, effective: "2026-09-11",
  },
});

export function canonicalImageModelId(model: string): string {
  const bare = String(model ?? "").trim().replace(/^[a-z0-9_-]+[/:]/i, "");
  if (IMAGE_MODEL_PRICES[bare]) return bare;
  const match = Object.keys(IMAGE_MODEL_PRICES)
    .filter((id) => bare.startsWith(id))
    .sort((a, b) => b.length - a.length)[0];
  return match ?? bare;
}

/** Token counts from an images response, split by class as the provider reports them. */
export interface ImageModelUsage {
  input_tokens: number | null;
  text_input_tokens: number | null;
  image_input_tokens: number | null;
  output_tokens: number | null;
}

/**
 * Read `usage` off an images response.
 *
 * Absent usage is reported as nulls — "the provider told us nothing" — which
 * `priceImageCall` refuses to turn into a price, exactly as `priceModelCall`
 * refuses to turn a missing count into a free call.
 */
export function readImageUsage(raw: unknown): ImageModelUsage {
  const u = (raw && typeof raw === "object"
    ? (raw as { usage?: Record<string, unknown> }).usage
    : null) ?? {};
  const d = (u.input_tokens_details ?? {}) as Record<string, unknown>;
  return {
    input_tokens: nonNeg(u.input_tokens),
    text_input_tokens: nonNeg(d.text_tokens),
    image_input_tokens: nonNeg(d.image_tokens),
    output_tokens: nonNeg(u.output_tokens),
  };
}

/**
 * What this image call cost, from the provider's own counts.
 *
 * Input the provider did not attribute to text or image is priced at the IMAGE
 * rate — the higher of the two. For a ceiling, overstating a few prompt tokens
 * is the safe direction; understating a reference image is not. Prompts are
 * text today, so a provider that splits the counts is priced exactly.
 */
export function priceImageCall(i: {
  model: string;
  usage: ImageModelUsage;
}): ExecutionCost & { model_id: string } {
  const model_id = canonicalImageModelId(i.model);
  const price = IMAGE_MODEL_PRICES[model_id];
  if (!price || (i.usage.input_tokens == null && i.usage.output_tokens == null)) {
    return { actual_usd: null, estimated_usd: null, source: "unknown", model_id };
  }
  const input = i.usage.input_tokens ?? 0;
  const text = Math.min(i.usage.text_input_tokens ?? 0, input);
  const image = Math.min(i.usage.image_input_tokens ?? 0, Math.max(0, input - text));
  const unattributed = Math.max(0, input - text - image);
  const output = i.usage.output_tokens ?? 0;
  const usd =
    (text / 1_000_000) * price.text_input_per_1m +
    ((image + unattributed) / 1_000_000) * price.image_input_per_1m +
    (output / 1_000_000) * price.image_output_per_1m;
  return { actual_usd: null, estimated_usd: round6(usd), source: "event_priced", model_id };
}

/**
 * Strip the vendor prefix and any dated suffix from a model id.
 *
 * `openai/gpt-5.6-luna`, `openai:gpt-4.1` and `gpt-4.1-2025-04-14` are the same
 * model billed at the same rate, and three ids for one price is three chances
 * to miss one.
 */
export function canonicalModelId(model: string): string {
  const bare = String(model ?? "").trim().replace(/^[a-z0-9_-]+[/:]/i, "");
  if (MODEL_PRICES[bare]) return bare;
  // A dated snapshot bills as its base model. Longest known prefix wins, so
  // `gpt-4.1-mini-2025-04-14` cannot be read as `gpt-4.1`.
  const match = Object.keys(MODEL_PRICES)
    .filter((id) => bare.startsWith(id))
    .sort((a, b) => b.length - a.length)[0];
  return match ?? bare;
}

/** Token counts as the provider reported them. */
export interface ModelUsage {
  input_tokens: number | null;
  /** The cached SUBSET of `input_tokens`, never additional to it. */
  cached_input_tokens: number | null;
  output_tokens: number | null;
}

const nonNeg = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
};

/**
 * Read usage off an OpenAI-shaped response.
 *
 * Both transports speak chat-completions, so one reader serves both. The cached
 * count lives in `prompt_tokens_details.cached_tokens`; its absence means "none
 * cached", which is what a provider that does not report caching looks like and
 * also what a genuine cache miss looks like. Those are indistinguishable from
 * here, and pricing them the same way — at the full input rate — is the
 * conservative direction.
 */
export function readModelUsage(raw: unknown): ModelUsage {
  const u = (raw && typeof raw === "object"
    ? (raw as { usage?: Record<string, unknown> }).usage
    : null) ?? {};
  const details = (u.prompt_tokens_details ?? u.input_tokens_details) as
    Record<string, unknown> | undefined;
  return {
    input_tokens: nonNeg(u.prompt_tokens) ?? nonNeg(u.input_tokens),
    cached_input_tokens: nonNeg(details?.cached_tokens) ?? 0,
    output_tokens: nonNeg(u.completion_tokens) ?? nonNeg(u.output_tokens),
  };
}

const round6 = (n: number) => Number(n.toFixed(6));

/**
 * What this model call cost.
 *
 * `cached_input_tokens` is treated as a SUBSET of `input_tokens` — the OpenAI
 * contract — so the uncached portion is the difference. Adding them would
 * double-count the cheap half and overstate a Luna call by up to 10%.
 *
 * An unknown model returns `unknown`, not zero: a model nobody priced is a hole
 * in the audit and must look like one.
 */
export function priceModelCall(i: {
  model: string;
  usage: ModelUsage;
}): ExecutionCost & { model_id: string } {
  const model_id = canonicalModelId(i.model);
  const price = MODEL_PRICES[model_id];
  if (!price) {
    return { actual_usd: null, estimated_usd: null, source: "unknown", model_id };
  }
  // NO USAGE REPORTED IS NOT A FREE CALL.
  //
  // A failed call — a 429, a timeout, a transport fault — parses no body and so
  // reports no counts. Pricing that as `event_priced: $0` would state that we
  // know it cost nothing, on the same provenance grade as a figure computed
  // from real counts. During an outage every row would read as a priced, free
  // call and the model bill would look untouched while nothing worked.
  //
  // `readModelUsage` already draws this distinction — "a response with no usage
  // reports nothing, not zero cost" — and this is the same rule one layer down.
  if (i.usage.input_tokens == null && i.usage.output_tokens == null) {
    return { actual_usd: null, estimated_usd: null, source: "unknown", model_id };
  }
  const input = i.usage.input_tokens ?? 0;
  const cached = Math.min(i.usage.cached_input_tokens ?? 0, input);
  const uncached = Math.max(0, input - cached);
  const output = i.usage.output_tokens ?? 0;

  const usd =
    (uncached / 1_000_000) * price.input_per_1m +
    (cached / 1_000_000) * price.cached_input_per_1m +
    (output / 1_000_000) * price.output_per_1m;

  // NEVER `provider_reported`: OpenAI returns counts, not a charge. The counts
  // are theirs, the prices are ours, and `event_priced` says exactly that.
  return { actual_usd: null, estimated_usd: round6(usd), source: "event_priced", model_id };
}

/**
 * Every field one model call is accounted for by.
 *
 * The logical ROLE is separate from the model, deliberately. "What did mission
 * compilation cost this month" and "what did Luna cost this month" are
 * different questions, and a routing change makes the second one useless for
 * answering the first.
 */
export interface ModelCallTelemetry {
  version: typeof MODEL_COST_MODEL_VERSION;
  /** The stage's name in the routing policy — never the model's name. */
  role: string;
  /** What actually ran, canonicalised. */
  model: string;
  /** As sent. Null for a model that takes no effort parameter. */
  reasoning_effort: string | null;
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  /** Only ever set if a provider begins reporting a charge. */
  actual_cost_usd: number | null;
  cost_source: ExecutionCost["source"];
  latency_ms: number;
  /** Why a cheaper or primary choice was not used. Null on the ordinary path. */
  fallback_reason: string | null;
}

export function buildModelTelemetry(i: {
  role: string;
  model: string;
  reasoning_effort?: string | null;
  usage: ModelUsage;
  latency_ms: number;
  fallback_reason?: string | null;
}): ModelCallTelemetry {
  const cost = priceModelCall({ model: i.model, usage: i.usage });
  return {
    version: MODEL_COST_MODEL_VERSION,
    role: i.role,
    model: cost.model_id,
    reasoning_effort: i.reasoning_effort ?? null,
    input_tokens: i.usage.input_tokens,
    cached_input_tokens: i.usage.cached_input_tokens,
    output_tokens: i.usage.output_tokens,
    // `ExecutionCost` leaves these optional; the telemetry record does not.
    // Absent is `null` — "not known" — never an omitted field a reader would
    // have to guess about.
    estimated_cost_usd: cost.estimated_usd ?? null,
    actual_cost_usd: cost.actual_usd ?? null,
    cost_source: cost.source,
    latency_ms: i.latency_ms,
    fallback_reason: i.fallback_reason ?? null,
  };
}

/** Roll a run's model calls into one line. Pure; derived, never stored twice. */
export function summarizeModelSpend(calls: readonly ModelCallTelemetry[]): {
  calls: number;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  by_role: Record<string, { calls: number; estimated_cost_usd: number }>;
  by_model: Record<string, { calls: number; estimated_cost_usd: number }>;
  unpriced_calls: number;
} {
  const by_role: Record<string, { calls: number; estimated_cost_usd: number }> = {};
  const by_model: Record<string, { calls: number; estimated_cost_usd: number }> = {};
  let input = 0, cached = 0, output = 0, usd = 0, unpriced = 0;
  for (const c of calls) {
    input += c.input_tokens ?? 0;
    cached += c.cached_input_tokens ?? 0;
    output += c.output_tokens ?? 0;
    usd += c.estimated_cost_usd ?? 0;
    if (c.cost_source === "unknown") unpriced++;
    for (const [bucket, key] of [[by_role, c.role], [by_model, c.model]] as const) {
      const b = bucket[key] ?? { calls: 0, estimated_cost_usd: 0 };
      b.calls++;
      b.estimated_cost_usd = round6(b.estimated_cost_usd + (c.estimated_cost_usd ?? 0));
      bucket[key] = b;
    }
  }
  return {
    calls: calls.length,
    input_tokens: input, cached_input_tokens: cached, output_tokens: output,
    estimated_cost_usd: round6(usd),
    by_role, by_model, unpriced_calls: unpriced,
  };
}
