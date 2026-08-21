// WHAT THE MODELS COST, WHICH NOTHING HAS EVER RECORDED.
//
// ── THE STATE THIS REPLACES ─────────────────────────────────────────────────
//
// Neither transport read `usage` off a response. Not `prompt_tokens`, not
// `completion_tokens`, not the cached-input count. Path B was already CARRYING
// `usage: data?.usage` on its result and nothing priced it; Path A never parsed
// it at all. So a run could be audited for Apify dollars to the cent and could
// not answer "what did the models cost?" in any form.
//
// That is why the routing question could not be settled: every claim about
// which model to use was an argument about prices nobody tracked against
// volumes nobody counted.
//
// ── AND THE PRICES CONTRADICT THE INTUITION ─────────────────────────────────
//
//     gpt-4.1        $2.00 in / $8.00 out
//     gpt-5.6-terra  $2.00 in / $12.00 out   1.5x the OUTPUT of 4.1
//     gpt-5.6-luna   $0.20 in / $1.20 out    10x / 6.7x cheaper than 4.1
//
// A newer model is not automatically a cheaper one. Moving the planning stages
// from 4.1 to Terra would RAISE the model bill. Whether that is right depends
// on whether a cheaper planner buys a worse Apify pool — which these numbers
// make measurable and do not answer.
//
// ZERO network, ZERO database, ZERO model calls.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  MODEL_PRICES, canonicalModelId, readModelUsage, priceModelCall,
  buildModelTelemetry, summarizeModelSpend,
} from "../../../supabase/functions/_shared/modelCostModel.ts";

// ═══ 1. THE ID IS NORMALISED BEFORE IT IS PRICED ═══════════════════════════

Deno.test("1. both transports' id shapes reach the same price", () => {
  // Path A sends `gpt-4.1`; Path B sends `openai/gpt-5.6-luna`; the mission
  // compiler builds `openai:gpt-4.1`. Three shapes, and a table that had to
  // know about all of them would be a table with three chances to miss one.
  assertEquals(canonicalModelId("gpt-4.1"), "gpt-4.1");
  assertEquals(canonicalModelId("openai/gpt-5.6-luna"), "gpt-5.6-luna");
  assertEquals(canonicalModelId("openai:gpt-4.1"), "gpt-4.1");
  assertEquals(canonicalModelId("  openai/gpt-5.6-terra  "), "gpt-5.6-terra");
});

Deno.test("2. a dated snapshot bills as its base, and the LONGEST match wins", () => {
  assertEquals(canonicalModelId("gpt-4.1-2025-04-14"), "gpt-4.1");
  assertEquals(canonicalModelId("gpt-4.1-mini-2025-04-14"), "gpt-4.1-mini",
    "the shorter prefix `gpt-4.1` also matches; taking it would price mini at 5x");
});

// ═══ 2. USAGE IS READ AS OPENAI REPORTS IT ═════════════════════════════════

Deno.test("3. usage is read, including the cached subset", () => {
  const u = readModelUsage({
    usage: {
      prompt_tokens: 12_000, completion_tokens: 800,
      prompt_tokens_details: { cached_tokens: 10_000 },
    },
  });
  assertEquals(u, { input_tokens: 12_000, cached_input_tokens: 10_000, output_tokens: 800 });
});

Deno.test("4. a response with no usage reports nothing, not zero cost", () => {
  const u = readModelUsage({ choices: [] });
  assertEquals(u.input_tokens, null);
  assertEquals(u.output_tokens, null);
  assertEquals(u.cached_input_tokens, 0, "no cache reported is no cache used");
});

// ═══ 3. THE ARITHMETIC THAT WILL DECIDE THE ROUTING ════════════════════════

Deno.test("5. cached input is a SUBSET, never an addition", () => {
  // 12k input of which 10k cached, on Luna:
  //   2,000 × $0.20/1M + 10,000 × $0.02/1M + 800 × $1.20/1M
  //   = 0.0004 + 0.0002 + 0.00096 = 0.00156
  const c = priceModelCall({
    model: "openai/gpt-5.6-luna",
    usage: { input_tokens: 12_000, cached_input_tokens: 10_000, output_tokens: 800 },
  });
  assertEquals(c.estimated_usd, 0.00156);

  // Adding them instead would charge the cheap half twice and overstate it.
  const naive = (12_000 / 1e6) * 0.20 + (10_000 / 1e6) * 0.02 + (800 / 1e6) * 1.20;
  assert(naive > c.estimated_usd!, "the wrong arithmetic is more expensive, which is how it hides");
});

Deno.test("6. cached is clamped to input — a provider cannot cache more than it was sent", () => {
  const c = priceModelCall({
    model: "gpt-5.6-luna",
    usage: { input_tokens: 1_000, cached_input_tokens: 5_000, output_tokens: 0 },
  });
  // All 1,000 priced as cached; none double-counted, none negative.
  assertEquals(c.estimated_usd, Number(((1_000 / 1e6) * 0.02).toFixed(6)));
});

Deno.test("7. THE ROUTING QUESTION, in numbers", () => {
  // One execution-plan call at its observed shape: a large stable system
  // prompt, a 3,000-token cap. Same tokens, three models.
  const usage = { input_tokens: 16_000, cached_input_tokens: 0, output_tokens: 1_500 };
  const on = (m: string) => priceModelCall({ model: m, usage }).estimated_usd!;

  const four1 = on("gpt-4.1");
  const terra = on("gpt-5.6-terra");
  const luna = on("gpt-5.6-luna");

  assert(terra > four1,
    `Terra is MORE expensive than 4.1 here (${terra} vs ${four1}) — the hypothesis that ` +
    "a newer model is a cheaper one does not survive the price table");
  assert(luna < four1 / 5,
    `Luna is far cheaper (${luna} vs ${four1}), which is where the saving actually is`);
});

Deno.test("8. an unpriced model is UNKNOWN, never free", () => {
  const c = priceModelCall({
    model: "gpt-6-unreleased",
    usage: { input_tokens: 50_000, cached_input_tokens: 0, output_tokens: 5_000 },
  });
  assertEquals(c.source, "unknown");
  assertEquals(c.estimated_usd, null,
    "a model nobody priced is a hole in the audit and must look like one");
});

Deno.test("9. a model call is NEVER provider_reported", () => {
  // OpenAI returns counts, not a charge. The counts are theirs, the prices are
  // ours, and `event_priced` says exactly that.
  for (const m of Object.keys(MODEL_PRICES)) {
    const c = priceModelCall({
      model: m, usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 10 },
    });
    assertEquals(c.source, "event_priced");
    assertEquals(c.actual_usd, null, "and actual_cost_usd stays null, as the database requires");
  }
});

// ═══ 4. THE RECORD ITSELF ══════════════════════════════════════════════════

Deno.test("10. every field the audit asked for is on the record", () => {
  const t = buildModelTelemetry({
    role: "mission_compilation",
    model: "openai:gpt-4.1",
    reasoning_effort: null,
    usage: { input_tokens: 9_000, cached_input_tokens: 4_000, output_tokens: 600 },
    latency_ms: 5_272,
  });
  for (const k of [
    "role", "model", "reasoning_effort", "input_tokens", "cached_input_tokens",
    "output_tokens", "estimated_cost_usd", "actual_cost_usd", "cost_source",
    "latency_ms", "fallback_reason",
  ]) {
    assert(k in t, `missing ${k}`);
  }
  assertEquals(t.model, "gpt-4.1", "recorded canonicalised, so it groups");
  assertEquals(t.role, "mission_compilation", "and the ROLE is not the model");
  assertEquals(t.fallback_reason, null, "null on the ordinary path");
});

Deno.test("11. the role survives a routing change; the model does not", () => {
  // The whole reason both are recorded: "what did qualification cost" must stay
  // answerable after qualification moves to a different model.
  const a = buildModelTelemetry({
    role: "company_qualification", model: "gpt-4.1",
    usage: { input_tokens: 1_000, cached_input_tokens: 0, output_tokens: 100 }, latency_ms: 1,
  });
  const b = buildModelTelemetry({
    role: "company_qualification", model: "openai/gpt-5.6-luna",
    usage: { input_tokens: 1_000, cached_input_tokens: 0, output_tokens: 100 }, latency_ms: 1,
  });
  const s = summarizeModelSpend([a, b]);
  assertEquals(s.by_role["company_qualification"].calls, 2, "one stage, whatever ran it");
  assertEquals(Object.keys(s.by_model).sort(), ["gpt-4.1", "gpt-5.6-luna"]);
});

// ═══ 5. A RUN'S MODEL BILL ═════════════════════════════════════════════════

Deno.test("12. a run rolls up by role and by model, and names what it could not price", () => {
  const call = (role: string, model: string, out: number) => buildModelTelemetry({
    role, model, usage: { input_tokens: 10_000, cached_input_tokens: 8_000, output_tokens: out },
    latency_ms: 1_000,
  });
  // The observed shape of the clean 10/10 run: 4 triage batches, 2 evaluations,
  // 1 execution plan, plus one call on a model nobody priced.
  const s = summarizeModelSpend([
    ...Array.from({ length: 4 }, () => call("mission_triage", "openai/gpt-5.6-luna", 400)),
    ...Array.from({ length: 2 }, () => call("mission_evaluation", "openai/gpt-5.6-luna", 900)),
    call("execution_plan", "gpt-4.1", 1_500),
    call("some_new_stage", "gpt-6-unreleased", 100),
  ]);

  assertEquals(s.calls, 8);
  assertEquals(s.by_role["mission_triage"].calls, 4);
  assertEquals(s.unpriced_calls, 1, "one call could not be priced, and the roll-up says so");
  assertEquals(s.cached_input_tokens, 64_000);

  // The single 4.1 call outweighs all six Luna calls put together — which is
  // the finding the whole audit turns on.
  assert(s.by_model["gpt-4.1"].estimated_cost_usd >
    s.by_model["gpt-5.6-luna"].estimated_cost_usd,
    "one planning call on 4.1 costs more than six high-volume calls on Luna");
});

// ═══ 6. BOTH TRANSPORTS REPORT, AND NEITHER CAN DRIFT ══════════════════════

Deno.test("13. both transports emit telemetry from the same builder", () => {
  const provider = Deno.readTextFileSync(new URL(
    "../../../supabase/functions/_shared/gptProvider.ts", import.meta.url));
  const strategist = Deno.readTextFileSync(new URL(
    "../../../supabase/functions/_shared/leadStrategy/adapters/shared.ts", import.meta.url));

  assert(provider.includes("buildModelTelemetry("), "path A reports");
  assert(strategist.includes("buildModelTelemetry("), "path B reports");
  assert(provider.includes("readModelUsage("), "and both read usage rather than assuming it");
  assert(strategist.includes("readModelUsage("));
});

Deno.test("14. usage is read BEFORE the content is parsed", () => {
  // A response whose content fails to parse still consumed tokens and was still
  // billed. Reading usage after the parse would lose exactly the calls worth
  // knowing about.
  const src = Deno.readTextFileSync(new URL(
    "../../../supabase/functions/_shared/gptProvider.ts", import.meta.url));
  const usageAt = src.indexOf("const usage = readModelUsage(");
  const contentAt = src.indexOf("content = choice?.content");
  assert(usageAt !== -1 && contentAt !== -1);
  assert(usageAt < contentAt, "a failed parse is still a paid call");
});

Deno.test("15. the effort reported is the effort SENT", () => {
  // Path B builds the request body once and reads the field back off it. A
  // second build to inspect it could disagree with the one that went out.
  const src = Deno.readTextFileSync(new URL(
    "../../../supabase/functions/_shared/leadStrategy/adapters/shared.ts", import.meta.url));
  assertEquals(src.split("buildStrategistRequestBody(call").length - 1, 1,
    "built exactly once, so telemetry cannot describe a body that was not sent");
  assert(src.includes("sentEffort"));
});
