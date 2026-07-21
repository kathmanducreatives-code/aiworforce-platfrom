#!/usr/bin/env node
// Deploy-target guard: refuse to treat TEST as production (and vice-versa).
//
// The audit found the frontend/CLI pointed at PROD while MCP/CLI tooling was on
// TEST, and a CLI deploy to prod 403'd. This guard makes the intended target
// explicit BEFORE any deploy step so the two can never be confused.
//
//   Usage:
//     node scripts/verify-deploy-target.mjs --expect production
//     node scripts/verify-deploy-target.mjs --expect test
//
//   Resolves the project ref from (in order):
//     DEPLOY_SUPABASE_PROJECT_REF, VITE_SUPABASE_PROJECT_ID,
//     SUPABASE_PROJECT_ID, or a <ref>.supabase.co URL in VITE_SUPABASE_URL.
//
// Exits non-zero on any mismatch. READ-ONLY: it deploys nothing.

const CANONICAL = {
  production: "wqnigjhcwjxtmordrwno",
  test: "zbwsbnqqpkvdhqwavjke",
};

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function refFromUrl(url) {
  if (!url) return null;
  const m = /^https?:\/\/([a-z0-9]+)\.supabase\.(co|in|net)/i.exec(String(url).trim());
  return m ? m[1].toLowerCase() : null;
}

const expected = (arg("--expect") || "").toLowerCase();
if (expected !== "production" && expected !== "test") {
  console.error("verify-deploy-target: pass --expect production|test");
  process.exit(2);
}

const projectRef =
  process.env.DEPLOY_SUPABASE_PROJECT_REF?.trim() ||
  process.env.VITE_SUPABASE_PROJECT_ID?.trim() ||
  process.env.SUPABASE_PROJECT_ID?.trim() ||
  refFromUrl(process.env.VITE_SUPABASE_URL) ||
  null;

const environment =
  projectRef === CANONICAL.production ? "production" :
  projectRef === CANONICAL.test ? "test" : "unknown";

console.log(`[verify-deploy-target] resolved ref=${projectRef ?? "(none)"} environment=${environment} expected=${expected}`);

if (environment === "unknown") {
  console.error(`[verify-deploy-target] FAIL: unknown project ref ${projectRef ?? "(none)"} — not a canonical environment.`);
  process.exit(1);
}
if (environment !== expected) {
  console.error(`[verify-deploy-target] FAIL: refusing to treat ${environment} project as ${expected}.`);
  process.exit(1);
}

console.log(`[verify-deploy-target] OK: target is ${environment}.`);
