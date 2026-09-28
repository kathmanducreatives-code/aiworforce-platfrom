// BENCHMARK V2 ANALYSIS — PURE, OFFLINE, RE-RUNNABLE FROM THE RECORDED RAW ANSWERS.
//
// The live runner calls `analyzeV2` on what it recorded; the same function
// re-scores a saved results file without any model call:
//
//   deno run --no-lock --allow-read=. tests/edge-functions/_eval/v2/analyze.ts <results.json>
//
// Per candidate facet (software_product, ai_product) and judge arm: the
// threshold is chosen on the TUNE split, then applied once to the HELD-OUT
// split, and the gate compares that with the current grounder on held-out.
// Every decision is also scored on dev / tune / held-out for the record.

import { gateV2, scoreV2, tuneThreshold, type ArmScore, type GateCheck, type RunRecord } from "./benchmark.ts";
import { BENCHMARK_V2_FIXTURES, GATE_FACETS } from "./realFixtures.ts";
import type { V2Fixture } from "./fixtures.ts";

export const CURRENT_ARM = "current_grounder";

export function analyzeV2(i: { records: RunRecord[]; fixtures: V2Fixture[]; arms: string[] }) {
  const scores: Record<string, { dev: ArmScore; tune: ArmScore; heldout: ArmScore }> = {};
  for (const arm of i.arms) {
    scores[arm] = {
      dev: scoreV2({ records: i.records, fixtures: i.fixtures, arm, splits: ["dev"] }),
      tune: scoreV2({ records: i.records, fixtures: i.fixtures, arm, splits: ["tune"] }),
      heldout: scoreV2({ records: i.records, fixtures: i.fixtures, arm, splits: ["heldout"] }),
    };
  }
  const tuned: Record<string, unknown> = {};
  const gates: Record<string, { passed: boolean; checks: GateCheck[] }> = {};
  const fail = (check: string, detail: string) => ({ passed: false, checks: [{ check, passed: false, detail }] });
  for (const arm of i.arms.filter((a) => a !== CURRENT_ARM)) {
    for (const d of GATE_FACETS) {
      const t = tuneThreshold({ records: i.records, fixtures: i.fixtures, arm, decision: d });
      tuned[`${arm}.${d}`] = t;
      const current = scores[CURRENT_ARM]?.heldout;
      gates[`${arm}.${d}`] = !t ? fail("a tune-split threshold reaches the precision target", "none does")
        : !current ? fail("the current grounder was measured", "current arm not run")
        : gateV2(d, scoreV2({ records: i.records, fixtures: i.fixtures, arm, splits: ["heldout"], thresholds: t.thresholds }), current);
    }
  }
  return { candidate_facets: GATE_FACETS, scores, tuned, gates };
}

if (import.meta.main) {
  const path = Deno.args[0];
  if (!path) { console.error("usage: analyze.ts <results.json>"); Deno.exit(2); }
  const r = JSON.parse(await Deno.readTextFile(path)) as { records: RunRecord[]; arms: string[] };
  console.log(JSON.stringify(analyzeV2({ records: r.records, fixtures: BENCHMARK_V2_FIXTURES, arms: r.arms }), null, 1));
}
