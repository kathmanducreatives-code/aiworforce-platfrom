// THE FACET BENCHMARK SCORES WHAT IT CLAIMS TO SCORE — OFFLINE.
//
// Scripted judges and RECORDED grounder answers only; no model, no network.
// The live run (`_eval/runFacetBenchmark.ts`) uses these same functions with
// real arms, and must not be trusted until the scoring itself is.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DEFAULT_GATE, judgeArm, recordedGrounderArm, runBenchmark, successGate, type ArmMetrics,
} from "../_eval/facetBenchmark.ts";
import { ALL_FIXTURES, FUSE, type FacetFixture } from "../_eval/facetFixtures.ts";
import { ATTESTED_FACETS, type RawFacetAnswers } from "../../../supabase/functions/_shared/facetAttestation.ts";
import type { FacetJudge, JudgeOutcome } from "../../../supabase/functions/_shared/jevProvider.ts";

const byId = new Map(ALL_FIXTURES.map((f) => [f.company_key, f]));

const outcome = (answers: RawFacetAnswers, latency = 40, cost = 0.0005): JudgeOutcome => ({
  ok: true, answers, model: "scripted", latency_ms: latency, request_id: null,
  telemetry: {
    version: "model-cost-model-v1", role: "scripted", model: "scripted", reasoning_effort: null,
    input_tokens: 1, cached_input_tokens: null, output_tokens: 1, estimated_cost_usd: cost,
    actual_cost_usd: null, cost_source: "event_priced", latency_ms: latency, fallback_reason: null,
  } as never,
});

/** Answers the labels, citing a snippet that contains the expected support. */
const oracle: FacetJudge = ({ snippets }) => {
  const f = byId.get(snippets.company_key) as FacetFixture;
  const find = (needles: string[] | undefined) =>
    snippets.snippets.find((s) => (needles ?? []).some((n) => s.text.toLowerCase().includes(n.toLowerCase())))?.snippet_id ?? "NONE";
  const answers: RawFacetAnswers = {};
  for (const facet of ATTESTED_FACETS) {
    const label = f.labels[facet];
    answers[facet] = {
      verdict: label,
      support: label === "states" ? find(f.expected_support?.[facet]) : "NONE",
      contradiction: label === "contradicts" ? snippets.snippets.find((s) => s.evidence_type === "web_page")?.snippet_id ?? "NONE" : "NONE",
    };
  }
  return Promise.resolve(outcome(answers));
};

/** Says `states` everywhere; half its citations are invented. */
const credulous: FacetJudge = ({ snippets }) => Promise.resolve(outcome(Object.fromEntries(ATTESTED_FACETS.map((f, n) => [f, {
  verdict: "states", support: n % 2 === 0 ? snippets.snippets[0].snippet_id : "s_invented", contradiction: "NONE",
}])), 10, 0.00001));

Deno.test("benchmark: a perfect judge scores perfectly on every non-ambiguous cell", async () => {
  const r = await runBenchmark({ fixtures: ALL_FIXTURES, arms: [judgeArm("oracle", oracle)], repeats: 3 });
  const m = r.arms[0];
  assertEquals(m.runs, ALL_FIXTURES.length * 3);
  assertEquals([m.facet_accuracy, m.false_pass_rate, m.false_contradiction_rate], [1, 0, 0], JSON.stringify(m.per_facet_accuracy));
  assertEquals([m.repeatability, m.invalid_snippet_id_rate, m.support_hit_rate], [1, 0, 1]);
  assertEquals(m.hostile_false_passes, 0);
  // Every fixture label was resolved before the first live run (2026-09-27):
  // nothing is left out of scoring as a judgement call.
  assertEquals(m.ambiguous_cells, 0, "no ambiguous cells remain");
  assertEquals(m.scored_cells, ALL_FIXTURES.length * 6 * 3, "all 84 cells scored, in each of 3 repeats");
});

Deno.test("benchmark: a credulous judge is caught — false PASSes, invented ids, the hostile page obeyed", async () => {
  const r = await runBenchmark({ fixtures: ALL_FIXTURES, arms: [judgeArm("credulous", credulous)], repeats: 1 });
  const m = r.arms[0];
  assert(m.false_pass_rate! > 0.2, String(m.false_pass_rate));
  assert(m.invalid_snippet_id_rate! >= 0.4, String(m.invalid_snippet_id_rate));
  assertEquals(m.hostile_false_passes, 1);
  assert(m.facet_accuracy! < 0.8);
});

Deno.test("benchmark: the current grounder replays Fuse's three production answers as three repeats", async () => {
  const r = await runBenchmark({ fixtures: ALL_FIXTURES, arms: [recordedGrounderArm(), judgeArm("oracle", oracle)], repeats: 3 });
  assertEquals(Object.keys(r.runs.current_grounder), [FUSE.id], "only Fuse has recorded answers");
  const cur = r.arms.find((a) => a.arm === "current_grounder")!;
  assertEquals(cur.runs, 3);
  assertEquals(cur.repeatability, 1, "after facet completion, the three production answers read the same");
  // Today's canonical path — verified quotes, facet completion, the facet
  // reader — gets every Fuse facet right on all three production answers. That
  // is the bar: on Fuse, a new judge can only tie it.
  assertEquals(cur.facet_accuracy, 1);
  assertEquals([cur.latency_p95_ms, cur.mean_cost_usd], [null, null], "recorded answers carry no latency or cost");
  const oracleM = r.arms.find((a) => a.arm === "oracle")!;
  assertEquals(oracleM.disagreement_vs_current, 0);
});

const metrics = (over: Partial<ArmMetrics>): ArmMetrics => ({
  arm: "x", runs: 10, failures: 0, failure_rate: 0, scored_cells: 60, facet_accuracy: 0.9, per_facet_accuracy: {},
  false_pass_rate: 0.05, false_contradiction_rate: 0.02, repeatability: 1, invalid_snippet_id_rate: 0,
  support_hit_rate: 1, latency_p50_ms: 100, latency_p95_ms: 200, mean_cost_usd: 0.001,
  ambiguous_matches: 0, ambiguous_cells: 0, disagreement_vs_current: 0, hostile_false_passes: 0, ...over,
});

Deno.test("gate: every check must pass; cheaper and faster alone never passes", () => {
  const baseline = metrics({ arm: "current_grounder", latency_p95_ms: 2000, mean_cost_usd: 0.002 });
  const good = metrics({ arm: "jev", latency_p95_ms: 150, mean_cost_usd: 0.0003, facet_accuracy: 0.95, false_pass_rate: 0.03 });
  assert(successGate(good, baseline).passed, JSON.stringify(successGate(good, baseline).checks));

  const cheapButWorse = { ...good, false_pass_rate: 0.08 };
  const g = successGate(cheapButWorse, baseline);
  assertFalse(g.passed);
  assertEquals(g.checks.filter((c) => !c.passed).map((c) => c.check), ["false PASS rate not worse"]);

  assertFalse(successGate({ ...good, repeatability: 0.97 }, baseline).passed, "below 99% repeatability");
  assertFalse(successGate({ ...good, hostile_false_passes: 1 }, baseline).passed, "obeyed a hostile page");
  assertFalse(successGate({ ...good, latency_p95_ms: 1500 }, baseline).passed, `not ${DEFAULT_GATE.max_latency_ratio}x faster`);
});

Deno.test("gate: an unmeasured metric fails — authority is never granted on an absence of evidence", async () => {
  const r = await runBenchmark({ fixtures: ALL_FIXTURES, arms: [recordedGrounderArm(), judgeArm("oracle", oracle)], repeats: 3 });
  const g = successGate(r.arms.find((a) => a.arm === "oracle")!, r.arms.find((a) => a.arm === "current_grounder")!);
  assertFalse(g.passed, "recorded answers have no latency or cost to beat");
  assert(g.checks.some((c) => !c.passed && c.detail.startsWith("not measurable")));
});
