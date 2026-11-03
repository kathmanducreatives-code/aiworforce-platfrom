// ATLAS evaluation corpus v1 + qualification-verdict replay (root-cause review, Stage 0).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadCorpus, metrics, runCorpus } from "../../../scripts/dev/atlas-eval.ts";
import { diffVerdicts, VERDICT_BASELINE_PATH, verdicts } from "../../../scripts/dev/verdict-replay.ts";

Deno.test("corpus: every case meets its label, or is wrong ONLY where a known defect is labelled", async () => {
  const r = await runCorpus();
  const m = metrics(r);
  assertEquals(m.wrongUnlabelled, [], "a case broke that no known defect explains (a regression)");
  assertEquals(m.fixedButStillLabelled, [], "a labelled defect is fixed: remove its label in the same change");
});

Deno.test("corpus: the labels are independent of code (no case without an expectation; ids unique)", () => {
  const c = loadCorpus();
  const ids = [...c.geography, ...c.titles].map((x) => x.id);
  assertEquals(new Set(ids).size, ids.length);
  for (const g of c.geography) assert(["pass", "fail", "unknown", "not_pass"].includes(g.expect), g.id);
  for (const t of c.titles) assert(["counts", "excluded"].includes(t.expect), t.id);
});

Deno.test("verdict replay: stored production candidates keep their recorded qualification verdicts (a change is a reviewed re-record)", async () => {
  const recorded = JSON.parse(await Deno.readTextFile(new URL(`../../../${VERDICT_BASELINE_PATH}`, import.meta.url)));
  const d = diffVerdicts(recorded, await verdicts());
  assertEquals(d.map((x) => `${x.key}: ${x.checks.join(" | ")}`), []);
});
