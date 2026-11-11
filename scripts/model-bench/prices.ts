// VERIFIED LIST PRICES FOR THE TERRA AUDIT (USD per 1M tokens, Standard tier).
//
// Read 2026-11-11 from the vendors' own pages:
//   OpenAI    https://developers.openai.com/api/docs/pricing
//             https://developers.openai.com/api/docs/models/gpt-6.1-terra
//   Anthropic https://platform.claude.com/docs/en/about-claude/pricing
//
// BENCH/AUDIT ONLY. The runtime table is `supabase/functions/_shared/modelCostModel.ts`
// MODEL_PRICES; it is NOT changed by this audit. Differences found:
//   * gpt-6.1-terra   absent from the runtime table (priced only via AGENTORY_TERRA_PRICE_USD_PER_1M)
//   * gpt-5.6-sol     runtime $5 / $0.50 / $30   vs published $4 / $0.40 / $20
//   * claude-haiku-5-5 absent (not used today)
// `cache_write` is the 30-minute cache-write rate where the vendor bills writes.

export interface ListPrice {
  input: number; cached_input: number; output: number; cache_write?: number;
  vendor: "openai" | "anthropic"; batch_discount: number; note?: string;
}

export const LIST_PRICES: Readonly<Record<string, ListPrice>> = Object.freeze({
  "gpt-6.1-terra": { input: 1.00, cached_input: 0.05, output: 5.00, cache_write: 1.25, vendor: "openai", batch_discount: 0.5,
    note: ">272K-token prompts bill 2x input / 1.5x output; Fast mode 2x" },
  "gpt-6.1-sol": { input: 2.00, cached_input: 0.10, output: 10.00, cache_write: 2.50, vendor: "openai", batch_discount: 0.5 },
  "gpt-6-luna": { input: 0.10, cached_input: 0.01, output: 0.50, cache_write: 0.125, vendor: "openai", batch_discount: 0.5 },
  "gpt-5.6-luna": { input: 0.20, cached_input: 0.02, output: 1.20, vendor: "openai", batch_discount: 0.5 },
  "gpt-5.6-terra": { input: 2.00, cached_input: 0.20, output: 12.00, vendor: "openai", batch_discount: 0.5 },
  "gpt-5.6-sol": { input: 4.00, cached_input: 0.40, output: 20.00, vendor: "openai", batch_discount: 0.5 },
  "gpt-4.1-mini": { input: 0.40, cached_input: 0.10, output: 1.60, vendor: "openai", batch_discount: 0.5 },
  "claude-haiku-4-5-20251001": { input: 1.00, cached_input: 0.10, output: 5.00, cache_write: 1.25, vendor: "anthropic", batch_discount: 0.5 },
  "claude-haiku-5-5": { input: 0.10, cached_input: 0.01, output: 0.50, cache_write: 0.125, vendor: "anthropic", batch_discount: 0.5,
    note: "prompts over 100K tokens bill $0.50 / $2.50" },
  "claude-sonnet-5-5": { input: 2.00, cached_input: 0.10, output: 10.00, cache_write: 2.50, vendor: "anthropic", batch_discount: 0.5 },
});

/** USD for one call. Reasoning tokens bill as output. Cached tokens are a subset of `input`. */
export function callCost(model: string, c: { input: number; output: number; cached?: number; reasoning?: number }): number {
  const p = LIST_PRICES[model];
  if (!p) throw new Error(`unpriced model ${model}`);
  const cached = Math.min(c.cached ?? 0, c.input);
  return ((c.input - cached) * p.input + cached * p.cached_input + (c.output + (c.reasoning ?? 0)) * p.output) / 1e6;
}
