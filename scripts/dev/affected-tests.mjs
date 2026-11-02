#!/usr/bin/env node
// AFFECTED TESTS — the local, targeted subset to run while iterating.
//
//   node scripts/dev/affected-tests.mjs [base]        # default base: origin/launch/hardening
//   node scripts/dev/affected-tests.mjs [base] --run  # and run them
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
];

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
  const base = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "origin/launch/hardening";
  const changed = [...new Set([...git("diff", "--name-only", `${base}...HEAD`), ...git("diff", "--name-only", "HEAD"), ...git("ls-files", "--others", "--exclude-standard")])]
    .filter((f) => existsSync(f) || true);
  const tests = git("ls-files", ...SUITES.map((s) => `${s.prefix}**/*.test.ts`), ...SUITES.map((s) => `${s.prefix}*.test.ts`))
    .concat(git("ls-files", "--others", "--exclude-standard").filter((f) => /\.test\.ts$/.test(f)))
    .filter((f, i, a) => a.indexOf(f) === i && existsSync(f));
  const hit = affected(tests, changed);
  console.log(`changed: ${changed.length} file(s); affected tests: ${hit.length} of ${tests.length}`);
  const run = process.argv.includes("--run");
  let failed = false;
  for (const s of SUITES) {
    const files = hit.filter((f) => f.startsWith(s.prefix));
    if (!files.length) continue;
    const cmd = ["deno", "test", ...s.flags, ...files];
    console.log(`\n${s.prefix} (${files.length}):\n  ${cmd.join(" ")}`);
    if (run) failed = spawnSync(cmd[0], cmd.slice(1), { stdio: "inherit" }).status !== 0 || failed;
  }
  if (run) process.exit(failed ? 1 : 0);
}
