#!/usr/bin/env node
// Run a checker and hold it to its committed baseline (see ratchetCore.mjs).
//
//   node scripts/ci/ratchet.mjs tsc            # fail on any new type error
//   node scripts/ci/ratchet.mjs eslint         # fail on any new lint error
//   node scripts/ci/ratchet.mjs tsc --update   # after fixing debt: lower the baseline
//
// Baselines live in scripts/ci/baselines/<tool>.json and are reviewed like code:
// a diff that RAISES one is adding debt on purpose, and should say why.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compareCounts, formatBaseline, parseEslint, parseTsc } from "./ratchetCore.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const [tool, ...flags] = process.argv.slice(2);
const update = flags.includes("--update");

const TOOLS = {
  tsc: () => {
    const r = spawnSync("npx", ["--no-install", "tsc", "--noEmit", "--pretty", "false", "-p", "tsconfig.app.json"],
      { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.error) throw r.error;
    // tsc exits 2 when it finds errors — that is data here, not a crash.
    if (r.status !== 0 && r.status !== 2) throw new Error(`tsc exited ${r.status}: ${r.stderr.slice(0, 500)}`);
    return parseTsc(r.stdout, root);
  },
  eslint: () => {
    const r = spawnSync("npx", ["--no-install", "eslint", ".", "-f", "json"],
      { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    if (r.error) throw r.error;
    // eslint exits 1 when it finds errors; 2 is a real failure (bad config).
    if (r.status !== 0 && r.status !== 1) throw new Error(`eslint exited ${r.status}: ${r.stderr.slice(0, 500)}`);
    return parseEslint(r.stdout, root);
  },
};

if (!TOOLS[tool]) {
  console.error(`usage: ratchet.mjs <${Object.keys(TOOLS).join("|")}> [--update]`);
  process.exit(2);
}
const baselinePath = join(here, "baselines", `${tool}.json`);
const current = TOOLS[tool]();
if (update) {
  writeFileSync(baselinePath, formatBaseline(current));
  console.log(`${tool}: baseline written — ${Object.values(current).reduce((a, b) => a + b, 0)} finding(s) in ${Object.keys(current).length} file/code pair(s)`);
  process.exit(0);
}
if (!existsSync(baselinePath)) {
  console.error(`${tool}: no baseline at ${baselinePath} — run with --update once, and commit it`);
  process.exit(2);
}
const result = compareCounts(current, JSON.parse(readFileSync(baselinePath, "utf8")));
console.log(`${tool}: ${result.total_now} finding(s) now, ${result.total_baseline} in the baseline`);
for (const r of result.regressions) console.log(`  NEW   ${r.key}: ${r.was} → ${r.now}`);
if (result.improvements.length) {
  console.log(`  ${result.improvements.length} file/code pair(s) improved — lower the baseline: node scripts/ci/ratchet.mjs ${tool} --update`);
}
process.exit(result.ok ? 0 : 1);
