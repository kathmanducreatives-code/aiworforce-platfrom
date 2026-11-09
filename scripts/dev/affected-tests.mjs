#!/usr/bin/env node
// AFFECTED TESTS — the local, targeted subset to run while iterating.
//
//   node scripts/dev/affected-tests.mjs [base]        # default base: origin/launch/hardening
//   node scripts/dev/affected-tests.mjs [base] --run  # and run them   (npm run test:changed)
//   … --only <substring>[,<substring>]   run the tests whose path contains it (manual override)
//   … --all                               every test in the selector's suites (no selection)
//   … --files <path>[,<path>]             treat exactly these files as changed (ask "what does X reach?")
//   … --near                              only tests whose imports/reads EXPLICITLY reach a change (seconds);
//                                         the conservative "reads-everything" tests are counted and named
//                                         for test:changed / test:pre-pr, never silently dropped
//
// A test is affected when its dependency closure reaches a changed file, using the
// CI planner's own conservative scanner (scripts/ci/planCore.mjs `closureOf`/`touches`):
// imports, literal file reads, and "everything" for a test that reads a path the
// scanner cannot name. A test file that changed is always affected.
//
// This is for speed while developing ONLY. It never replaces the full CI gate,
// which still runs every suite before anything merges.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { closureOf, touches } from "../ci/planCore.mjs";

/** The deno flags each test area runs with in CI (ci.yml / package.json). */
export const SUITES = [
  { prefix: "tests/edge-functions/", flags: ["--allow-read", "--allow-env", "--no-check"] },
  { prefix: "tests/infra/", flags: ["--allow-read", "--allow-env", "--allow-run"] },
  { prefix: "tests/frontend/", flags: ["--allow-read", "--no-check"] },
  { prefix: "tests/lead-v2-quality/", flags: ["--allow-read", "--allow-env", "--no-check"] },
  { prefix: "tests/replay/", flags: ["--allow-read", "--allow-env", "--no-check"] },
];
/** Node's runner, for the frontend .cjs tests (package.json test:ui:node). */
export const NODE_SUITE = { prefix: "tests/frontend/", suffix: ".test.cjs" };
/** Changed files that need no test (docs, fixtures' own README, lockfiles). */
const NO_TEST_NEEDED = /(^docs\/|\.md$|^\.github\/|package-lock\.json$|^dev-sim\/|\.(png|jpg|svg|webp)$)/;

const cache = new Map();
const read = (f) => {
  if (!cache.has(f)) { let t = null; try { t = readFileSync(f, "utf8"); } catch { /* missing: null */ } cache.set(f, t); }
  return cache.get(f);
};

/** Pure given a reader: which of `tests` are affected by `changed`. */
export function affected(tests, changed, readFile = read) {
  return tests.filter((t) => changed.includes(t) || changed.some((c) => touches(closureOf([t], readFile), c)));
}

function git(...args) { return execFileSync("git", args, { encoding: "utf8" }).split("\n").filter(Boolean); }

if (import.meta.url === `file://${process.argv[1]}`) {
  const t0 = Date.now();
  const argv = process.argv.slice(2);
  const onlyAt = argv.indexOf("--only");
  const only = onlyAt >= 0 ? (argv[onlyAt + 1] ?? "").split(",").filter(Boolean) : null;
  const filesAt = argv.indexOf("--files");
  const files = filesAt >= 0 ? (argv[filesAt + 1] ?? "").split(",").filter(Boolean) : null;
  const base = argv.find((a, i) => !a.startsWith("--") && i !== onlyAt + 1 && i !== filesAt + 1) ?? "origin/launch/hardening";
  const changed = files ?? [...new Set([...git("diff", "--name-only", `${base}...HEAD`), ...git("diff", "--name-only", "HEAD"), ...git("ls-files", "--others", "--exclude-standard")])];
  const tracked = git("ls-files", ...SUITES.map((s) => `${s.prefix}**/*.test.ts`), ...SUITES.map((s) => `${s.prefix}*.test.ts`), `${NODE_SUITE.prefix}*${NODE_SUITE.suffix}`);
  const tests = tracked.concat(git("ls-files", "--others", "--exclude-standard").filter((f) => /\.test\.(ts|cjs)$/.test(f)))
    .filter((f, i, a) => a.indexOf(f) === i && existsSync(f));
  // Each test's dependency closure ONCE (same result as `affected`, which recomputes it per
  // changed file — fine for its unit test, minutes on the real tree).
  const closures = new Map();
  const closure = (t) => { if (!closures.has(t)) closures.set(t, closureOf([t], read)); return closures.get(t); };
  const near = argv.includes("--near");
  const explicit = (t, c) => { const cl = closure(t); return cl.files.has(c) || cl.prefixes.some((p) => c.startsWith(p)); };
  const hit = argv.includes("--all") ? tests : only ? tests.filter((t) => only.some((o) => t.includes(o)))
    : near ? tests.filter((t) => changed.includes(t) || changed.some((c) => explicit(t, c)))
    : tests.filter((t) => changed.includes(t) || changed.some((c) => touches(closure(t), c)));
  if (near) {
    const deferred = tests.filter((t) => !hit.includes(t) && closure(t).everything);
    console.log(`--near: ${deferred.length} conservative test(s) read paths the scanner cannot name and are left to \`npm run test:changed\` / \`npm run test:pre-pr\``);
  }
  console.log(`changed: ${changed.length} file(s) ${files ? "(--files)" : `vs ${base} (incl. uncommitted)`}; ${only ? `--only ${only.join(",")}` : argv.includes("--all") ? "--all" : "affected"} tests: ${hit.length} of ${tests.length}`);
  if (!only && !argv.includes("--all")) {
    // NEVER SILENT: a changed source file that no test reaches is named, not skipped quietly.
    const uncovered = changed.filter((c) => !NO_TEST_NEEDED.test(c) && !/\.test\.(ts|cjs)$/.test(c) && !hit.some((t) => (near ? explicit(t, c) : touches(closure(t), c))));
    if (uncovered.length) console.log(`\n⚠ no test reaches ${uncovered.length} changed file(s) — add a test or run with --only/--all:\n  ${uncovered.slice(0, 15).join("\n  ")}${uncovered.length > 15 ? "\n  …" : ""}`);
  }
  const run = argv.includes("--run");
  let failed = false;
  for (const s of SUITES) {
    const files = hit.filter((f) => f.startsWith(s.prefix) && f.endsWith(".ts"));
    if (!files.length) continue;
    const cmd = ["deno", "test", ...s.flags, ...files];
    console.log(`\n${s.prefix} (${files.length}):\n  ${cmd.join(" ").slice(0, 400)}${cmd.join(" ").length > 400 ? " …" : ""}`);
    if (run) failed = spawnSync(cmd[0], cmd.slice(1), { stdio: "inherit" }).status !== 0 || failed;
  }
  const cjs = hit.filter((f) => f.endsWith(NODE_SUITE.suffix));
  if (cjs.length) {
    console.log(`\nnode --test (${cjs.length}): ${cjs.join(" ")}`);
    if (run) failed = spawnSync("node", ["--test", ...cjs], { stdio: "inherit" }).status !== 0 || failed;
  }
  if (run) { console.log(`\ntest:changed ${failed ? "FAILED" : "passed"} in ${((Date.now() - t0) / 1000).toFixed(1)} s`); process.exit(failed ? 1 : 0); }
}
