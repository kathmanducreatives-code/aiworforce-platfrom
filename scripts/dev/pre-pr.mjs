#!/usr/bin/env node
// TEST:PRE-PR — Level 2: the CI gates you can run locally, in CI's order, with timings.
// Run it once the change behaves in the simulator and `check:fast` passes, before pushing.
//
//   npm run test:pre-pr            # everything below
//   npm run test:pre-pr -- --quick # skip the production build (the slowest step)
//
// Mirrors .github/workflows/ci.yml jobs `backend`, `replay` and `frontend`. Jobs that need
// Docker + Postgres + PostgREST (`contract`, `mutation`, `realprocess`) are CI-only and are
// listed at the end, never reported as passed. CI and branch protection are unchanged.

import { spawnSync, execSync } from "node:child_process";

const quick = process.argv.includes("--quick");
const sh = (cmd) => ["bash", ["-c", cmd]];
const STEPS = [
  ["deno check (edge functions + worker)", ...sh("{ ls supabase/functions/*/index.ts | grep -v '/mcp/index.ts'; echo worker/main.ts; } | xargs deno check")],
  ["edge-function tests", "deno", ["test", "--allow-read", "--allow-env", "--no-check", "--reporter=dot", "tests/edge-functions/"]],
  ["deploy-safety tests (tests/infra)", "deno", ["test", "--allow-read", "--allow-env", "--allow-run", "--reporter=dot", "tests/infra/"]],
  ["QA harness tests", ...sh("deno test --allow-read --allow-env --reporter=dot scripts/lead-quality-benchmark/ && deno test --allow-read --allow-env --reporter=dot scripts/model-routing-eval/")],
  ["Replay Lab (Lead V2 readiness)", ...sh("deno check tests/replay/lib/*.ts && npm run -s test:lead-v2-readiness")],
  ["frontend tests (deno)", "npm", ["run", "-s", "test:ui"]],
  ["frontend tests (node)", "npm", ["run", "-s", "test:ui:node"]],
  ["type ratchet", "node", ["scripts/ci/ratchet.mjs", "tsc"]],
  ["lint ratchet", "node", ["scripts/ci/ratchet.mjs", "eslint"]],
  ...(quick ? [] : [["production build", "npm", ["run", "-s", "build"]]]),
];
const CI_ONLY = [
  "Database contract (3 shards) — Docker Postgres 17 + pinned PostgREST: every literal query against the migrated schema",
  "Mutation proofs — Docker Postgres: the database-level fences reject the mutations they must",
  "Real worker processes — Docker Postgres: the Railway worker against a real database",
  "CI gate — the required check that judges all of the above (branch protection requires it)",
];

const results = [];
const t0 = Date.now();
for (const [name, cmd, args] of STEPS) {
  const t = Date.now();
  console.log(`\n━━ ${name} ━━`);
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  results.push({ name, ok: r.status === 0, s: (Date.now() - t) / 1000 });
}
let sha = "";
try { sha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(); } catch { /* not a repo */ }
console.log(`\n══ test:pre-pr @ ${sha}${quick ? " (--quick: no build)" : ""} ══`);
for (const r of results) console.log(`  ${r.ok ? "✓" : "✗"} ${r.name.padEnd(42)} ${r.s.toFixed(1).padStart(6)} s`);
console.log(`  total ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log("\nCI-only (not run here; Docker-backed — GitHub runs them on the PR):");
for (const c of CI_ONLY) console.log(`  · ${c}`);
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\ntest:pre-pr FAILED (${failed.map((f) => f.name).join(", ")})` : "\ntest:pre-pr passed locally — push and let CI run the rest");
process.exit(failed.length ? 1 : 0);
