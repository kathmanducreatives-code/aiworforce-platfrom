// LIVE FACET BENCHMARK — CALLS REAL MODELS. NEVER RUN BY THE TEST SUITE.
//
// Refuses to run unless FACET_BENCHMARK_LIVE=1. Each arm needs its own key and
// each call is paid: Jev ($0.042 per million input tokens) and OpenAI (the
// current grounder and the fixed-question arm, at gpt-5.6-luna prices).
//
//   FACET_BENCHMARK_LIVE=1 \
//   FACET_BENCHMARK_ARMS=current,gpt,jev \
//   FACET_BENCHMARK_REPEATS=5 \
//   JEV_API_KEY=… OPENAI_API_KEY=… \
//   deno run --allow-read --allow-env --allow-net tests/edge-functions/_eval/runFacetBenchmark.ts
//
// Prints one JSON report: per-arm metrics, then the success gate for Jev
// against the current grounder and against the fixed-question GPT arm.

import { ALL_FIXTURES } from "./facetFixtures.ts";
import {
  judgeArm, liveGrounderArm, runBenchmark, successGate, type Arm,
} from "./facetBenchmark.ts";
import { jevJudge, DEFAULT_JEV_MODEL } from "../../../supabase/functions/_shared/jevProvider.ts";
import { gptFacetJudge } from "../../../supabase/functions/_shared/gptFacetJudge.ts";
import { buildGroundedBrainBinding } from "../../../supabase/functions/_shared/groundedBrainBinding.ts";
import type { ModelCallTelemetry } from "../../../supabase/functions/_shared/modelCostModel.ts";

if (Deno.env.get("FACET_BENCHMARK_LIVE") !== "1") {
  console.error("Refusing: this calls paid models. Set FACET_BENCHMARK_LIVE=1 to run it.");
  Deno.exit(2);
}

const wanted = new Set((Deno.env.get("FACET_BENCHMARK_ARMS") ?? "current,gpt,jev").split(",").map((s) => s.trim()));
const repeats = Math.max(1, Number(Deno.env.get("FACET_BENCHMARK_REPEATS") ?? "5") || 5);
const calls: ModelCallTelemetry[] = [];
const sink = (t: ModelCallTelemetry) => { calls.push(t); };
const lastCost = () => calls.at(-1)?.estimated_cost_usd ?? null;

const arms: Arm[] = [];
if (wanted.has("current")) {
  const binding = buildGroundedBrainBinding({
    workspaceId: "facet-benchmark", originalUserQuery: null, callsRemaining: 10_000, onModelCall: sink,
  });
  if (!binding.groundCompany) throw new Error("the grounder is not available");
  arms.push(liveGrounderArm(binding.groundCompany, lastCost));
}
if (wanted.has("gpt")) {
  const effort = Deno.env.get("FACET_BENCHMARK_GPT_EFFORT");
  arms.push(judgeArm("gpt_fixed", gptFacetJudge({
    model: Deno.env.get("FACET_BENCHMARK_GPT_MODEL") ?? "gpt-5.6-luna",
    // Default `none`, as the current grounder is routed; override to test more reasoning.
    reasoningEffort: effort === "low" || effort === "medium" || effort === "high" ? effort : "none",
    deps: { onModelCall: sink },
  })));
}
if (wanted.has("jev")) {
  const apiKey = Deno.env.get("JEV_API_KEY") ?? null;
  if (!apiKey) throw new Error("JEV_API_KEY is not set");
  arms.push(judgeArm("jev", jevJudge({
    apiKey, model: Deno.env.get("JEV_MODEL") ?? DEFAULT_JEV_MODEL, onModelCall: sink,
  })));
}

const report = await runBenchmark({ fixtures: ALL_FIXTURES, arms, repeats });
const by = (n: string) => report.arms.find((a) => a.arm === n);
const gates: Record<string, unknown> = {};
if (by("jev") && by("current_grounder")) gates.jev_vs_current = successGate(by("jev")!, by("current_grounder")!);
if (by("jev") && by("gpt_fixed")) gates.jev_vs_gpt_fixed = successGate(by("jev")!, by("gpt_fixed")!);
if (by("gpt_fixed") && by("current_grounder")) gates.gpt_fixed_vs_current = successGate(by("gpt_fixed")!, by("current_grounder")!);

console.log(JSON.stringify({
  fixtures: report.fixtures, repeats, metrics: report.arms, gates,
  model_calls: calls.length,
  model_cost_usd: calls.reduce((s, c) => s + (c.estimated_cost_usd ?? 0), 0),
}, null, 2));
