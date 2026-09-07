// THE STRATEGIST'S MODEL SPEND MUST REACH THE COLLECTOR.
//
// ── THE SEAM THAT WAS NEVER FED ────────────────────────────────────────────
//
// `completeOpenAiCompatible` has emitted `opts.onModelCall?.(telemetry, true)`
// since it was written, and a search for `onModelCall` across the whole
// leadStrategy tree found it in exactly one file — the transport's own. No
// adapter option carried it, the factory did not pass it, and `run-agent`
// constructed the planner 450 lines before the collector existed. So every
// strategist call reported into `undefined`: the seam was real and the wire
// was missing.
//
// ── AND FAILURES REPORTED NOTHING AT ALL ───────────────────────────────────
//
// Only the success path emitted. Every 429, 5xx, timeout and network fault
// returned without a telemetry row, so an outage in this path was
// indistinguishable from a quiet afternoon — the same defect fixed in
// `aiProvider`, in the module that was written first.
//
// ZERO network, ZERO models, ZERO providers, ZERO database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  completeOpenAiCompatible,
} from "../../../supabase/functions/_shared/leadStrategy/adapters/shared.ts";
import {
  createLeadStrategistProvider,
} from "../../../supabase/functions/_shared/leadStrategy/factory.ts";
import {
  ModelCallCollector, type ModelRunBudget,
} from "../../../supabase/functions/_shared/executionLedger.ts";
import type {
  ModelCallTelemetry,
} from "../../../supabase/functions/_shared/modelCostModel.ts";

const call = { model: "gpt-5.6-luna", role: "strategist", messages: [] } as never;

const okResponse = (usage: unknown) =>
  new Response(JSON.stringify({
    choices: [{ message: { content: "{}" } }], usage,
  }), { status: 200 });

const transport = (
  res: () => Response | Promise<Response>,
  onModelCall?: (t: ModelCallTelemetry, ok: boolean) => void,
  budget?: { check(): { allowed: boolean; exceeded: string | null } },
) =>
  completeOpenAiCompatible(call, {
    provider: "lovable_ai", endpoint: "https://example.invalid",
    fetchImpl: (() => Promise.resolve(res())) as never,
    onModelCall, budget,
  } as never);

// ══════════ success and failure both report ══════════════════════════════

Deno.test("a successful strategist call reaches the collector with tokens", async () => {
  const seen: Array<{ t: ModelCallTelemetry; ok: boolean }> = [];
  await transport(
    () => okResponse({ prompt_tokens: 900, completion_tokens: 120 }),
    (t, ok) => seen.push({ t, ok }),
  );
  assertEquals(seen.length, 1);
  assertEquals(seen[0].ok, true);
  assertEquals(seen[0].t.input_tokens, 900);
  assertEquals(seen[0].t.output_tokens, 120);
});

Deno.test("THE GAP: an HTTP failure now reports too", async () => {
  const seen: Array<{ t: ModelCallTelemetry; ok: boolean }> = [];
  const r = await transport(() => new Response("rate limited", { status: 429 }),
    (t, ok) => seen.push({ t, ok }));
  assertEquals(r.ok, false);
  assertEquals(seen.length, 1, "a 429 is a call that happened");
  assertEquals(seen[0].ok, false);
  assertEquals(
    seen[0].t.actual_cost_usd, null,
    "no usage is `unknown` cost, never $0 — an outage must not read as a free afternoon",
  );
});

Deno.test("a transport fault reports too", async () => {
  const seen: ModelCallTelemetry[] = [];
  const r = await completeOpenAiCompatible(call, {
    provider: "lovable_ai", endpoint: "https://example.invalid",
    fetchImpl: (() => Promise.reject(new Error("network down"))) as never,
    onModelCall: (t) => seen.push(t),
  } as never);
  assertEquals(r.ok, false);
  assertEquals(r.errorCode, "network_error");
  assertEquals(seen.length, 1, "a network fault is still a call attempt");
  assertEquals(seen[0].fallback_reason, "network_error");
});

// ══════════ the budget is honoured before the request ════════════════════

Deno.test("an exhausted budget stops the strategist BEFORE the request", async () => {
  const budget: ModelRunBudget = {
    max_calls: 1, max_input_tokens: 1e9, max_output_tokens: 1e9, max_total_tokens: 1e9,
  };
  const c = new ModelCallCollector(budget);
  c.sink({
    version: "model-cost-model-v1", role: "x", model: "google/gemini-3-flash-preview",
    reasoning_effort: null, input_tokens: 10, cached_input_tokens: 0, output_tokens: 5,
    estimated_cost_usd: null, actual_cost_usd: null, cost_source: "unknown",
    latency_ms: 1, fallback_reason: null,
  }, true);

  let fetched = 0;
  const r = await completeOpenAiCompatible(call, {
    provider: "lovable_ai", endpoint: "https://example.invalid",
    fetchImpl: (() => { fetched++; return Promise.resolve(okResponse({})); }) as never,
    budget: c,
  } as never);
  assertEquals(r.ok, false);
  assertEquals(r.errorCode, "model_budget_exhausted");
  assertEquals(fetched, 0, "a bound that spends the tokens first is a report, not a bound");
});

// ══════════ the wire, end to end through the factory ═════════════════════

Deno.test("THE WIRE: the factory carries the seam to the transport", async () => {
  // The whole defect in one assertion: build a provider the way production
  // does, call it, and require that the collector saw it.
  const collector = new ModelCallCollector();
  const { provider } = createLeadStrategistProvider({
    // The REAL config shape: `allowedModels` reads primaryModel/escalationModel,
    // and a stub with a `model` key yields `[undefined]` — the model is then
    // "not allowed" and no request is ever made, so the test would pass or fail
    // for a reason that has nothing to do with the seam.
    config: {
      provider: "lovable_ai",
      primaryModel: "gpt-5.6-luna",
      escalationModel: "gpt-5.6-luna",
    } as never,
    apiKey: "test-key",
    fetchImpl: (() => Promise.resolve(okResponse({ prompt_tokens: 5, completion_tokens: 2 }))) as never,
    onModelCall: collector.sink,
    budget: collector,
  });
  const r = await provider.complete({ model: "gpt-5.6-luna", role: "strategist", messages: [] } as never);
  assert(r.ok, `expected the stubbed call to succeed, got ${r.error}`);
  assertEquals(collector.length, 1, "a provider built by the factory must report its spend");
});

Deno.test("a provider built WITHOUT the seam still works — nothing is mandatory", () => {
  const { provider } = createLeadStrategistProvider({
    config: {
      provider: "lovable_ai", primaryModel: "gpt-5.6-luna", escalationModel: "gpt-5.6-luna",
    } as never,
    apiKey: "k",
  });
  assert(provider, "the seam is optional; omitting it must not break construction");
});

// ══════════ run-agent actually passes it ═════════════════════════════════

Deno.test("run-agent builds the strategist WITH the collector", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url),
  );
  assert(
    src.includes("provider: createLeadStrategistProvider({"),
    "run-agent must construct the provider itself, or runLeadStrategy builds an unwired one",
  );
  // Ordering is the defect: the collector used to be declared 450 lines below
  // the planner, so there was nothing to pass.
  const collector = src.indexOf("const modelCalls = new ModelCallCollector(");
  const planner = src.indexOf("createLeadStrategyPlanner({");
  assert(collector > 0 && planner > 0);
  assert(
    collector < planner,
    "the collector must be declared BEFORE the planner that reports into it",
  );
  assert(src.includes("onModelCall: modelCalls.sink"), "and the sink must be handed over");
});
