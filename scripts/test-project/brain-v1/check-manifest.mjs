#!/usr/bin/env node
// Company Brain V1 — validate the TEST deployment manifest. READ-ONLY.
//
//   node scripts/test-project/brain-v1/check-manifest.mjs [--db-url <url>]
//
// Checks, with no network and no database connection:
//   * the target is the isolated TEST project and never a refused (production / retired) ref;
//   * if --db-url is given, it names the target ref and no refused ref;
//   * every migration exists, in version order, with its `requires` earlier in the list;
//   * no migration to apply contains a hosted functions URL or any refused ref;
//   * every excluded migration exists, and none is also in the apply list;
//   * every function exists as supabase/functions/<name>/index.ts.
// It PRINTS the approval-gated plan; it never runs it.
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
export const PRODUCTION_REF = "ohsdatpvfdjdemstoiuj";

/**
 * @param {any} m the parsed manifest
 * @param {{ root?: string, dbUrl?: string | null, read?: (p: string) => string, exists?: (p: string) => boolean }} [opts]
 * @returns {string[]} problems; empty when valid
 */
export function validateManifest(m, { root = ROOT, dbUrl = null, read = (p) => readFileSync(join(root, p), "utf8"), exists = (p) => existsSync(join(root, p)) } = {}) {
  const problems = [];
  const refused = new Set([PRODUCTION_REF, ...(m.target?.refused_refs ?? [])]);
  const ref = m.target?.ref ?? "";
  if (!/^[a-z0-9]{20}$/.test(ref)) problems.push(`target.ref is not a project ref: ${ref}`);
  if (refused.has(ref)) problems.push(`target.ref ${ref} is a refused (production/retired) project`);
  if (dbUrl != null) {
    if (!dbUrl.includes(ref)) problems.push("the database URL does not name the target ref");
    for (const r of refused) if (dbUrl.includes(r)) problems.push(`the database URL names refused project ${r}`);
  }
  const files = (m.migrations ?? []).map((x) => x.file);
  const versions = files.map((f) => f.split("/").pop().slice(0, 14));
  if (versions.some((v, i) => i > 0 && v < versions[i - 1])) problems.push("migrations are not in version order");
  for (const mig of m.migrations ?? []) {
    if (!exists(mig.file)) { problems.push(`missing migration ${mig.file}`); continue; }
    for (const req of mig.requires ?? []) if (!(req < mig.order)) problems.push(`${mig.file} requires a later step ${req}`);
    const sql = read(mig.file);
    if (/supabase\.co\/functions/i.test(sql)) problems.push(`${mig.file} calls a hosted functions URL`);
    for (const r of refused) if (sql.includes(r)) problems.push(`${mig.file} names refused project ${r}`);
  }
  for (const ex of m.excluded_migrations ?? []) {
    if (!exists(ex.file)) problems.push(`excluded migration not found: ${ex.file}`);
    if (files.includes(ex.file)) problems.push(`${ex.file} is both excluded and applied`);
  }
  for (const f of m.functions ?? []) {
    if (!exists(`supabase/functions/${f.name}/index.ts`)) problems.push(`function ${f.name} does not exist`);
  }
  const fe = m.frontend?.VITE_SUPABASE_URL ?? "";
  if (fe && !fe.includes(ref)) problems.push("frontend URL is not the target project");
  for (const r of refused) if (fe.includes(r)) problems.push(`frontend URL names refused project ${r}`);
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const m = JSON.parse(readFileSync(join(ROOT, "scripts/test-project/brain-v1/manifest.json"), "utf8"));
  const i = process.argv.indexOf("--db-url");
  const problems = validateManifest(m, { dbUrl: i > 0 ? process.argv[i + 1] : null });
  if (problems.length) { for (const p of problems) console.error(`FAIL: ${p}`); process.exit(1); }
  console.log(`OK: manifest targets ${m.target.ref}. NOTHING HAS BEEN RUN.`);
  if (m.target.blocker) console.log(`\nBLOCKER: ${m.target.blocker}`);
  console.log("\nApproval-gated plan (run by a person, in order):");
  console.log(`  0. psql "$TEST_DB_URL" -f ${m.preflight}   # every row ok=true`);
  for (const mig of m.migrations) console.log(`  ${mig.order}. apply ${mig.file}`);
  for (const f of m.functions) console.log(`  -  supabase functions deploy ${f.name} --project-ref ${m.target.ref}${f.coordination ? `   # coordinate with ${f.coordination}` : ""}`);
}
