// BENCHMARK V2 FREEZE — WRITES THE MANIFEST ONCE, BEFORE ANY MODEL RESULT. NO NETWORK.
//
//   deno run --no-lock --allow-read=. --allow-write=tests/edge-functions/_eval/baselines/benchmark-v2 \
//     --allow-run=deno,git,chmod tests/edge-functions/_eval/v2/freeze.ts
//
// Hashes every benchmark-owned input (contract, definitions, questions, labels,
// evidence, adjudications, gate set, split, scoring, analysis, runner, and the
// offline scripts that produced the data), plus every production module the
// live run loads (arm dependencies: recorded, and checked by the runner, so a
// result can only ever describe the code that was frozen). Refuses to overwrite
// a manifest, and refuses if any V2 result already exists.

import { BENCHMARK_V2_FIXTURES, GATE_FACETS, GATE_SPLIT_SHA256, REAL_V2 } from "./realFixtures.ts";
import { registryForV2 } from "./fixtures.ts";
import { BENCHMARK_V2_VERSION, buildEvidenceDocument } from "./contract.ts";
import { buildJevV2Request, gptV2Schema, gptV2User, GPT_V2_SYSTEM } from "./judges.ts";
import { decisionValue } from "./benchmark.ts";
import { RUN_COST_BOUND_USD, sha256Hex } from "./runGuards.ts";
import { DEFAULT_JEV_MODEL } from "../../../../supabase/functions/_shared/jevProvider.ts";
import { isGroundedBrainEnabled } from "../../../../supabase/functions/_shared/groundedBrainBinding.ts";
import { buildModelTelemetry } from "../../../../supabase/functions/_shared/modelCostModel.ts";
import gateSet from "./real/gate-set-sw-ai.json" with { type: "json" };

const root = new URL("../../../../", import.meta.url);
const rootPath = decodeURIComponent(root.pathname);
const dir = "tests/edge-functions/_eval/baselines/benchmark-v2/";
const out = async (args: string[], cmd = "deno") => new TextDecoder().decode((await new Deno.Command(cmd, { args, cwd: rootPath, stdout: "piped" }).output()).stdout);

await Deno.mkdir(new URL(dir, root), { recursive: true });
for await (const e of Deno.readDir(new URL(dir, root))) {
  if (e.name === "freeze-manifest.json") throw new Error("Benchmark V2 is already frozen; refusing to overwrite the manifest");
  if (e.name.startsWith("results")) throw new Error("a V2 result exists; a freeze must precede every model result");
}

// ── the files ───────────────────────────────────────────────────────────────
const graph = JSON.parse(await out(["info", "--json", "--no-lock", "--no-remote", "tests/edge-functions/_eval/v2/run.ts"])) as { modules: Array<{ local?: string }> };
const locals = graph.modules.map((m) => m.local).filter((p): p is string => !!p && p.startsWith(rootPath)).map((p) => p.slice(rootPath.length));
const OWNED = "tests/edge-functions/_eval/";
const DATA = [
  "tests/edge-functions/_eval/v2/real/companies.json", "tests/edge-functions/_eval/v2/real/label-proposals.json",
  "tests/edge-functions/_eval/v2/real/adjudication-sw-ai.json", "tests/edge-functions/_eval/v2/real/reserve-candidates.json",
  "tests/edge-functions/_eval/v2/real/extract.py", "tests/edge-functions/_eval/v2/real/proposals.py",
  "tests/edge-functions/_eval/v2/real/adjudicate.py", "tests/edge-functions/_eval/v2/real/select_reserve.py",
  "tests/edge-functions/_eval/v2/real/vet_reserve.py", "tests/edge-functions/_eval/v2/real/gate_set.py",
  "tests/edge-functions/_eval/v2/freeze.ts",
];
const hashAll = async (paths: string[]) => Object.fromEntries(await Promise.all([...new Set(paths)].sort().map(async (p) => [p, await sha256Hex(await Deno.readFile(new URL(p, root)))])));
const frozen_inputs = await hashAll([...locals.filter((p) => p.startsWith(OWNED)), ...DATA]);
const arm_dependencies = await hashAll(locals.filter((p) => !p.startsWith(OWNED)));

// ── the cells ───────────────────────────────────────────────────────────────
const tally = (split?: string) => Object.fromEntries(GATE_FACETS.map((d) => {
  const fx = REAL_V2.filter((f) => f.scored!.includes(d) && (!split || f.split === split));
  const yes = fx.filter((f) => decisionValue(d, f.labels)).length;
  return [d, { YES: yes, NO: fx.length - yes }];
}));
const cells = { total: tally(), heldout: tally("heldout"), tune: tally("tune") };
for (const d of GATE_FACETS) for (const s of ["total", "heldout", "tune"] as const) {
  const want = (gateSet.counts as Record<string, Record<string, { YES: number; NO: number }>>)[d][s];
  const got = (cells[s] as Record<string, { YES: number; NO: number }>)[d];
  if (want.YES !== got.YES || want.NO !== got.NO) throw new Error(`fixtures disagree with the gate set: ${d} ${s}`);
}
// Every cell left out of the gate is NOT_DETERMINABLE — no REVIEW cell remains.
const unresolved = gateSet.excluded.filter((x) => /REVIEW/.test(`${x.software} ${x.ai}`) || !/NOT_DETERMINABLE|EXCLUDED \(contract/.test(`${x.software} ${x.ai}`));
if (unresolved.length) throw new Error(`unresolved review cells: ${JSON.stringify(unresolved)}`);

// ── the run and its spend ───────────────────────────────────────────────────
const REPEATS = 5, ARMS = ["current", "gpt", "jev"];
const GPT = { model: "gpt-5.6-luna", temperature: 0, reasoning_effort: "none", max_output_tokens: 2000 };
const CHARS_PER_TOKEN = 13178 / 3438; // Benchmark V1: mean Jev request chars ÷ mean billed input tokens
const V1_GROUNDER_USD_PER_CALL = 0.000852; // Benchmark V1 measured mean (evidence pages larger than these descriptions)
const GPT_OUTPUT_TOKENS_EST = 300; // V1 measured 230 for a smaller answer
const price = (model: string, input: number, output: number) =>
  buildModelTelemetry({ role: "freeze_estimate", model, usage: { input_tokens: Math.round(input), output_tokens: output, cached_input_tokens: null }, latency_ms: 0 }).estimated_cost_usd ?? 0;
let jev = 0, gpt = 0;
for (const f of BENCHMARK_V2_FIXTURES) {
  const doc = buildEvidenceDocument(registryForV2(f));
  jev += price(DEFAULT_JEV_MODEL, JSON.stringify(buildJevV2Request(doc)).length / CHARS_PER_TOKEN, 0);
  gpt += price(GPT.model, (GPT_V2_SYSTEM.length + gptV2User(doc).length + JSON.stringify(gptV2Schema(doc)).length) / CHARS_PER_TOKEN, GPT_OUTPUT_TOKENS_EST);
}
const n = BENCHMARK_V2_FIXTURES.length;
const estimate = { current_grounder: V1_GROUNDER_USD_PER_CALL * n * REPEATS, gpt: gpt * REPEATS, jev: jev * REPEATS };
const expectedUsd = estimate.current_grounder + estimate.gpt + estimate.jev;

const manifest = {
  benchmark: "facet-benchmark-v2",
  contract_version: BENCHMARK_V2_VERSION,
  created_at: new Date().toISOString(),
  git_head: (await out(["rev-parse", "HEAD"], "git")).trim(),
  created_before_model_results: true,
  candidate_facets: GATE_FACETS,
  companies: { final_real_companies: REAL_V2.length, list: "tests/edge-functions/_eval/v2/real/gate-set-sw-ai.json" },
  scored_cells: cells,
  excluded_not_determinable: gateSet.excluded.filter((x) => /NOT_DETERMINABLE/.test(`${x.software} ${x.ai}`)),
  excluded_software_contract: gateSet.software_contract_excluded,
  split: { sha256: GATE_SPLIT_SHA256, rule: gateSet.rule },
  fixtures: {
    total: n, real_gate: REAL_V2.length, dev: n - REAL_V2.length,
    dev_note: "2 full-contract production fixtures + synthetic/hostile fixtures; scored on dev only, never a gate",
  },
  run: {
    arms: ARMS, repeats: REPEATS,
    gpt: GPT,
    jev: { model: DEFAULT_JEV_MODEL },
    current_grounder_model: isGroundedBrainEnabled("facet-benchmark-v2", () => undefined).model,
    spend_ceiling_usd: 5,
    run_cost_bound_usd: RUN_COST_BOUND_USD,
    expected_arm_runs: n * REPEATS * ARMS.length,
    max_http_requests: n * REPEATS * (1 /* jev: no retry */ + 2 /* gpt: one retry */ + 2 /* grounder: one retry */),
  },
  spend_estimate_usd: {
    expected: Number(expectedUsd.toFixed(4)),
    by_arm: Object.fromEntries(Object.entries(estimate).map(([k, v]) => [k, Number(v.toFixed(4))])),
    basis: "request chars ÷ V1 chars-per-token; published prices in modelCostModel; grounder at V1's measured mean per call; GPT output 300 tokens",
  },
  frozen_inputs,
  arm_dependencies,
};
const path = new URL(dir + "freeze-manifest.json", root);
await Deno.writeTextFile(path, JSON.stringify(manifest, null, 1) + "\n");
await out(["444", decodeURIComponent(path.pathname)], "chmod");
console.log(JSON.stringify({ ...manifest, frozen_inputs: Object.keys(frozen_inputs).length, arm_dependencies: Object.keys(arm_dependencies).length }, null, 1));
