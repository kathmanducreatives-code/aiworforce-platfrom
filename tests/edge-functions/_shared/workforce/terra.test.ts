// WORKFORCE V2 · GPT-6.1 TERRA, FEATURE-FLAGGED. Mocked transport only — no
// test here reaches OpenAI. The env is set and restored per test.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createTerraRunLimiter, runtimeModelPrice, terraModelId, terraRouteFor, TERRA_DEFAULT_MODEL,
} from "../../../../supabase/functions/_shared/terraPolicy.ts";
import { generateText, openAIChatBody, terraAttemptFor } from "../../../../supabase/functions/_shared/aiProvider.ts";
import { priceModelCall } from "../../../../supabase/functions/_shared/modelCostModel.ts";
import { routeModel, TERRA_STAGE_TASKS } from "../../../../supabase/functions/_shared/gptModelRouter.ts";
import { BENCH_CANDIDATES, liveApproval, maxPassCost, maxRunCost, openaiBody } from "../../../../scripts/model-bench/run.ts";
import { callCost, LIST_PRICES } from "../../../../scripts/model-bench/prices.ts";
import { STRATEGIES, TASKS, taskCost } from "../../../../scripts/model-bench/costModel.ts";
import { scoreOutput } from "../../../../scripts/model-bench/scorers.ts";
import { BENCH_TASKS } from "../../../../scripts/model-bench/tasks.ts";

const ON: Record<string, string> = {
  AGENTORY_TERRA_ENABLED: "true",
  AGENTORY_TERRA_MODEL_VERIFIED: "true",
  AGENTORY_TERRA_PRICE_USD_PER_1M: "3,0.3,15",
  AGENTORY_TERRA_TASKS: "orion_reasoning,complex_company_qa,atlas_qualification",
};
const reader = (env: Record<string, string>) => (k: string) => env[k];

Deno.test("terra: off by default — every missing gate names its reason", () => {
  assertEquals(terraRouteFor("orion_reasoning", reader({})), { use: false, reason: "disabled" });
  assertEquals(terraRouteFor("orion_reasoning", reader({ ...ON, AGENTORY_TERRA_MODEL_VERIFIED: "" })).use, false);
  assertEquals((terraRouteFor("orion_reasoning", reader({ ...ON, AGENTORY_TERRA_MODEL_VERIFIED: "" })) as { reason: string }).reason, "not_verified");
  assertEquals((terraRouteFor("orion_reasoning", reader({ ...ON, AGENTORY_TERRA_PRICE_USD_PER_1M: "" })) as { reason: string }).reason, "unpriced");
  assertEquals((terraRouteFor("orion_reasoning", reader({ ...ON, AGENTORY_TERRA_PRICE_USD_PER_1M: "3,0.3,0" })) as { reason: string }).reason, "unpriced");
  assertEquals((terraRouteFor("lyra_content", reader(ON)) as { reason: string }).reason, "task_not_enabled");
  assertEquals((terraRouteFor(null, reader(ON)) as { reason: string }).reason, "no_task");
  const r = terraRouteFor("orion_reasoning", reader(ON));
  assert(r.use && r.model === TERRA_DEFAULT_MODEL);
});

Deno.test("terra: model id override accepts only a terra-shaped GPT-6 id", () => {
  assertEquals(terraModelId(reader({ AGENTORY_TERRA_MODEL_ID: "gpt-6.1-terra-2026-12-01" })), "gpt-6.1-terra-2026-12-01");
  assertEquals(terraModelId(reader({ AGENTORY_TERRA_MODEL_ID: "gpt-4o" })), TERRA_DEFAULT_MODEL);
});

Deno.test("terra: priced from config so the spend ceiling sees it; unpriced stays unknown, never $0", () => {
  const usage = { input_tokens: 1_000_000, cached_input_tokens: 0, output_tokens: 100_000 } as never;
  const before = priceModelCall({ model: "gpt-6.1-terra", usage });
  assertEquals(before.source, "unknown");
  assertEquals(runtimeModelPrice("gpt-6.1-terra", reader(ON))?.output_per_1m, 15);
  Deno.env.set("AGENTORY_TERRA_PRICE_USD_PER_1M", "3,0.3,15");
  try {
    const after = priceModelCall({ model: "gpt-6.1-terra", usage });
    assertEquals(after.source, "event_priced");
    assertEquals(Math.round((after.estimated_usd ?? after.actual_usd ?? 0) * 100) / 100, 4.5);
  } finally { Deno.env.delete("AGENTORY_TERRA_PRICE_USD_PER_1M"); }
});

Deno.test("terra: the GPT-5/6 request shape — no temperature, max_completion_tokens, reasoning_effort", () => {
  const b = openAIChatBody("gpt-6.1-terra", [{ role: "user", content: "x" }], { temperature: 0.5, maxTokens: 400, jsonMode: true });
  assertEquals("temperature" in b, false);
  assertEquals("max_tokens" in b, false);
  assertEquals(b.reasoning_effort, "low");
  assert((b.max_completion_tokens as number) >= 400);
  assertEquals(b.response_format, { type: "json_object" });
  const old = openAIChatBody("gpt-4.1-mini", [{ role: "user", content: "x" }], { maxTokens: 400 });
  assertEquals(old.max_tokens, 400);
});

Deno.test("terra: attempt requires a spend collector and a per-run limiter; the limiter caps calls", () => {
  const sink = () => {};
  assertEquals(terraAttemptFor({ workforceTask: "orion_reasoning", onModelCall: sink }, true, reader(ON)).decision, "no_run_limiter");
  assertEquals(terraAttemptFor({ workforceTask: "orion_reasoning", terraLimiter: createTerraRunLimiter(reader({})) }, true, reader(ON)).decision, "no_spend_collector");
  assertEquals(terraAttemptFor({ workforceTask: "orion_reasoning", onModelCall: sink, terraLimiter: createTerraRunLimiter(reader({})) }, false, reader(ON)).decision, "no_openai_key");
  const lim = createTerraRunLimiter(reader({ AGENTORY_TERRA_MAX_CALLS_PER_RUN: "2" }));
  const o = { workforceTask: "orion_reasoning" as const, onModelCall: sink, terraLimiter: lim };
  assertEquals(terraAttemptFor(o, true, reader(ON)).model, "gpt-6.1-terra");
  assertEquals(terraAttemptFor(o, true, reader(ON)).model, "gpt-6.1-terra");
  assertEquals(terraAttemptFor(o, true, reader(ON)).decision, "run_call_limit_reached");
  assertEquals(createTerraRunLimiter(reader({})).max, 8);
});

async function withEnv<T>(env: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) { prev[k] = Deno.env.get(k); Deno.env.set(k, v); }
  try { return await fn(); } finally {
    for (const k of Object.keys(env)) {
      if (prev[k] === undefined) Deno.env.delete(k);
      else Deno.env.set(k, prev[k]!);
    }
  }
}

Deno.test("terra: generateText tries Terra first, records the actual model, and falls back with a reason", async () => {
  const realFetch = globalThis.fetch;
  const bodies: Array<Record<string, unknown>> = [];
  let terraFails = false;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("openai")) {
      const b = JSON.parse(String(init?.body)); bodies.push(b);
      if (terraFails) return new Response("model not found", { status: 404 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "terra answer" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
    }
    return new Response(JSON.stringify({ content: [{ text: "haiku answer" }], usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200 });
  }) as typeof fetch;
  try {
    await withEnv({ ...ON, OPENAI_API_KEY: "sk-test-dummy", ANTHROPIC_API_KEY: "sk-ant-test-dummy" }, async () => {
      const calls: Array<{ model: string; ok: boolean }> = [];
      const opts = {
        taskType: "helper" as const, messages: [{ role: "user" as const, content: "brief me" }],
        workforceTask: "orion_reasoning" as const, terraLimiter: createTerraRunLimiter(),
        onModelCall: (t: { model_id?: string; model?: string }, ok: boolean) => calls.push({ model: String(t.model_id ?? t.model), ok }),
      };
      const r = await generateText(opts as never);
      assertEquals(r.model, "gpt-6.1-terra");
      assertEquals(r.terraDecision, "terra");
      assertEquals("temperature" in bodies[0], false);

      terraFails = true;
      const r2 = await generateText({ ...opts, terraLimiter: createTerraRunLimiter() } as never);
      assertEquals(r2.ok, true);
      assertEquals(r2.model, "claude-haiku-4-5-20251001");
      assertEquals(r2.terraDecision, "terra_failed_fell_back");
      assert(calls.some((c) => !c.ok && c.model.includes("terra")), "the failed Terra call is still recorded");

      // Not opted in: no Terra attempt at all.
      bodies.length = 0;
      const r3 = await generateText({ ...opts, workforceTask: "lyra_content" } as never);
      assertEquals(r3.model, "claude-haiku-4-5-20251001");
      assertEquals(r3.terraDecision, "task_not_enabled");
      assertEquals(bodies.length, 0);
    });
  } finally { globalThis.fetch = realFetch; }
});

Deno.test("terra: router opt-in is additive — default routes unchanged; opted-in ATLAS stage moves", () => {
  const off = routeModel("company_qualification", {}, "gpt-5.6", reader({}));
  assertEquals(off.model, "gpt-5.6-luna");
  assertEquals(off.terra, undefined);
  const on = routeModel("company_qualification", {}, "gpt-5.6", reader(ON));
  assertEquals(on.model, "gpt-6.1-terra");
  assertEquals(on.reasoning_effort, "low");
  assertEquals(on.terra, { task: "atlas_qualification", replaced: "gpt-5.6-luna" });
  // LISA not opted in under ON.
  assertEquals(routeModel("signal_relevance", {}, "gpt-5.6", reader(ON)).terra, undefined);
  assertEquals(TERRA_STAGE_TASKS.signal_relevance, "lisa_interpretation");
});

Deno.test("bench: dry run prices known models, refuses unpriced Terra, and live mode needs the exact approval", () => {
  for (const c of BENCH_CANDIDATES) assert(Number.isFinite(maxPassCost(c)), `${c.id} is priced`);
  assert(maxRunCost() < 2, "the full matrix stays under the $2 stage-1 cap");
  assertEquals(liveApproval(2, reader({})).ok, false);
  assertEquals(liveApproval(2, reader({ AGENTORY_MODEL_BENCH_APPROVED: "I approve paid model benchmark spend up to $2.00" })).ok, true);
  assertEquals(liveApproval(2, reader({ AGENTORY_MODEL_BENCH_APPROVED: "I approve paid model benchmark spend up to $5.00" })).ok, false);
});

Deno.test("bench: scorers catch ICP violations, fabricated citations, invalid JSON", () => {
  const t = BENCH_TASKS.find((x) => x.id === "orion-priority-1")!;
  const bad = scoreOutput(t, "Prioritize Cloudnova Software [E9]. Also Zephyr Industries.");
  assertEquals(bad.structured_valid, false);
  assertEquals(bad.icp_violations, ["Cloudnova Software"]);
  assertEquals(bad.citations.fabricated, ["E9"]);
  assertEquals(bad.suspected_hallucinations, ["Zephyr Industries"]);
  const good = scoreOutput(t, JSON.stringify({
    executive_answer: "Pursue Kestrel Fabrication [E1]; Cloudnova Software is excluded.",
    why_it_matters: "x", evidence: ["E1"], recommended_actions: [], uncertainty: "E4 unverified",
  }));
  assertEquals(good.structured_valid, true);
  assertEquals(good.icp_violations, []);
  assertEquals(good.citations.accuracy, 1);
});

Deno.test("audit prices: verified list prices and the GPT-6 request shape", () => {
  assertEquals([LIST_PRICES["gpt-6.1-terra"].input, LIST_PRICES["gpt-6.1-terra"].cached_input, LIST_PRICES["gpt-6.1-terra"].output], [1, 0.05, 5]);
  assertEquals(LIST_PRICES["gpt-6.1-terra"].cache_write, 1.25);
  // A repair call on Terra 6.1 costs less than half of one on Terra 5.6.
  const c = { input: 7250, output: 750, reasoning: 750 };
  assert(callCost("gpt-6.1-terra", c) < 0.5 * callCost("gpt-5.6-terra", c));
  const t = BENCH_TASKS[0];
  const body = openaiBody(BENCH_CANDIDATES.find((x) => x.id === "terra-6.1-low")!, t);
  assertEquals(body.reasoning_effort, "low");
  assertEquals("temperature" in body, false);
  assert((body.max_completion_tokens as number) > t.maxOutputTokens, "headroom for reasoning tokens");
});

Deno.test("cost model: every strategy prices every task; Terra-everywhere is the most expensive", () => {
  const month = (s: string) => TASKS.reduce((a, t) => a + taskCost(t, s), 0);
  for (const s of Object.keys(STRATEGIES)) for (const t of TASKS) assert(Number.isFinite(taskCost(t, s)) && taskCost(t, s) > 0, `${s}/${t.name}`);
  const a = month("A · Terra everywhere");
  for (const s of Object.keys(STRATEGIES)) assert(month(s) <= a, s);
});

Deno.test("bench scorers: required points and forbidden recommendations", () => {
  const t = BENCH_TASKS.find((x) => x.id === "brain-memory-1")!;
  const good = scoreOutput(t, "Pursue Kestrel Fabrication. Cloudnova Software is excluded by your Company Brain, so do not pursue it.");
  assertEquals(good.required_points, { met: 2, of: 2 });
  assertEquals(good.forbidden_recommendations, []);
  const bad = scoreOutput(t, "Pursue Cloudnova Software now. Kestrel is fine too.");
  assertEquals(bad.forbidden_recommendations, ["Cloudnova Software"]);
});
