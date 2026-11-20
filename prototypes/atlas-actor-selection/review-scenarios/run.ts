// Runs the architecture-review scenarios (this folder) through the real ATLAS simulator
// harness. Offline: fetch is disabled exactly as in scripts/dev/atlas-sim.ts.
//   deno run --allow-read --no-check prototypes/atlas-actor-selection/review-scenarios/run.ts [--full]
import { runScenario, type Scenario } from "../../../scripts/dev/atlas-sim/harness.ts";
import { renderReport } from "../../../scripts/dev/atlas-sim/report.ts";

globalThis.fetch = (() => { throw new Error("network disabled in the ATLAS simulator"); }) as typeof fetch;
const dir = new URL("./", import.meta.url);
const files = [...Deno.readDirSync(dir)].filter((e) => e.name.endsWith(".json")).map((e) => e.name).sort();
for (const f of files) {
  const s = JSON.parse(Deno.readTextFileSync(new URL(f, dir))) as Scenario;
  const r = await runScenario(s);
  const report = renderReport(r);
  console.log(`\n== ${s.name} — “${s.query}”`);
  const keep = /^(plan HTTP|mandatory|preferences|BLOCKED|question|outcome|strategy:| {2}step|ESTIMATED| {2}required| {2}preferred)/;
  console.log((Deno.args.includes("--full") ? report : report.split("\n").filter((l) => keep.test(l)).join("\n")).replace(/(.{330}).+/g, "$1…"));
}
