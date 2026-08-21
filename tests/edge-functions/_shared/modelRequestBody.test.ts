// THE WALL BETWEEN HALF THE PIPELINE AND GPT-5.
//
// Agentory spoke to OpenAI down two transports that disagreed about what a
// request looks like:
//
//   gptProvider          temperature: 0, max_tokens, no reasoning_effort
//   leadStrategy/shared  reasoning_effort: "none", max_completion_tokens
//
// Not a style difference. `adapters/shared.ts` said why: "`reasoning_effort:
// "none"` is required by the gpt-5.6-* chat models. `max_tokens` / non-default
// `temperature` are rejected by GPT-5 models; only `max_completion_tokens` may
// cap the response."
//
// So the transport carrying mission compilation, discovery selection and
// execution planning could only speak to gpt-4.1 — pointing it at
// `gpt-5.6-luna` would 400 every request. That, and not any judgement about
// quality, is why those three stages were never moved. No comment anywhere
// said so.
//
// PHASE 2 CHANGES NO MODEL AND NO EFFORT. It removes the wall. Test 6 is the
// load-bearing one: the strategist's body is byte-identical to what it built
// before, so unifying two builders is provably not a behaviour change on the
// path that already works.
//
// ZERO network, ZERO models, ZERO database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildChatCompletionsBody, usesGpt5RequestShape,
} from "../../../supabase/functions/_shared/modelRequestBody.ts";
import {
  buildStrategistRequestBody,
} from "../../../supabase/functions/_shared/leadStrategy/adapters/shared.ts";

// ═══ 1. WHICH FAMILY A MODEL BELONGS TO ════════════════════════════════════

Deno.test("1. the GPT-5 family is recognised through every id shape used here", () => {
  for (const m of [
    "gpt-5.6-luna", "openai/gpt-5.6-luna", "openai:gpt-5.6-terra",
    "gpt-5.6-sol", "gpt-5", "gpt-5-mini", "GPT-5.6-LUNA",
  ]) {
    assert(usesGpt5RequestShape(m), `${m} takes the GPT-5 shape`);
  }
  for (const m of ["gpt-4.1", "gpt-4.1-mini", "openai/gpt-4.1", "gpt-4o"]) {
    assert(!usesGpt5RequestShape(m), `${m} takes the legacy shape`);
  }
});

// ═══ 2. THE TWO SHAPES, AND WHAT EACH MUST NOT CONTAIN ═════════════════════

Deno.test("2. a GPT-5 body carries effort and a completion cap, and NO temperature", () => {
  const b = buildChatCompletionsBody({
    model: "gpt-5.6-luna", systemPrompt: "s", userMessage: "u",
    maxOutputTokens: 1600, reasoningEffort: "low", temperature: 0,
  });
  assertEquals(b.reasoning_effort, "low");
  assertEquals(b.max_completion_tokens, 1600);
  assert(!("max_tokens" in b), "rejected outright by GPT-5");
  assert(!("temperature" in b),
    "a non-default value is rejected and the default is a field that can only cost a round trip");
});

Deno.test("3. a gpt-4.1 body carries temperature and max_tokens, and NO effort", () => {
  const b = buildChatCompletionsBody({
    model: "gpt-4.1", systemPrompt: "s", userMessage: "u",
    maxOutputTokens: 3000, reasoningEffort: "low",
  });
  assertEquals(b.temperature, 0);
  assertEquals(b.max_tokens, 3000);
  assert(!("max_completion_tokens" in b));
  assert(!("reasoning_effort" in b),
    "gpt-4.1 has no such parameter; an effort named for a 4.1 model is telemetry, not wire");
});

Deno.test("4. one caller field, two wire names", () => {
  // The entire reason a caller should not write this body by hand.
  const five = buildChatCompletionsBody({
    model: "gpt-5.6-terra", systemPrompt: "s", userMessage: "u", maxOutputTokens: 900,
  });
  const four = buildChatCompletionsBody({
    model: "gpt-4.1", systemPrompt: "s", userMessage: "u", maxOutputTokens: 900,
  });
  assertEquals(five.max_completion_tokens, 900);
  assertEquals(four.max_tokens, 900);
});

Deno.test("5. effort defaults to `none` for GPT-5, which is what this pipeline already sent", () => {
  const b = buildChatCompletionsBody({
    model: "gpt-5.6-luna", systemPrompt: "s", userMessage: "u",
  });
  assertEquals(b.reasoning_effort, "none",
    "not a new default invented here — the strategist has always sent this");
  assert(!("max_completion_tokens" in b), "no cap asked for, no cap sent");
});

// ═══ 3. THE LOAD-BEARING TEST ══════════════════════════════════════════════

Deno.test("6. the strategist's body is BYTE-IDENTICAL to what it built before", () => {
  // Verbatim reconstruction of the previous hand-written builder, including
  // field order. If unifying the two builders changed the working path at all,
  // this is where it shows.
  const call = {
    model: "openai/gpt-5.6-luna",
    systemPrompt: "you are a strategist",
    userMessage: '{"companies":[]}',
    maxCompletionTokens: 1600,
  };
  const previous = {
    model: call.model,
    messages: [
      { role: "system", content: call.systemPrompt },
      { role: "user", content: call.userMessage },
    ],
    reasoning_effort: "none",
    max_completion_tokens: 1600,
    response_format: { type: "json_object" },
  };
  assertEquals(
    JSON.stringify(buildStrategistRequestBody(call as never)),
    JSON.stringify(previous),
    "same fields, same values, same order — the high-volume path is untouched",
  );
});

Deno.test("7. and it still honours the wire-model override", () => {
  const call = { model: "openai/gpt-5.6-luna", systemPrompt: "s", userMessage: "u" };
  const b = buildStrategistRequestBody(call as never, "gpt-5.6-luna");
  assertEquals(b.model, "gpt-5.6-luna",
    "the canonical id and the wire id may differ, and the wire gets the wire one");
});

// ═══ 4. THE SCHEMA CONTRACT SURVIVES BOTH FAMILIES ═════════════════════════

Deno.test("8. a strict schema reaches either family unchanged", () => {
  const schema = { name: "lead_mission_proposal", schema: { type: "object" } };
  for (const model of ["gpt-4.1", "gpt-5.6-luna"]) {
    const b = buildChatCompletionsBody({
      model, systemPrompt: "s", userMessage: "u", schema,
    });
    assertEquals(b.response_format, {
      type: "json_schema",
      json_schema: { name: "lead_mission_proposal", strict: true, schema: { type: "object" } },
    }, `${model} keeps the strict contract`);
  }
});

Deno.test("9. no schema means json_object, on both families", () => {
  for (const model of ["gpt-4.1", "gpt-5.6-terra"]) {
    const b = buildChatCompletionsBody({ model, systemPrompt: "s", userMessage: "u" });
    assertEquals(b.response_format, { type: "json_object" });
  }
});

// ═══ 5. THE WALL IS ACTUALLY GONE ══════════════════════════════════════════

Deno.test("10. the planning transport can now address a GPT-5 model", () => {
  // The thing that was impossible. `gptProvider` built `temperature` and
  // `max_tokens` by hand, so this body would have 400'd.
  const b = buildChatCompletionsBody({
    model: "gpt-5.6-luna", systemPrompt: "plan the chain", userMessage: "{}",
    maxOutputTokens: 3000, reasoningEffort: "low",
    schema: { name: "lead_execution_plan", schema: { type: "object" } },
  });
  assert(!("temperature" in b) && !("max_tokens" in b),
    "neither field GPT-5 rejects is present");
  assertEquals(b.reasoning_effort, "low");
  assertEquals(b.max_completion_tokens, 3000);
});

Deno.test("11. neither transport writes a body by hand any more", () => {
  const provider = Deno.readTextFileSync(new URL(
    "../../../supabase/functions/_shared/gptProvider.ts", import.meta.url));
  const strategist = Deno.readTextFileSync(new URL(
    "../../../supabase/functions/_shared/leadStrategy/adapters/shared.ts", import.meta.url));

  // CHECKED ON THE WIRE NAMES, not on the caller's field names. The first
  // draft of this test flagged `temperature: req.temperature ?? null` — which
  // is the caller's value being PASSED to the builder, exactly as intended.
  // `max_tokens` and `max_completion_tokens` are pure wire spellings and should
  // now appear in one file only.
  const builder = Deno.readTextFileSync(new URL(
    "../../../supabase/functions/_shared/modelRequestBody.ts", import.meta.url));
  assert(builder.includes("max_tokens:") && builder.includes("max_completion_tokens:"),
    "the builder owns both spellings");

  for (const [name, src] of [["gptProvider", provider], ["strategist", strategist]] as const) {
    assert(src.includes("buildChatCompletionsBody("), `${name} uses the shared builder`);
    assert(!/\bmax_tokens:/.test(src), `${name} must not name the legacy wire field`);
    assert(!/\bmax_completion_tokens:/.test(src),
      `${name} must not name the GPT-5 wire field`);
    // `reasoning_effort:` is deliberately NOT checked. It is also the name of a
    // field on `ModelCallTelemetry` — which records the effort that was sent,
    // and so shares the spelling on purpose. A second draft of this test
    // flagged that as a hand-written body. The two token-cap spellings carry
    // the invariant on their own: they exist nowhere but the builder.
  }
});

Deno.test("12. PHASE 2 MOVED NO MODEL AND NO EFFORT", () => {
  // The capability is new; the routing is not. A capability change and a
  // routing change arriving together is how you lose the ability to say which
  // one broke something.
  const provider = Deno.readTextFileSync(new URL(
    "../../../supabase/functions/_shared/gptProvider.ts", import.meta.url));
  assert(provider.includes('export const GPT_MODEL = "gpt-4.1"'),
    "the reasoning tier is still gpt-4.1");
  assert(provider.includes('export const GPT_FAST_MODEL = "gpt-4.1-mini"'),
    "and the fast tier is still gpt-4.1-mini");

  const config = Deno.readTextFileSync(new URL(
    "../../../supabase/functions/_shared/leadStrategy/config.ts", import.meta.url));
  assert(config.includes('DEFAULT_PRIMARY_MODEL = "openai/gpt-5.6-luna"'),
    "and the strategist's primary is unchanged");
});
