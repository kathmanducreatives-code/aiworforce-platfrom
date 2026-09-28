// BENCHMARK V2 LIVE RUNNER — CALLS PAID MODELS. NOT RUN BY ANY TEST.
//
// Refuses unless FACET_BENCHMARK_V2_LIVE=1, and refuses — before any call — if
// any input named in the freeze manifest has changed since the freeze. Arms,
// repeats, models and the spend ceiling come from the manifest; an environment
// override that disagrees with it is refused, never silently applied.
//
// Writes nothing itself; prints ONE JSON report with every raw answer, so the
// analysis (analyze.ts) can be re-run offline without re-running inference:
//
//   FACET_BENCHMARK_V2_LIVE=1 deno run --no-lock --env-file=.env.benchmark --allow-read=. --allow-env \
//     --allow-net=api.typesafe.ai,api.openai.com tests/edge-functions/_eval/v2/run.ts \
//     > tests/edge-functions/_eval/baselines/benchmark-v2/results.json

import { BENCHMARK_V2_FIXTURES } from "./realFixtures.ts";
import { currentArmV2, judgeArmV2, type Arm, type RunRecord } from "./benchmark.ts";
import { gptV2Judge, jevV2Judge } from "./judges.ts";
import { analyzeV2 } from "./analyze.ts";
import { sha256Hex, SpendGuard, verifyFrozen } from "./runGuards.ts";
import { buildGroundedBrainBinding } from "../../../../supabase/functions/_shared/groundedBrainBinding.ts";
import type { ModelCallTelemetry } from "../../../../supabase/functions/_shared/modelCostModel.ts";

export const MANIFEST_PATH = "tests/edge-functions/_eval/baselines/benchmark-v2/freeze-manifest.json";

const refuse = (why: string, code = 2): never => { console.error(`Refusing: ${why}`); Deno.exit(code); };

if (Deno.env.get("FACET_BENCHMARK_V2_LIVE") !== "1") refuse("Benchmark V2 calls paid models. Set FACET_BENCHMARK_V2_LIVE=1 to run it.");

const root = new URL("../../../../", import.meta.url);
const manifestBytes = await Deno.readFile(new URL(MANIFEST_PATH, root)).catch(() => refuse("no freeze manifest — Benchmark V2 is not frozen."));
const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
  frozen_inputs: Record<string, string>;
  arm_dependencies: Record<string, string>;
  run: { arms: string[]; repeats: number; gpt: { model: string; max_output_tokens: number }; jev: { model: string }; current_grounder_model: string; spend_ceiling_usd: number };
  fixtures: { total: number };
};
const drift = await verifyFrozen({ ...manifest.frozen_inputs, ...manifest.arm_dependencies }, root);
if (drift.length) refuse(`inputs changed since the freeze: ${drift.join(", ")}`, 3);
if (BENCHMARK_V2_FIXTURES.length !== manifest.fixtures.total) refuse(`fixture count ${BENCHMARK_V2_FIXTURES.length} ≠ frozen ${manifest.fixtures.total}`, 3);

const cfg = manifest.run;
const disagree = (env: string, frozen: string) => {
  const v = Deno.env.get(env);
  if (v !== undefined && v.trim() !== frozen) refuse(`${env} disagrees with the freeze manifest (${frozen}).`);
};
disagree("FACET_BENCHMARK_V2_ARMS", cfg.arms.join(","));
disagree("FACET_BENCHMARK_V2_REPEATS", String(cfg.repeats));
disagree("FACET_BENCHMARK_GPT_MODEL", cfg.gpt.model);

const calls: ModelCallTelemetry[] = [];
const sink = (t: ModelCallTelemetry) => { calls.push(t); };

const arms: Arm[] = [];
for (const name of cfg.arms) {
  if (name === "current") {
    const b = buildGroundedBrainBinding({ workspaceId: "facet-benchmark-v2", originalUserQuery: null, callsRemaining: 100_000, onModelCall: sink });
    if (!b.groundCompany) refuse("the grounder is not available");
    if (b.diagnostics.model !== cfg.current_grounder_model) refuse(`the grounder would use ${b.diagnostics.model}, not the frozen ${cfg.current_grounder_model}`);
    arms.push(currentArmV2(b.groundCompany!, () => calls.at(-1)?.estimated_cost_usd ?? null));
  } else if (name === "gpt") {
    if (!Deno.env.get("OPENAI_API_KEY")) refuse("OPENAI_API_KEY is not set");
    arms.push(judgeArmV2("gpt_v2", gptV2Judge({ model: cfg.gpt.model, maxOutputTokens: cfg.gpt.max_output_tokens, deps: { onModelCall: sink } })));
  } else if (name === "jev") {
    const apiKey = Deno.env.get("JEV_API_KEY") ?? null;
    if (!apiKey) refuse("JEV_API_KEY is not set");
    arms.push(judgeArmV2("jev_v2", jevV2Judge({ apiKey, model: cfg.jev.model, onModelCall: sink })));
  } else refuse(`unknown arm ${name}`);
}

// Fixture-major, so a run stopped by the ceiling leaves every arm comparably covered.
const guard = new SpendGuard(cfg.spend_ceiling_usd);
const records: RunRecord[] = [];
let aborted: string | null = null;
outer: for (const f of BENCHMARK_V2_FIXTURES) {
  for (let r = 0; r < cfg.repeats; r++) {
    for (const arm of arms) {
      if (!guard.canStart()) { aborted = "spend_ceiling"; break outer; }
      const before = calls.length;
      records.push(await arm.run(f, r));
      guard.settle(calls.slice(before).map((c) => c.estimated_cost_usd));
    }
  }
}

const armNames = arms.map((a) => (a.name));
console.log(JSON.stringify({
  manifest_sha256: await sha256Hex(manifestBytes),
  arms: armNames, repeats: cfg.repeats, aborted, spend: guard.report(),
  fixtures: BENCHMARK_V2_FIXTURES.map((f) => ({ id: f.id, kind: f.kind, split: f.split, scored: f.scored ?? null })),
  analysis: analyzeV2({ records, fixtures: BENCHMARK_V2_FIXTURES, arms: armNames }),
  calls, records,
}));
