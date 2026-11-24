// ATLAS SIMULATOR (npm run dev:atlas) — a lead-discovery request through the real
// lead-pipeline service, offline, with a full inspection report.
//
//   npm run dev:atlas                         # list scenarios
//   npm run dev:atlas -- <scenario>           # run one (name or file), print the report
//   npm run dev:atlas -- <scenario> --json    # also write dev-sim/<scenario>.json (redacted)
//   npm run dev:atlas -- <scenario> --preview # also feed the Workbench dev preview (dev-sim/preview.json)
//   npm run dev:atlas -- --all                # every scenario, one summary line each
//   npm run dev:atlas -- --query "Find …"     # your own wording with the happy-path interpretation
//
// Scenarios: tests/fixtures/atlas-sim/*.json. NO network: fetch is disabled, so a code path
// that would reach a provider fails loudly instead of spending. Never touches a database.

import { loadScenarios, runScenario, type Scenario } from "./atlas-sim/harness.ts";
import { previewSimulation, redact, renderReport } from "./atlas-sim/report.ts";

globalThis.fetch = (() => { throw new Error("network disabled in the ATLAS simulator"); }) as typeof fetch;

const ROOT = new URL("../../", import.meta.url);
const DIR = new URL("tests/fixtures/atlas-sim/", ROOT);
const OUT = new URL("dev-sim/", ROOT);
const args = Deno.args;
const flag = (f: string) => args.includes(f);
const valueOf = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const scenarios = await loadScenarios(DIR);

async function write(name: string, data: unknown) {
  await Deno.mkdir(OUT, { recursive: true });
  const f = new URL(name, OUT);
  await Deno.writeTextFile(f, JSON.stringify(data, null, 1) + "\n");
  return f.pathname;
}

if (flag("--all")) {
  const t0 = performance.now();
  for (const s of scenarios) {
    const r = await runScenario(s);
    const run = r.runs[r.runs.length - 1];
    const o = (run?.body.outcome ?? {}) as { status?: string; qualified?: number; needsVerification?: number };
    console.log(`${s.name.padEnd(34)} plan ${r.plan.status}${r.plan.body.status ? `/${r.plan.body.status}` : ""}  run ${run ? run.status : "—"}  ${o.status ?? ""}  qualified=${o.qualified ?? "—"} review=${o.needsVerification ?? "—"}  actors=${r.actorCalls.length}  leads=${r.db.leads.length}`);
  }
  console.log(`\n${scenarios.length} scenarios in ${(performance.now() - t0).toFixed(0)} ms — SIMULATED DATA, no external providers called`);
  Deno.exit(0);
}

const queryArg = valueOf("--query");
const name = args.find((a) => !a.startsWith("--") && a !== queryArg);
let scenario: Scenario | undefined;
if (queryArg) {
  const base = scenarios.find((s) => s.name === "happy-path-b2b-hiring")!;
  scenario = { ...base, name: "custom-query", description: "Your wording, with the happy-path interpretation and companies (edit the scenario JSON for a different reading).", query: queryArg };
} else if (name) {
  scenario = scenarios.find((s) => s.name === name || `${s.name}.json` === name || name.endsWith(`/${s.name}.json`));
}
if (!scenario) {
  console.log("ATLAS simulator — SIMULATED DATA, NO EXTERNAL PROVIDERS CALLED\n\nScenarios (tests/fixtures/atlas-sim/):");
  for (const s of scenarios) console.log(`  ${s.name.padEnd(34)} ${s.description}`);
  console.log("\nUsage: npm run dev:atlas -- <scenario> [--json] [--preview] | --all | --query \"…\"");
  Deno.exit(name ? 1 : 0);
}

const r = await runScenario(scenario);
console.log(renderReport(r));
if (flag("--json")) console.log(`\nreport JSON: ${await write(`${scenario.name}.json`, redact(r))}`);
if (flag("--preview")) console.log(`Workbench preview fed: ${await write("preview.json", previewSimulation(r))} — open the app with VITE_STRATEGY_DISCOVERY_MOCK=true (npm run dev:fast)`);
