#!/usr/bin/env node
// DEPLOY EVERY FUNCTION THAT BUNDLES THE LEAD-INTELLIGENCE SHARED CODE.
//
// THE INCIDENT THIS EXISTS TO PREVENT.
//
// Supabase bundles `_shared` INTO each Edge Function at deploy time. Editing a
// shared module changes nothing at runtime for any function until that function
// is individually redeployed. On 2026-08-07 `leadPaidExecutionPreflight.ts` was
// changed twice and only `run-agent` was redeployed, so `pilot-chat` — which is
// where `compileLeadMission()` actually runs — kept executing an Aug 6 copy.
// The mission reached the executor with `directives: null` and the new
// pre-spend guard blocked it. Correct behaviour, wrong cause, half a day lost.
//
// AND THE THING THAT MADE IT INVISIBLE: `supabase secrets set` increments a
// function's VERSION without deploying its code. pilot-chat read 94 -> 95 -> 96
// while its code sat unchanged from Aug 6. Version numbers looked like deploys.
// `UPDATED_AT` is the honest field; version is not.
//
// SO THE FUNCTION SET IS DERIVED, NOT DECLARED. A hardcoded list is a list that
// goes stale the first time somebody adds an import — which is the same class of
// bug this script exists to stop. We read the imports.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FUNCTIONS_DIR = "supabase/functions";
const TEST_REF = "ohsdatpvfdjdemstoiuj";

/** Shared modules that constitute the lead-intelligence architecture. */
const LEAD_INTELLIGENCE_MODULES = [
  "leadMissionCompiler", "leadMissionCompilerBinding", "leadMission",
  "leadPaidExecutionPreflight", "leadIntelligencePolicy",
  "leadCapabilityGraph", "leadCapabilityEngine", "leadCapabilityCatalogue",
  "leadWorkbenchProjection", "poolEvaluationBinding", "groundedBrainBinding",
  "poolRanking", "groundedBatchEvaluation", "groundedClaims",
  "multiRoundController", "multiRoundBinding", "multiRoundState",
  "roundPlanContract", "crossRoundDedupe", "poolCheckpoint",
  // ── THE UNDERSTANDING LAYER AND THE IDENTITY SIDECAR ────────────────────
  //
  // `leadMissionRuntime` was missing, and `unlock-founders` imports it
  // directly — so a change to how a persisted mission is read would have left
  // that function bundling the old copy, which is the exact failure this
  // script exists to prevent. It was invisible because the seed list names
  // modules while the script derives FUNCTIONS: a module absent from the seed
  // produces no warning, just a smaller set.
  //
  // The Phase A–E modules are seeded together for the same reason. They decide
  // what a request means, which real company a referent resolved to, and
  // whether a checkpoint may resume — contracts that must not differ between
  // the function that writes them and the function that reads them.
  "leadMissionRuntime", "suppliedCompanyIdentity",
  "requestV1", "requestV1Parser", "objectiveRouter", "projectToLeadMission",
  "chatBrain", "chatBrainBinding", "readSurface", "monitorSurface",
  "referentBinding", "referentPersistence", "referentLookup",
];

/** NEVER deployed by this script, whatever it imports. */
const NEVER_DEPLOY = new Set(["mcp", "_shared"]);

const sh = (cmd, args, env) =>
  execFileSync(cmd, args, {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    ...(env ? { env: { ...process.env, ...env } } : {}),
  }).trim();

/**
 * Follow imports from a function's entrypoint through `_shared`.
 *
 * Transitive on purpose: `pilot-chat` imports `leadCapabilityEngine`, which
 * imports the multi-round modules. A direct-imports-only check would have
 * called pilot-chat unaffected by a Stage 4 change and been wrong.
 */
function sharedClosure(entry) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/from\s+["'][^"']*_shared\/([A-Za-z0-9_/.-]+?)\.ts["']/g)) {
      stack.push(join(FUNCTIONS_DIR, "_shared", `${m[1]}.ts`));
    }
  }
  return seen;
}

function leadIntelligenceFunctions() {
  const out = [];
  for (const name of readdirSync(FUNCTIONS_DIR)) {
    if (NEVER_DEPLOY.has(name)) continue;
    const entry = join(FUNCTIONS_DIR, name, "index.ts");
    if (!existsSync(entry)) continue;
    const closure = sharedClosure(entry);
    const touched = LEAD_INTELLIGENCE_MODULES.filter((mod) =>
      closure.has(join(FUNCTIONS_DIR, "_shared", `${mod}.ts`)));
    if (touched.length > 0) out.push({ name, modules: touched });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function deployedState() {
  // `UPDATED_AT` is the last CODE deploy. VERSION is not — `secrets set` bumps
  // it without deploying anything, which is exactly how this went unnoticed.
  const raw = sh("supabase", ["functions", "list", "--project-ref", TEST_REF]);
  const rows = new Map();
  for (const line of raw.split("\n")) {
    const p = line.split("|").map((s) => s.trim());
    if (p.length >= 6 && p[1] && p[1] !== "NAME") {
      rows.set(p[1], { version: p[4], updatedAt: p[5] });
    }
  }
  return rows;
}

const gitSha = () => sh("git", ["rev-parse", "HEAD"]);
const gitShort = () => sh("git", ["rev-parse", "--short", "HEAD"]);
const gitDirty = () => sh("git", ["status", "--porcelain"]).length > 0;

function main() {
  const dryRun = process.argv.includes("--dry-run");

  console.log("── LEAD-INTELLIGENCE DEPLOY ──────────────────────────────");
  console.log(`git sha    : ${gitSha()}`);
  if (gitDirty()) {
    console.log("WARNING    : working tree is dirty; the deployed bundle will");
    console.log("             include uncommitted changes.");
  }

  // THE GUARD RUNS FIRST, ALWAYS. Reuses the existing target verifier rather
  // than reimplementing the production check.
  console.log("\n── target guard ──");
  console.log(sh("node", ["scripts/verify-deploy-target.mjs", "--expect", "test"],
    { DEPLOY_SUPABASE_PROJECT_REF: TEST_REF }));

  const fns = leadIntelligenceFunctions();
  if (fns.length === 0) {
    console.error("REFUSING: no lead-intelligence functions detected — the import");
    console.error("scan found nothing, which means it is broken, not that there is");
    console.error("nothing to deploy.");
    process.exit(1);
  }

  console.log("\n── functions bundling lead-intelligence shared code ──");
  const before = deployedState();
  for (const f of fns) {
    const d = before.get(f.name);
    console.log(`  ${f.name.padEnd(20)} code deployed: ${d?.updatedAt ?? "unknown"}` +
      `  (version ${d?.version ?? "?"})`);
    console.log(`  ${" ".repeat(20)} via: ${f.modules.slice(0, 6).join(", ")}` +
      (f.modules.length > 6 ? ` +${f.modules.length - 6} more` : ""));
  }

  if (dryRun) {
    console.log("\n--dry-run: nothing deployed.");
    return;
  }

  // ── STAMP THE BUNDLE WITH ITS OWN IDENTITY ──────────────────────────────
  // Written BEFORE deploying so every function bundles the same build info.
  // This is what makes "which code ran this task?" answerable from a task row
  // instead of inferred from behaviour.
  const buildInfoPath = join(FUNCTIONS_DIR, "_shared", "buildInfo.ts");
  const stamp = new Date().toISOString();
  writeFileSync(buildInfoPath,
    `// GENERATED AT DEPLOY TIME by scripts/deploy-lead-intelligence.mjs.\n` +
    `// Do not hand-edit. Regenerate by deploying.\n\n` +
    `export const BUILD_INFO = {\n` +
    `  git_sha: ${JSON.stringify(gitSha())},\n` +
    `  build_timestamp: ${JSON.stringify(stamp)},\n` +
    `  dirty: ${gitDirty()},\n` +
    `} as const;\n`);
  console.log(`\n── build stamp ──\n  ${gitShort()} @ ${stamp}${gitDirty() ? " (dirty)" : ""}`);

  console.log("\n── deploying ──");
  for (const f of fns) {
    process.stdout.write(`  ${f.name} ... `);
    try {
      execFileSync("supabase",
        ["functions", "deploy", f.name, "--project-ref", TEST_REF],
        { stdio: ["ignore", "pipe", "pipe"] });
      console.log("ok");
    } catch (e) {
      // FAIL IMMEDIATELY. A partial deploy across functions that share code is
      // the exact state this script exists to prevent.
      console.log("FAILED");
      console.error(String(e.stderr ?? e.message));
      console.error(`\nSTOPPED after ${f.name}. Some functions may now be newer`);
      console.error("than others — re-run this script once the error is fixed.");
      process.exit(1);
    }
  }

  console.log("\n── deployed code timestamps (UPDATED_AT, not version) ──");
  const after = deployedState();
  for (const f of fns) {
    const d = after.get(f.name);
    console.log(`  ${f.name.padEnd(20)} ${d?.updatedAt ?? "unknown"}  (version ${d?.version ?? "?"})`);
  }

  console.log("\n── environment bindings ──");
  try {
    const secrets = sh("supabase", ["secrets", "list", "--project-ref", TEST_REF]);
    for (const key of [
      "GPT_LEAD_MISSION_COMPILER_WORKSPACES", "GROUNDED_COMPANY_BRAIN_WORKSPACES",
      "FULL_POOL_GROUNDED_EVALUATION_WORKSPACES", "MULTI_ROUND_SOURCING_WORKSPACES",
    ]) {
      const line = secrets.split("\n").find((l) => l.includes(key));
      console.log(`  ${key.padEnd(45)} ${line ? line.split("|")[1]?.trim().slice(0, 16) : "NOT SET"}`);
    }
    console.log("  (digests only — values are never printed)");
  } catch {
    console.log("  could not read secrets; verify manually.");
  }

  console.log(`\nDone. All ${fns.length} function(s) now carry ${gitShort()}.`);
}

main();
