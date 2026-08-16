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
  production: "luvostyizefajbltukkc",
  test: "luvostyizefajbltukkc",
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

// SINGLE-PROJECT DEPLOYMENT. Both role names map to the same ref, so the role
// a caller asks for is now cosmetic and the ref is the whole question. A script
// still passing `--expect test` must not break, and must not be able to reach a
// project other than the canonical one.
const environment =
  projectRef === CANONICAL.production ? "production" :
  projectRef === CANONICAL.test ? "test" : "unknown";
const isCanonical =
  projectRef === CANONICAL.production || projectRef === CANONICAL.test;

console.log(`[verify-deploy-target] resolved ref=${projectRef ?? "(none)"} environment=${environment} expected=${expected}`);

if (environment === "unknown") {
  console.error(`[verify-deploy-target] FAIL: unknown project ref ${projectRef ?? "(none)"} — not a canonical environment.`);
  process.exit(1);
}
// The old check refused a ref whose environment did not match `--expect`. That
// guarded against deploying test code to production while both existed. With one
// project it would reject every `--expect test` invocation for no benefit, so
// what is enforced instead is the property that still protects a deploy: the
// target must BE the canonical project. The two retired refs — and anything
// else — fall through to `unknown` above and exit non-zero.
if (!isCanonical) {
  console.error(`[verify-deploy-target] FAIL: ${projectRef} is not the canonical project.`);
  process.exit(1);
}

console.log(
  `[verify-deploy-target] OK: target is the canonical project ${projectRef}` +
  ` (requested as ${expected}; one project serves both roles).`,
);
