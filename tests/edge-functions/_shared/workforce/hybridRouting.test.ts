// HYBRID MODEL ROUTING. MOCKED PROVIDERS ONLY — every HTTP call below goes to a
// fake fetch; no test reaches OpenAI or Anthropic. The environment is set and
// restored per test.
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  defaultEffortFor, effectiveEffort, resolveTaskRoute, ROUTABLE_MODELS, routingSnapshot,
} from "../../../../supabase/functions/_shared/modelRoutePolicy.ts";
import { isModelPriced } from "../../../../supabase/functions/_shared/modelCostModel.ts";
import { WORKFORCE_TASKS, createRouteLimiter } from "../../../../supabase/functions/_shared/terraPolicy.ts";
import { escalationRoute, GPT_STAGES, isDeterministicStage, routeModel, STAGE_TASKS } from "../../../../supabase/functions/_shared/gptModelRouter.ts";
import { generateText, openAIChatBody } from "../../../../supabase/functions/_shared/aiProvider.ts";
import { orionConverseTask } from "../../../../supabase/functions/_shared/departmentRouting.ts";

const reader = (env: Record<string, string>) => (k: string) => env[k];
const HYBRID = {
  AGENTORY_HYBRID_ROUTING_ENABLED: "true",
  AGENTORY_VERIFIED_MODELS: "gpt-6.1-terra",
  AGENTORY_ROUTE_COMPLEX_COMPANY_QA: "gpt-6.1-terra:low",
  AGENTORY_ROUTE_VALIDATION_REPAIR: "gpt-6.1-terra",
};

Deno.test("routing: OFF by default — every task disabled, every stage on its policy model (rollback state)", () => {
  const snap = routingSnapshot(reader({}));
  for (const t of WORKFORCE_TASKS) assertEquals(snap[t], { use: false, task: t, reason: "disabled" });
  for (const s of GPT_STAGES.filter((x) => !isDeterministicStage(x))) {
    const r = routeModel(s, {}, "gpt-5.6", reader({}));
    assert(r.model === "gpt-5.6-luna" || r.model === "gpt-5.6-terra", `${s}: ${r.model}`);
    assertEquals(r.routing, undefined);
  }
  assertEquals(escalationRoute("execution_plan", "x", {}, "gpt-5.6", reader({}))?.model, "gpt-5.6-terra");
});

Deno.test("routing: each task is independently configurable; unconfigured tasks stay put", () => {
  const r = resolveTaskRoute("complex_company_qa", reader(HYBRID));
  assert(r.use);
  assertEquals([r.model, r.effort, r.source, r.fallback], ["gpt-6.1-terra", "low", "hybrid", "declared"]);
  assertEquals((resolveTaskRoute("simple_chat", reader(HYBRID)) as { reason: string }).reason, "no_route");
  assertEquals((resolveTaskRoute("orion_reasoning", reader(HYBRID)) as { reason: string }).reason, "no_route");
});

Deno.test("routing: refusals — unsupported model, unsupported effort, unverified, invalid task", () => {
  const on = { AGENTORY_HYBRID_ROUTING_ENABLED: "true" };
  assertEquals((resolveTaskRoute("simple_chat", reader({ ...on, AGENTORY_ROUTE_SIMPLE_CHAT: "gpt-9-hyper" })) as { reason: string }).reason, "unsupported_model");
  assertEquals((resolveTaskRoute("simple_chat", reader({ ...on, AGENTORY_ROUTE_SIMPLE_CHAT: "claude-haiku-5-5" })) as { reason: string }).reason, "unsupported_model",
    "Haiku 5.5 is benchmark-only until its request shape is wired");
  assertEquals((resolveTaskRoute("simple_chat", reader({ ...on, AGENTORY_ROUTE_SIMPLE_CHAT: "gpt-6.1-terra:turbo" })) as { reason: string }).reason, "unsupported_effort");
  assertEquals((resolveTaskRoute("simple_chat", reader({ ...on, AGENTORY_ROUTE_SIMPLE_CHAT: "gpt-6.1-sol:none" })) as { reason: string }).reason, "unsupported_effort");
  assertEquals((resolveTaskRoute("simple_chat", reader({ ...on, AGENTORY_ROUTE_SIMPLE_CHAT: "gpt-6.1-terra" })) as { reason: string }).reason, "not_verified");
  assertEquals((resolveTaskRoute("not_a_task", reader(on)) as { reason: string }).reason, "invalid_task");
  // A model already in production needs no verification.
  assert(resolveTaskRoute("simple_chat", reader({ ...on, AGENTORY_ROUTE_SIMPLE_CHAT: "gpt-5.6-luna" })).use);
});

Deno.test("routing: every allow-listed model is priced, so no route can escape the spend ceiling", () => {
  for (const m of Object.keys(ROUTABLE_MODELS)) assert(isModelPriced(m), m);
});

Deno.test("routing: effort — routine tasks run at none, reasoning tasks at low, Sol raised to its floor", () => {
  assertEquals(defaultEffortFor("simple_chat", "gpt-6.1-terra"), "none");
  assertEquals(defaultEffortFor("complex_company_qa", "gpt-6.1-terra"), "low");
  assertEquals(defaultEffortFor("lead_classification", "gpt-6.1-sol"), "low");
  assertEquals(defaultEffortFor("simple_chat", "claude-haiku-4-5-20251001"), null);
  assertEquals(effectiveEffort("gpt-6.1-sol", "none"), "low");
  const none = openAIChatBody("gpt-6.1-terra", [{ role: "user", content: "x" }], { maxTokens: 400 }, "none");
  assertEquals([none.reasoning_effort, none.max_completion_tokens], ["none", 400], "no reasoning headroom bought at none");
  assertEquals(openAIChatBody("gpt-6.1-terra", [], { maxTokens: 400 }, "medium").max_completion_tokens, 1600);
  assertEquals(openAIChatBody("gpt-6.1-sol", [], { maxTokens: 400 }, "none").reasoning_effort, "low");
});

Deno.test("routing: the repair rung is configured independently of the primary model", () => {
  const primary = routeModel("execution_plan", {}, "gpt-5.6", reader(HYBRID));
  assertEquals(primary.model, "gpt-5.6-luna", "primary unchanged");
  const repair = escalationRoute("execution_plan", "validator: missing steps", {}, "gpt-5.6", reader(HYBRID))!;
  assertEquals(repair.model, "gpt-6.1-terra");
  assertEquals(repair.reasoning_effort, "low", "the stage's own effort");
  assertEquals(repair.routing?.replaced, "gpt-5.6-terra");
  // Under the gpt-6 family too: the repair rung no longer has to be Sol.
  assertEquals(escalationRoute("execution_plan", "x", {}, "gpt-6", reader(HYBRID))?.model, "gpt-6.1-terra");
  assertEquals(escalationRoute("execution_plan", "x", {}, "gpt-6", reader({}))?.model, "gpt-6.1-sol");
  // Repair STAGES route with it.
  assertEquals(STAGE_TASKS.execution_plan_repair, "validation_repair");
});

Deno.test("routing: a pipeline stage never switches to Anthropic", () => {
  const env = { AGENTORY_HYBRID_ROUTING_ENABLED: "true", AGENTORY_ROUTE_ATLAS_QUALIFICATION: "claude-haiku-4-5-20251001" };
  assertEquals(routeModel("company_qualification", {}, "gpt-5.6", reader(env)).model, "gpt-5.6-luna");
});

Deno.test("routing: legacy Terra variables still work and are priced by the static table", () => {
  const legacy = { AGENTORY_TERRA_ENABLED: "true", AGENTORY_TERRA_MODEL_VERIFIED: "true", AGENTORY_TERRA_TASKS: "orion_reasoning" };
  const r = resolveTaskRoute("orion_reasoning", reader(legacy));
  assert(r.use && r.model === "gpt-6.1-terra" && r.source === "terra_legacy");
  assertEquals(defaultEffortFor("orion_reasoning", "gpt-6.1-terra"), "low");
});

Deno.test("ORION: deterministic task classification keeps small talk off premium models", () => {
  assertEquals(orionConverseTask("hi"), "simple_chat");
  assertEquals(orionConverseTask("thanks, that helps"), "simple_chat");
  assertEquals(orionConverseTask("ok"), "simple_chat");
  assertEquals(orionConverseTask("What should we prioritize this week?"), "strategic_prioritization");
  assertEquals(orionConverseTask("Which opportunities best match our ICP and current goals?"), "complex_company_qa");
  assertEquals(orionConverseTask("Compare Kestrel and Harbor Valve for our Midwest push"), "complex_company_qa");
});

// ── aiProvider end to end, with a fake transport ─────────────────────────────
type Call = { url: string; body: Record<string, unknown> };
function fakeFetch(plan: { openai?: number; anthropic?: number }) {
  const calls: Call[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, body: JSON.parse(String(init?.body ?? "{}")) });
    if (u.includes("openai")) {
      if (plan.openai && plan.openai !== 200) return new Response("nope", { status: plan.openai });
      return new Response(JSON.stringify({ choices: [{ message: { content: "terra says" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1000, completion_tokens: 300, completion_tokens_details: { reasoning_tokens: 200 } } }), { status: 200 });
    }
    if (plan.anthropic && plan.anthropic !== 200) return new Response("nope", { status: plan.anthropic });
    return new Response(JSON.stringify({ content: [{ text: "haiku says" }], usage: { input_tokens: 900, output_tokens: 100 } }), { status: 200 });
  }) as typeof fetch;
  return { f, calls };
}
async function withEnv<T>(env: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const keys = ["AGENTORY_HYBRID_ROUTING_ENABLED", "AGENTORY_VERIFIED_MODELS", "AGENTORY_ROUTE_COMPLEX_COMPANY_QA", "AGENTORY_ROUTE_VALIDATION_REPAIR",
    "AGENTORY_ROUTE_FALLBACK", "AGENTORY_ROUTE_MAX_CALLS_PER_RUN", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "AGENTORY_TERRA_ENABLED"];
  const prev = Object.fromEntries(keys.map((k) => [k, Deno.env.get(k)]));
  for (const k of keys) Deno.env.delete(k);
  for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);
  try { return await fn(); } finally {
    for (const k of keys) { const v = prev[k]; if (v === undefined) Deno.env.delete(k); else Deno.env.set(k, v); }
  }
}
const KEYS = { OPENAI_API_KEY: "sk-test-dummy", ANTHROPIC_API_KEY: "sk-ant-test-dummy" };
function opts(extra: Record<string, unknown> = {}) {
  const telemetry: Array<{ model: string; ok: boolean; effort: string | null; fallback: string | null; reasoning?: number }> = [];
  return {
    telemetry,
    o: {
      taskType: "pilot_chat" as const, messages: [{ role: "user" as const, content: "Which accounts fit our ICP?" }], maxTokens: 420,
      workforceTask: "complex_company_qa" as const, terraLimiter: createRouteLimiter(() => undefined),
      onModelCall: (t: { model: string; reasoning_effort: string | null; fallback_reason: string | null; reasoning_tokens?: number }, ok: boolean) =>
        telemetry.push({ model: t.model, ok, effort: t.reasoning_effort, fallback: t.fallback_reason, reasoning: t.reasoning_tokens }),
      ...extra,
    },
  };
}
async function run(env: Record<string, string>, plan: { openai?: number; anthropic?: number }, extra: Record<string, unknown> = {}) {
  const real = globalThis.fetch;
  const { f, calls } = fakeFetch(plan);
  globalThis.fetch = f;
  try {
    return await withEnv({ ...KEYS, ...env }, async () => {
      const { o, telemetry } = opts(extra);
      const r = await generateText(o as never);
      return { r, calls, telemetry };
    });
  } finally { globalThis.fetch = real; }
}

Deno.test("aiProvider: default (flags off) — the declared model runs, no routed call", async () => {
  const { r, calls } = await run({}, {});
  assertEquals(r.model, "claude-haiku-4-5-20251001");
  assertEquals(calls.length, 1);
  assert(calls[0].url.includes("anthropic"));
  assertEquals(r.routeDecision?.decision, "disabled");
});

Deno.test("aiProvider: routed Terra — actual model attributed, effort and reasoning tokens recorded", async () => {
  const { r, calls, telemetry } = await run(HYBRID, {});
  assertEquals(r.model, "gpt-6.1-terra");
  assertEquals(r.routeDecision, { task: "complex_company_qa", decision: "terra", model: "gpt-6.1-terra", effort: "low", source: "hybrid" });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].body.reasoning_effort, "low");
  assertEquals("temperature" in calls[0].body, false);
  assertEquals(telemetry, [{ model: "gpt-6.1-terra", ok: true, effort: "low", fallback: null, reasoning: 200 }]);
});

Deno.test("aiProvider: a routed failure falls back to the DECLARED model once, and says so", async () => {
  const { r, calls, telemetry } = await run(HYBRID, { openai: 404 });
  assertEquals(r.ok, true);
  assertEquals(r.model, "claude-haiku-4-5-20251001");
  assertEquals(r.terraDecision, "terra_failed_fell_back");
  assertEquals(calls.length, 2, "one routed attempt + one declared attempt — no retry loop");
  assertEquals(telemetry.map((t) => [t.model, t.ok]), [["gpt-6.1-terra", false], ["claude-haiku-4-5-20251001", true]]);
  assertEquals(telemetry[1].fallback, "routed_attempt_failed");
});

Deno.test("aiProvider: AGENTORY_ROUTE_FALLBACK=none fails loudly instead of switching models", async () => {
  const { r, calls } = await run({ ...HYBRID, AGENTORY_ROUTE_FALLBACK: "none" }, { openai: 500 });
  assertEquals(r.ok, false);
  assertEquals(r.errorCode, "routed_model_failed");
  assertEquals(calls.length, 1);
});

Deno.test("aiProvider: both routed and declared fail — bounded attempts, honest failure", async () => {
  const { r, calls } = await run(HYBRID, { openai: 500, anthropic: 500 });
  assertEquals(r.ok, false);
  assertEquals(calls.length, 2);
});

Deno.test("aiProvider: routed model unavailable (no key) — declared model runs, decision recorded", async () => {
  const real = globalThis.fetch;
  const { f, calls } = fakeFetch({});
  globalThis.fetch = f;
  try {
    await withEnv({ ...HYBRID, ANTHROPIC_API_KEY: "sk-ant-test-dummy" }, async () => {
      const { o } = opts();
      const r = await generateText(o as never);
      assertEquals(r.model, "claude-haiku-4-5-20251001");
      assertEquals(r.routeDecision?.decision, "no_openai_key");
      assertEquals(calls.length, 1);
    });
  } finally { globalThis.fetch = real; }
});

Deno.test("aiProvider: the per-run call limit stops routing after N calls", async () => {
  const real = globalThis.fetch;
  const { f, calls } = fakeFetch({});
  globalThis.fetch = f;
  try {
    await withEnv({ ...KEYS, ...HYBRID }, async () => {
      const lim = createRouteLimiter((k) => (k === "AGENTORY_ROUTE_MAX_CALLS_PER_RUN" ? "1" : undefined));
      const a = await generateText(opts({ terraLimiter: lim }).o as never);
      const b = await generateText(opts({ terraLimiter: lim }).o as never);
      assertEquals([a.model, b.model], ["gpt-6.1-terra", "claude-haiku-4-5-20251001"]);
      assertEquals(b.routeDecision?.decision, "run_call_limit_reached");
      assertEquals(calls.length, 2);
    });
  } finally { globalThis.fetch = real; }
});

Deno.test("aiProvider: budget enforcement — an exhausted budget makes NO call, routed or declared", async () => {
  const { r, calls } = await run(HYBRID, {}, { budget: { check: () => ({ allowed: false, exceeded: "max_calls" }) } });
  assertEquals(r.ok, false);
  assertEquals(r.errorCode, "model_budget_exhausted");
  assertEquals(calls.length, 0);
});

Deno.test("aiProvider: an unsupported configured model is never called", async () => {
  const { r, calls } = await run({ ...HYBRID, AGENTORY_ROUTE_COMPLEX_COMPANY_QA: "gpt-9-hyper" }, {});
  assertEquals(r.model, "claude-haiku-4-5-20251001");
  assertEquals(r.routeDecision?.decision, "unsupported_model");
  assert(calls.every((c) => !c.url.includes("openai")));
});

Deno.test("aiProvider: no route without a spend collector or a limiter", async () => {
  const a = await run(HYBRID, {}, { onModelCall: undefined });
  assertEquals(a.r.routeDecision?.decision, "no_spend_collector");
  const b = await run(HYBRID, {}, { terraLimiter: undefined });
  assertEquals(b.r.routeDecision?.decision, "no_run_limiter");
  assertStringIncludes(b.r.model, "haiku");
});
