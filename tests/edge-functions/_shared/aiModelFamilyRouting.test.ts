// Model family switch (AGENTORY_GPT_MODEL_FAMILY), the GPT-6 request shape,
// the Sol effort floor, GPT-6 pricing and the per-run escalation budget.
// Pure: no network, no model.
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  activeModelFamily, DEFAULT_MODEL_FAMILY, escalationRoute, GPT_STAGES, isDeterministicStage, LUNA, MODEL_FAMILY_ENV,
  routeModel, routingTable, SOL, TERRA,
} from "../../../supabase/functions/_shared/gptModelRouter.ts";
import { buildChatCompletionsBody, minimumReasoningEffort, usesGpt5RequestShape } from "../../../supabase/functions/_shared/modelRequestBody.ts";
import { canonicalModelId, MODEL_PRICES } from "../../../supabase/functions/_shared/modelCostModel.ts";
import { EscalationBudget, runWithEscalation } from "../../../supabase/functions/_shared/modelEscalation.ts";

const env = (v?: string) => (k: string) => (k === MODEL_FAMILY_ENV ? v : undefined);

Deno.test("family: unset, empty and unknown values resolve to the default — a typo never reaches an unchosen model", () => {
  assertEquals(DEFAULT_MODEL_FAMILY, "gpt-5.6");
  for (const v of [undefined, "", "gpt6", "GPT-6", "gpt-7", "sol"]) assertEquals(activeModelFamily(env(v)), "gpt-5.6", String(v));
  assertEquals(activeModelFamily(env("gpt-6")), "gpt-6");
});

Deno.test("family default: every route is unchanged — same models, efforts and no family field", () => {
  for (const r of routingTable("gpt-5.6")) {
    assert([LUNA, TERRA].includes(r.model as typeof LUNA), `${r.stage} → ${r.model}`);
    assertEquals("model_family" in r, false, `${r.stage} carries no family on the default`);
    assert(!r.reason.includes("effort raised"));
  }
  assert(routingTable("gpt-5.6").every((r) => r.model !== SOL), "Sol has no normal production route in gpt-5.6");
});

Deno.test("family gpt-6: Luna first, Sol only as the one escalation rung, and the same stages escalate", () => {
  for (const stage of GPT_STAGES) {
    if (isDeterministicStage(stage)) continue;
    const a = routeModel(stage, {}, "gpt-5.6"), b = routeModel(stage, {}, "gpt-6");
    assertEquals(b.model, a.model === LUNA ? "gpt-6-luna" : "gpt-6.1-sol", stage);
    assertEquals(b.model_family, "gpt-6");
    const ea = escalationRoute(stage, "validator said no", {}, "gpt-5.6");
    const eb = escalationRoute(stage, "validator said no", {}, "gpt-6");
    assertEquals(eb === null, ea === null, `${stage}: escalation policy does not change with the family`);
    if (eb) {
      assertEquals(eb.model, "gpt-6.1-sol");
      assertEquals(eb.escalation_reason, "validator said no", "the validator's reason is carried verbatim");
    }
  }
});

Deno.test("Sol never receives reasoning_effort none: the router raises it to low and says so; the body builder refuses it", () => {
  assertEquals(minimumReasoningEffort("gpt-6.1-sol"), "low");
  assertEquals(minimumReasoningEffort("openai/gpt-6.1-sol"), "low");
  assertEquals(minimumReasoningEffort("gpt-6-luna"), null);
  for (const stage of GPT_STAGES) {
    if (isDeterministicStage(stage)) continue;
    for (const r of [routeModel(stage, {}, "gpt-6"), escalationRoute(stage, "x", {}, "gpt-6")]) {
      if (r?.model === "gpt-6.1-sol") assert(r.reasoning_effort !== "none" && r.reasoning_effort !== null, `${stage}`);
    }
  }
  assertThrows(() => buildChatCompletionsBody({ model: "gpt-6.1-sol", systemPrompt: "s", userMessage: "u" }), Error, "does not accept");
  assertThrows(() => buildChatCompletionsBody({ model: "gpt-6.1-sol", systemPrompt: "s", userMessage: "u", reasoningEffort: "none" }));
});

Deno.test("GPT-6 takes the reasoning-model request shape (no temperature, max_completion_tokens, reasoning_effort)", () => {
  assert(usesGpt5RequestShape("gpt-6-luna") && usesGpt5RequestShape("openai/gpt-6.1-sol"));
  const body = buildChatCompletionsBody({ model: "gpt-6-luna", systemPrompt: "s", userMessage: "u", maxOutputTokens: 100, temperature: 0 });
  assertEquals(body.reasoning_effort, "none");
  assertEquals(body.max_completion_tokens, 100);
  assertEquals("temperature" in body || "max_tokens" in body, false);
  const sol = buildChatCompletionsBody({ model: "gpt-6.1-sol", systemPrompt: "s", userMessage: "u", reasoningEffort: "low" });
  assertEquals(sol.reasoning_effort, "low");
  // gpt-4.1 is untouched.
  const old = buildChatCompletionsBody({ model: "gpt-4.1", systemPrompt: "s", userMessage: "u", maxOutputTokens: 10 });
  assertEquals([old.temperature, old.max_tokens, "reasoning_effort" in old], [0, 10, false]);
});

Deno.test("GPT-6 models are priced before they can be routed to (an unpriced model counts $0 against the ceiling)", () => {
  assertEquals(MODEL_PRICES["gpt-6-luna"].input_per_1m, 0.10);
  assertEquals(MODEL_PRICES["gpt-6-luna"].cached_input_per_1m, 0.01);
  assertEquals(MODEL_PRICES["gpt-6-luna"].output_per_1m, 0.50);
  assertEquals([MODEL_PRICES["gpt-6.1-sol"].input_per_1m, MODEL_PRICES["gpt-6.1-sol"].output_per_1m], [2.00, 10.00]);
  assertEquals(canonicalModelId("openai/gpt-6-luna"), "gpt-6-luna");
  assertEquals(canonicalModelId("gpt-6.1-sol"), "gpt-6.1-sol");
  for (const r of routingTable("gpt-6")) assert(MODEL_PRICES[canonicalModelId(r.model)], `${r.stage}: ${r.model} is priced`);
  for (const s of GPT_STAGES) {
    const e = !isDeterministicStage(s) && escalationRoute(s, "x", {}, "gpt-6");
    if (e) assert(MODEL_PRICES[canonicalModelId(e.model)], `${s} escalation priced`);
  }
});

Deno.test("escalation budget: a run's allowance is shared across stages, and a spent budget fails safely without a second model call", async () => {
  const budget = new EscalationBudget(1);
  const models: string[] = [];
  const attempt = () => runWithEscalation<string>("execution_plan_amendment", {
    run: (route) => { models.push(route.model); return Promise.resolve({ ok: true, value: "bad" }); },
    validate: () => ({ valid: false, errors: ["plan rejected"] }),
    escalationBudget: budget,
  });
  const first = await attempt();
  assertEquals(first.record.event, "final_failure", "escalated once, still invalid");
  assertEquals(models.length, 2, "Luna then the escalation model");
  const second = await attempt();
  assertEquals(second.failureCode, "escalation_budget_exhausted");
  assert(second.record.escalation_reason!.startsWith("escalation_budget_exhausted (1 per run)"));
  assertEquals(models.length, 3, "the second rejection made no escalation call");
  assertEquals(budget.used, ["execution_plan_amendment"]);
  assertEquals(new EscalationBudget(-3).max, 0);
});

Deno.test("escalation budget absent: behaviour is exactly the per-call ladder", async () => {
  const models: string[] = [];
  for (let i = 0; i < 3; i++) {
    await runWithEscalation<string>("execution_plan_amendment", {
      run: (route) => { models.push(route.model); return Promise.resolve({ ok: true, value: "bad" }); },
      validate: () => ({ valid: false, errors: ["rejected"] }),
    });
  }
  assertEquals(models.length, 6);
});
