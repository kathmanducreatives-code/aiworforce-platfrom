// HYBRID ROUTING · BILLING. Permanent regression tests for every pricing
// correction made 2026-11-11 against the vendors' published pages. Pure; no network.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isModelPriced, MODEL_PRICES, priceExpired, priceModelCall, readModelUsage, buildModelTelemetry, type ModelUsage,
} from "../../../../supabase/functions/_shared/modelCostModel.ts";

const usd = (model: string, usage: Partial<ModelUsage>, now = new Date("2026-11-11T12:00:00Z")) =>
  priceModelCall({ model, usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, ...usage } as ModelUsage, now });
const close = (a: number | null | undefined, b: number) => assert(a != null && Math.abs(a - b) < 1e-9, `${a} != ${b}`);

Deno.test("billing: GPT-6.1 Terra list price — input, cached input, cache write, output", () => {
  const p = MODEL_PRICES["gpt-6.1-terra"];
  assertEquals([p.input_per_1m, p.cached_input_per_1m, p.cache_write_per_1m, p.output_per_1m], [1, 0.05, 1.25, 5]);
  // 10K in of which 4K cached and 2K written; 1K out.
  close(usd("gpt-6.1-terra", { input_tokens: 10_000, cached_input_tokens: 4_000, cache_write_input_tokens: 2_000, output_tokens: 1_000 }).estimated_usd,
    (4_000 * 1 + 4_000 * 0.05 + 2_000 * 1.25 + 1_000 * 5) / 1e6);
  // A dated snapshot bills as its base model.
  assertEquals(usd("gpt-6.1-terra-2026-12-01", { input_tokens: 1000, output_tokens: 0 }).model_id, "gpt-6.1-terra");
});

Deno.test("billing: reasoning tokens are part of output — billed once, and visible in telemetry", () => {
  const raw = { usage: { prompt_tokens: 1000, completion_tokens: 900, completion_tokens_details: { reasoning_tokens: 600 } } };
  const u = readModelUsage(raw);
  assertEquals(u.output_tokens, 900);
  assertEquals(u.reasoning_tokens, 600);
  close(priceModelCall({ model: "gpt-6.1-terra", usage: u }).estimated_usd, (1000 * 1 + 900 * 5) / 1e6);
  const t = buildModelTelemetry({ role: "x", model: "gpt-6.1-terra", usage: u, latency_ms: 1, reasoning_effort: "low" });
  assertEquals(t.reasoning_tokens, 600);
  assertEquals(t.reasoning_effort, "low");
});

Deno.test("billing: the >272K long-prompt surcharge applies to the whole request (Terra, Sol)", () => {
  close(usd("gpt-6.1-terra", { input_tokens: 272_000, output_tokens: 1_000 }).estimated_usd, (272_000 * 1 + 1_000 * 5) / 1e6);
  close(usd("gpt-6.1-terra", { input_tokens: 300_000, output_tokens: 1_000 }).estimated_usd, (300_000 * 2 + 1_000 * 7.5) / 1e6);
  close(usd("gpt-6.1-sol", { input_tokens: 300_000, output_tokens: 1_000 }).estimated_usd, (300_000 * 4 + 1_000 * 15) / 1e6);
});

Deno.test("billing: gpt-5.6-sol corrected to the published promotional $4 / $0.40 / $20, and it expires", () => {
  const p = MODEL_PRICES["gpt-5.6-sol"];
  assertEquals([p.input_per_1m, p.cached_input_per_1m, p.output_per_1m, p.cache_write_per_1m], [4, 0.4, 20, 5]);
  close(usd("gpt-5.6-sol", { input_tokens: 1_000, output_tokens: 1_000 }).estimated_usd, (1_000 * 4 + 1_000 * 20) / 1e6);
  // After the promotion the old rate is NOT assumed: the call reads unknown (bounded by the run budget).
  const after = new Date("2026-12-01T00:00:00Z");
  assert(priceExpired(p, after));
  assertEquals(usd("gpt-5.6-sol", { input_tokens: 1_000, output_tokens: 1_000 }, after).source, "unknown");
  assertEquals(isModelPriced("gpt-5.6-sol", after), false);
  assertEquals(isModelPriced("gpt-5.6-sol", new Date("2026-11-30T23:00:00Z")), true);
});

Deno.test("billing: GPT-5.6 cache writes now bill at the published write rate", () => {
  close(usd("gpt-5.6-luna", { input_tokens: 10_000, cache_write_input_tokens: 10_000 }).estimated_usd, 10_000 * 0.25 / 1e6);
  close(usd("gpt-5.6-terra", { input_tokens: 10_000, cache_write_input_tokens: 10_000 }).estimated_usd, 10_000 * 2.5 / 1e6);
});

Deno.test("billing: Claude Haiku 5.5 priced (benchmark/accounting only) with its >100K tier", () => {
  close(usd("claude-haiku-5-5", { input_tokens: 10_000, output_tokens: 1_000 }).estimated_usd, (10_000 * 0.1 + 1_000 * 0.5) / 1e6);
  close(usd("claude-haiku-5-5", { input_tokens: 150_000, output_tokens: 1_000 }).estimated_usd, (150_000 * 0.5 + 1_000 * 2.5) / 1e6);
  // Haiku 4.5 unchanged.
  close(usd("claude-haiku-4-5-20251001", { input_tokens: 10_000, output_tokens: 1_000 }).estimated_usd, (10_000 * 1 + 1_000 * 5) / 1e6);
});

Deno.test("billing: Anthropic usage — cache reads and writes are ADDED to input_tokens, then priced as subsets", () => {
  const u = readModelUsage({ usage: { input_tokens: 500, cache_read_input_tokens: 3_000, cache_creation_input_tokens: 1_000, output_tokens: 200 } });
  assertEquals([u.input_tokens, u.cached_input_tokens, u.cache_write_input_tokens, u.output_tokens], [4_500, 3_000, 1_000, 200]);
  close(priceModelCall({ model: "claude-haiku-4-5-20251001", usage: u }).estimated_usd,
    (500 * 1 + 3_000 * 0.1 + 1_000 * 1.25 + 200 * 5) / 1e6);
  // A plain Anthropic response (today's shape, no cache fields) reads exactly as before.
  const plain = readModelUsage({ usage: { input_tokens: 3153, output_tokens: 308 } });
  assertEquals([plain.input_tokens, plain.cached_input_tokens, plain.output_tokens], [3153, 0, 308]);
});

Deno.test("billing: failed calls and unknown models are unknown, never $0", () => {
  assertEquals(priceModelCall({ model: "gpt-6.1-terra", usage: readModelUsage(undefined) }).source, "unknown");
  assertEquals(usd("gpt-9-imaginary", { input_tokens: 10 }).source, "unknown");
  assertEquals(isModelPriced("gpt-9-imaginary"), false);
});
