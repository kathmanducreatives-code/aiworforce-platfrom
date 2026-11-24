#!/usr/bin/env node
// CHECK:FAST — Level 1 of the local loop (docs/dev/LOCAL_DEVELOPMENT.md): only what your
// change touches, in seconds, before a commit.
//
//   npm run check:fast            # vs origin/launch/hardening, incl. uncommitted + untracked
//   npm run check:fast -- <base>
//
// 1. deno check   — changed Deno files (supabase/functions, scripts/*.ts, worker, tests/*.ts)
// 2. tsc          — the frontend project, only when a src/ file changed (the ratchet's baseline
//                   applies in CI; here any NEW error in a changed file is shown)
// 3. eslint       — changed .ts/.tsx/.mjs/.js files only
// 4. tests        — the tests that EXPLICITLY reach your change (affected-tests --near --run);
//                   the conservative remainder runs in `npm run test:changed` / `test:pre-pr`
//
// It never replaces `npm run test:pre-pr` or CI; it is the fast feedback while editing.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const base = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "origin/launch/hardening";
const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).split("\n").filter(Boolean);
const changed = [...new Set([...git("diff", "--name-only", `${base}...HEAD`), ...git("diff", "--name-only", "HEAD"), ...git("ls-files", "--others", "--exclude-standard")])]
  .filter((f) => existsSync(f));
const results = [];
function step(name, cmd, args, opts = {}) {
  const t = Date.now();
  console.log(`\n▶ ${name}\n  ${[cmd, ...args].join(" ").slice(0, 300)}`);
  const r = spawnSync(cmd, args, { stdio: opts.quiet ? "pipe" : "inherit", encoding: "utf8" });
  const ok = r.status === 0;
  if (opts.quiet) {
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    const lines = opts.filter ? out.split("\n").filter(opts.filter) : out.split("\n");
    if (lines.join("").trim()) console.log(lines.slice(0, 40).join("\n"));
  }
  results.push({ name, ok: opts.okWhen ? opts.okWhen(r) : ok, s: (Date.now() - t) / 1000 });
}

console.log(`check:fast — ${changed.length} changed file(s) vs ${base}`);
const denoFiles = changed.filter((f) => /\.ts$/.test(f) && !f.startsWith("src/") && !f.endsWith("/mcp/index.ts") && !f.startsWith("tests/fixtures/"));
// The database-contract and mounted-browser tests import `npm:` packages that
// CI resolves with `--node-modules-dir=none` (tests/db-contract/run.sh); checked
// against the repo's node_modules they fail before type-checking anything.
const isContract = (f) => f.startsWith("tests/db-contract/") || f.startsWith("tests/browser/") || /\.contract\.test\.ts$/.test(f);
const appDeno = denoFiles.filter((f) => !isContract(f));
const contractDeno = denoFiles.filter(isContract);
if (appDeno.length) step(`deno check (${appDeno.length})`, "deno", ["check", ...appDeno]);
if (contractDeno.length) step(`deno check, contract lane (${contractDeno.length})`, "deno", ["check", "--node-modules-dir=none", ...contractDeno]);
const srcChanged = changed.filter((f) => /^src\/.*\.(ts|tsx)$/.test(f));
if (srcChanged.length) {
  // Whole-project tsc (the frontend has one program); report only errors in the files you changed.
  step(`tsc (frontend; errors in ${srcChanged.length} changed file(s))`, "npx", ["tsc", "--noEmit", "-p", "tsconfig.app.json"], {
    quiet: true, filter: (l) => srcChanged.some((f) => l.startsWith(f)),
    okWhen: (r) => !`${r.stdout}${r.stderr}`.split("\n").some((l) => srcChanged.some((f) => l.startsWith(f))),
  });
}
const lintFiles = changed.filter((f) => /\.(ts|tsx|mjs|js)$/.test(f) && !f.endsWith("/mcp/index.ts"));
if (lintFiles.length) step(`eslint (${lintFiles.length})`, "npx", ["eslint", "--no-warn-ignored", ...lintFiles]);
step("near tests (explicitly reach your change)", "node", ["scripts/dev/affected-tests.mjs", base, "--near", "--run"]);

console.log("\n── check:fast summary ──");
for (const r of results) console.log(`  ${r.ok ? "✓" : "✗"} ${r.name.padEnd(46)} ${r.s.toFixed(1)} s`);
const failed = results.some((r) => !r.ok);
console.log(failed ? "\ncheck:fast FAILED" : "\ncheck:fast passed — next: npm run test:pre-pr before opening a PR");
process.exit(failed ? 1 : 0);
