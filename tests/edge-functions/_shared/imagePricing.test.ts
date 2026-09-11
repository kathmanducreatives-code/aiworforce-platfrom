// AN IMAGE IS PRICED, AND THE PRICE COUNTS TOWARD THE SPEND CEILING.
//
// Production, 2026-09-11: two gpt-image-1 generations were ledgered as
// `estimated_cost_usd: null, cost_source: unknown`. The ceiling sums
// `estimated_cost_usd`, so the most expensive call Content makes contributed
// nothing to it. GPT image models bill by token and report the tokens, so they
// are now priced like a text call: the provider's counts x OpenAI's published
// per-class rates. These tests pin the rates, the arithmetic, the refusal to
// invent a price, and that a priced image actually moves the ceiling.
//
// ZERO network (fetch is faked), ZERO database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  IMAGE_MODEL_PRICES, canonicalImageModelId, priceImageCall, readImageUsage,
} from "../../../supabase/functions/_shared/modelCostModel.ts";
import {
  createOpenAIImageProvider, imageTelemetryToModelTelemetry, type ImageCallTelemetry,
} from "../../../supabase/functions/_shared/imageProvider.ts";
import { authorizeModelSpend, type SpendDb } from "../../../supabase/functions/_shared/modelSpendCeiling.ts";

// ══════════ 1. the published rates ══════════════════════════════════════════

Deno.test("gpt-image rates are OpenAI's published list, sourced, dated and directly billed", () => {
  assertEquals(
    [IMAGE_MODEL_PRICES["gpt-image-1"].text_input_per_1m, IMAGE_MODEL_PRICES["gpt-image-1"].image_input_per_1m,
      IMAGE_MODEL_PRICES["gpt-image-1"].image_output_per_1m],
    [5.00, 10.00, 40.00],
  );
  for (const [id, p] of Object.entries(IMAGE_MODEL_PRICES)) {
    assertEquals(p.billed_by, "openai", id);
    assert(p.price_source.includes("developers.openai.com/api/docs/pricing"), id);
    assert(/^\d{4}-\d{2}-\d{2}$/.test(p.effective), `${id}: a price with no date is a rumour`);
  }
});

Deno.test("a sibling model is never billed at another model's rate", () => {
  assertEquals(canonicalImageModelId("gpt-image-1-mini"), "gpt-image-1-mini");
  assertEquals(canonicalImageModelId("gpt-image-1.5"), "gpt-image-1.5");
  assertEquals(canonicalImageModelId("openai/gpt-image-1"), "gpt-image-1");
  assertEquals(canonicalImageModelId("gpt-image-1-2025-04-15"), "gpt-image-1");
});

// ══════════ 2. the arithmetic, and the refusal to invent ═══════════════════

Deno.test("usage x per-class rate: text prompt at the text rate, the picture at the output rate", () => {
  const c = priceImageCall({
    model: "gpt-image-1",
    usage: { input_tokens: 50, text_input_tokens: 50, image_input_tokens: 0, output_tokens: 4160 },
  });
  // 50 x $5/1M + 4160 x $40/1M = 0.00025 + 0.1664
  assertEquals(c.estimated_usd, 0.16665);
  assertEquals(c.source, "event_priced");
  assertEquals(c.actual_usd, null, "OpenAI returns counts, not a charge");
});

Deno.test("unattributed input is priced at the higher image rate — the safe side of a ceiling", () => {
  const c = priceImageCall({
    model: "gpt-image-1",
    usage: { input_tokens: 100, text_input_tokens: null, image_input_tokens: null, output_tokens: 0 },
  });
  assertEquals(c.estimated_usd, 0.001); // 100 x $10/1M
});

Deno.test("no usage, or an unknown model: unknown — never a price, never zero", () => {
  const none = { input_tokens: null, text_input_tokens: null, image_input_tokens: null, output_tokens: null };
  assertEquals(priceImageCall({ model: "gpt-image-1", usage: none }).source, "unknown");
  assertEquals(priceImageCall({ model: "gpt-image-1", usage: none }).estimated_usd, null);
  const u = { input_tokens: 10, text_input_tokens: 10, image_input_tokens: 0, output_tokens: 100 };
  assertEquals(priceImageCall({ model: "dall-e-3", usage: u }).source, "unknown");
});

Deno.test("the images response usage is read with its nesting", () => {
  assertEquals(readImageUsage({ usage: {
    total_tokens: 4210, input_tokens: 50, output_tokens: 4160,
    input_tokens_details: { text_tokens: 50, image_tokens: 0 },
  } }), { input_tokens: 50, text_input_tokens: 50, image_input_tokens: 0, output_tokens: 4160 });
  assertEquals(readImageUsage({ data: [] }),
    { input_tokens: null, text_input_tokens: null, image_input_tokens: null, output_tokens: null });
});

// ══════════ 3. the provider reports the priced call ════════════════════════

const PNG_B64 = btoa("\x89PNG fake");
function run(body: Record<string, unknown>, env: Record<string, string> = {}, status = 200) {
  const calls: ImageCallTelemetry[] = [];
  const provider = createOpenAIImageProvider();
  const done = provider.generate({ prompt: "p", workspaceId: "ws" }, {
    readEnv: (k) => ({ OPENAI_API_KEY: "sk-test", ...env })[k],
    fetchImpl: (async () => new Response(JSON.stringify(body), { status })) as typeof fetch,
    onImageCall: (t) => { calls.push(t); },
  });
  return done.then((r) => ({ r, t: calls[0] }));
}
const USAGE = { input_tokens: 50, output_tokens: 4160, input_tokens_details: { text_tokens: 50, image_tokens: 0 } };

Deno.test("1. reported usage x published rate -> event_priced, with the tokens on the record", async () => {
  const { r, t } = await run({ data: [{ b64_json: PNG_B64 }], usage: USAGE });
  assert(r.ok);
  assertEquals([t.estimated_cost_usd, t.cost_source, t.input_tokens, t.output_tokens], [0.16665, "event_priced", 50, 4160]);
});

Deno.test("reported usage outranks a configured flat price", async () => {
  const { t } = await run({ data: [{ b64_json: PNG_B64 }], usage: USAGE }, { OPENAI_IMAGE_USD_PER_IMAGE: "0.01" });
  assertEquals(t.estimated_cost_usd, 0.16665);
});

Deno.test("2. no usage, operator price set -> that price; 3. neither -> unknown, never free", async () => {
  const flat = await run({ data: [{ b64_json: PNG_B64 }] }, { OPENAI_IMAGE_USD_PER_IMAGE: "0.042" });
  assertEquals([flat.t.estimated_cost_usd, flat.t.cost_source], [0.042, "event_priced"]);
  const bare = await run({ data: [{ b64_json: PNG_B64 }] });
  assertEquals([bare.t.estimated_cost_usd, bare.t.cost_source], [null, "unknown"]);
});

Deno.test("a failed call produced nothing to price: unknown, zero images", async () => {
  const { r, t } = await run({ error: { message: "rate limited" } }, {}, 429);
  assert(!r.ok);
  assertEquals([t.images, t.estimated_cost_usd, t.cost_source, t.failure_code], [0, null, "unknown", "http_429"]);
});

Deno.test("the ledger row carries the price and the counts", async () => {
  const { t } = await run({ data: [{ b64_json: PNG_B64 }], usage: USAGE });
  const m = imageTelemetryToModelTelemetry(t);
  assertEquals([m.role, m.model, m.estimated_cost_usd, m.cost_source, m.input_tokens, m.output_tokens],
    ["content_visual", "gpt-image-1", 0.16665, "event_priced", 50, 4160]);
});

// ══════════ 4. and it counts toward the ceiling ═══════════════════════════

function spendDb(rows: Array<Record<string, unknown>>): SpendDb {
  return { from: () => ({ select: () => ({ eq: () => ({ gte: async () => ({ data: rows, error: null }) }) }) }) };
}

Deno.test("a priced image moves spent_usd and trips the ceiling; the unpriced one did not", async () => {
  const text = { estimated_cost_usd: 0.004984, actual_cost_usd: null, cost_source: "event_priced" };
  const before = await authorizeModelSpend({
    db: spendDb([text, { estimated_cost_usd: null, actual_cost_usd: null, cost_source: "unknown" }]),
    workspace_id: "ws", mode: "enforce", ceiling_usd: 0.1,
  });
  assertEquals([before.spent_usd, before.unpriced_calls, before.over_ceiling], [0.004984, 1, false],
    "the old behaviour: the image was invisible to the meter");
  const { t } = await run({ data: [{ b64_json: PNG_B64 }], usage: USAGE });
  const image = imageTelemetryToModelTelemetry(t);
  const after = await authorizeModelSpend({
    db: spendDb([text, { estimated_cost_usd: image.estimated_cost_usd, actual_cost_usd: null, cost_source: image.cost_source }]),
    workspace_id: "ws", mode: "enforce", ceiling_usd: 0.1,
  });
  assertEquals([after.spent_usd, after.unpriced_calls, after.over_ceiling, after.allowed], [0.171634, 0, true, false]);
});

Deno.test("THE METER READS PRODUCTION-SHAPED ROWS: actual NULL falls through to the estimate", async () => {
  // Every real model row: actual_cost_usd NULL, estimated_cost_usd set. The
  // meter used to take Number(null) === 0 as a reported charge and sum $0.
  const rows = [
    { estimated_cost_usd: 0.004984, actual_cost_usd: null, cost_source: "event_priced" },
    { estimated_cost_usd: "0.004645", actual_cost_usd: null, cost_source: "event_priced" }, // numeric as text, as PostgREST may send
    { estimated_cost_usd: null, actual_cost_usd: null, cost_source: "unknown" },
    { estimated_cost_usd: 99, actual_cost_usd: 3, cost_source: "provider_reported" },   // a reported charge still wins
  ];
  const v = await authorizeModelSpend({ db: spendDb(rows), workspace_id: "ws", mode: "observe", ceiling_usd: 25 });
  assertEquals([v.spent_usd, v.unpriced_calls], [3.009629, 1]);
});

// ══════════ 5. a failure says why, in words ═══════════════════════════════

Deno.test("an out-of-credits refusal reaches the user as OpenAI's own sentence, not a JSON blob", async () => {
  // Verbatim production body, 2026-09-11 16:25.
  const body = { error: {
    message: "You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.",
    type: "insufficient_quota", param: null, code: "credit_balance_exhausted",
  } };
  const { r, t } = await run(body, {}, 429);
  assertEquals(r.error,
    "OpenAI images 429: You have no credits remaining. Add credits to continue using the API at " +
    "https://platform.openai.com/settings/organization/billing/. (credit_balance_exhausted)");
  assertEquals([t.cost_source, t.estimated_cost_usd], ["unknown", null], "a refused call is not priced");
});
