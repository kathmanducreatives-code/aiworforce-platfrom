// Run the offline planner comparison and print the report.
//   deno run --allow-read --allow-env tests/planner-eval/run.ts
// No network flag is granted, and none is needed.

import { EVAL_SET } from "./dataset.ts";
import { runPlanner, scoreCase, decliningStubs, type CaseResult, type PlannerName } from "./harness.ts";
import { CRITERIA, decide } from "./rubric.ts";

const counter = { gpt: 0, claude: 0 };
const results: CaseResult[] = [];

for (const c of EVAL_SET) {
  for (const p of ["gpt", "claude"] as PlannerName[]) {
    results.push(scoreCase(c, await runPlanner(p, c, decliningStubs(counter))));
  }
}

const side = (p: PlannerName) => results.filter((r) => r.planner === p);
const agg = (p: PlannerName) => {
  const rs = side(p);
  return {
    name: p,
    cases: rs.length,
    score: Number((rs.reduce((a, r) => a + r.total, 0) / rs.length).toFixed(2)),
    severe: rs.reduce((a, r) => a + r.severe.length, 0),
    produced: rs.filter((r) => r.plan.produced).length,
    fallback: rs.filter((r) => r.plan.outcome === "deterministic_fallback").length,
    validated: rs.filter((r) => r.plan.outcome === "model_validated").length,
    modelReqs: rs.reduce((a, r) => a + r.plan.modelRequests, 0),
    latency: Math.round(rs.reduce((a, r) => a + r.plan.latencyMs, 0) / rs.length),
  };
};

const g = agg("gpt"), c = agg("claude");
const d = decide(g, c);

console.log("\n=== PER-CRITERION MEAN (0-1) ===");
console.log("criterion".padEnd(34) + "wt".padStart(4) + "GPT".padStart(8) + "CLAUDE".padStart(9));
for (const crit of CRITERIA) {
  const m = (p: PlannerName) =>
    (side(p).reduce((a, r) => a + (r.scores[crit.key] ?? 0), 0) / side(p).length).toFixed(2);
  console.log(crit.key.padEnd(34) + String(crit.weight).padStart(4) + m("gpt").padStart(8) + m("claude").padStart(9));
}

console.log("\n=== TOTALS ===");
for (const a of [g, c]) {
  console.log(`${a.name.toUpperCase().padEnd(7)} score=${String(a.score).padStart(6)}  severe=${a.severe}  ` +
    `produced=${a.produced}/${a.cases}  validated=${a.validated}  fallback=${a.fallback}  ` +
    `modelReqs=${a.modelReqs}  meanLatency=${a.latency}ms`);
}

console.log("\n=== SEVERE FAILURES ===");
for (const r of results.filter((r) => r.severe.length)) {
  console.log(`  ${r.planner.padEnd(7)} ${r.caseId.padEnd(14)} ${r.severe.join(", ")}`);
}

console.log("\n=== PER-CASE DIFF (total score) ===");
for (const cs of EVAL_SET) {
  const gg = results.find((r) => r.caseId === cs.id && r.planner === "gpt")!;
  const cc = results.find((r) => r.caseId === cs.id && r.planner === "claude")!;
  const delta = (gg.total - cc.total).toFixed(1);
  const mark = Math.abs(gg.total - cc.total) < 0.05 ? "=" : (gg.total > cc.total ? "GPT" : "CLA");
  console.log(`  ${cs.id.padEnd(14)} gpt=${String(gg.total).padStart(6)} claude=${String(cc.total).padStart(6)} d=${delta.padStart(6)} ${mark}`);
}

console.log(`\n=== DECISION ===\n  ${d.result}${d.winner ? ` = ${d.winner.toUpperCase()}` : ""}\n  ${d.why}`);
console.log(`\n  model requests actually made: gpt=${counter.gpt} claude=${counter.claude} (stubbed, zero network)\n`);
