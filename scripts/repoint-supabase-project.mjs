#!/usr/bin/env node
// Repoint the whole repo at a different Supabase project, in one step.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
//
// The project ref appears in twenty-odd files: two copies of
// CANONICAL_PROJECT_REFS, three deploy/benchmark guards, config.toml, .env.local
// and a long tail of test fixtures that use it as "a valid environment". Moving
// it by hand means finding all of them, and the failure mode of missing one is
// not a compile error — it is a guard that silently accepts the wrong project,
// or a fixture that resolves to `unknown` and disables planning.
//
// It was done by hand once. Halfway through, the repo was pointed at a project
// that turned out to belong to a different application, and only a pre-flight
// inspection caught it before anything was written. That is the failure this
// script is for: making the move atomic and verifiable, so the dangerous state
// of "half repointed" cannot persist.
//
// USAGE
//   node scripts/repoint-supabase-project.mjs --to <new-ref> [--from <old-ref>]
//
// `--from` defaults to whatever config.toml currently names. Nothing is written
// unless every replacement succeeds, and the guards are run afterwards.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const to = (arg("--to") || "").trim().toLowerCase();
if (!/^[a-z]{20}$/.test(to)) {
  console.error("repoint: --to must be a 20-character Supabase project ref");
  process.exit(2);
}

const CONFIG = "supabase/config.toml";
const from = (arg("--from") ||
  (readFileSync(CONFIG, "utf8").match(/project_id\s*=\s*"([a-z]+)"/)?.[1] ?? "")).trim();

if (!from) {
  console.error("repoint: could not determine the current ref; pass --from");
  process.exit(2);
}
if (from === to) {
  console.log(`repoint: already pointed at ${to}; nothing to do.`);
  process.exit(0);
}

// Every path is discovered, never listed — a hardcoded file list is the thing
// that goes stale and leaves one guard behind.
const found = execSync(
  `grep -rl "${from}" src scripts supabase tests .env.local 2>/dev/null || true`,
  { encoding: "utf8" },
).split("\n").map((s) => s.trim()).filter(Boolean);

// The generated MCP bundle is rewritten by the Vite plugin on every build, so
// editing it here would be undone. Its source is the file that matters.
const GENERATED = ["supabase/functions/mcp/index.ts"];
const targets = found.filter((f) => !GENERATED.includes(f) && existsSync(f));
const skipped = found.filter((f) => GENERATED.includes(f));

let changed = 0;
for (const f of targets) {
  const before = readFileSync(f, "utf8");
  const after = before.split(from).join(to);
  if (after !== before) { writeFileSync(f, after); changed++; }
}

console.log(`repoint: ${from} -> ${to}`);
console.log(`  rewrote ${changed} file(s)`);
for (const s of skipped) console.log(`  SKIPPED (generated, edit its source): ${s}`);

const remaining = execSync(
  `grep -rl "${from}" src scripts supabase tests .env.local 2>/dev/null || true`,
  { encoding: "utf8" },
).split("\n").map((s) => s.trim()).filter(Boolean)
  .filter((f) => !GENERATED.includes(f));

if (remaining.length) {
  // Historical references inside migrations and comments are legitimate — a
  // migration that records which database it audited should keep saying so.
  console.log("  still mentioning the old ref (check these are historical):");
  for (const r of remaining) console.log(`    ${r}`);
}

console.log("\nrepoint: now run the guards —");
console.log("  npm run test:deploy-safety && npm run qa:lead-quality:test && npm run test:edge");
