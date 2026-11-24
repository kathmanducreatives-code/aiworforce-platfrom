// The first live paraphrase study (run 41990176436, 2026-11-05, contract v3, gpt-5.6-luna,
// 165 calls, $0.215193) — its failures, classified by the harness's own rule
// (classifyFailure: replay the LIVE understanding with the corpus's recorded legacy fields).
// Pinned so the analysis in docs/benchmarks/live-paraphrase/2026-11-05.md stays true to the data.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyFailure } from "../../../scripts/dev/live-paraphrase-study.ts";
import { loadCases } from "../../../scripts/dev/interpretation-corpus.ts";

const study = JSON.parse(await Deno.readTextFile(new URL("../../../docs/benchmarks/live-paraphrase/2026-11-05.json", import.meta.url)));
const cases = loadCases();

Deno.test("live study 2026-11-05: totals as recorded", () => {
  assertEquals([study.calls, study.correct, study.refused, study.spent_usd], [165, 96, 0, 0.215193]);
  assertEquals(study.collapsed_contrasts, ["M14 vs M20"]);
});

Deno.test("live study 2026-11-05: every failure classified (model / compiler / transport)", () => {
  const tally: Record<string, number> = {};
  const byClass: Record<string, Set<string>> = {};
  for (const r of study.rows) {
    if (r.ok) continue;
    const c = cases.find((x) => x.id === r.case)!;
    const k = classifyFailure(c, c.phrasings.find((x) => x.label === r.label)!, r);
    tally[k] = (tally[k] ?? 0) + 1;
    (byClass[k] ??= new Set()).add(r.case);
  }
  assertEquals(tally, { transport: 3, model_clarification: 24, model_understanding: 6, compiled_wrongly: 36 });
  assertEquals([...byClass.model_understanding].sort(), ["M05", "M20", "M23"]);
  assertEquals([...byClass.transport], ["M01"]);
});
