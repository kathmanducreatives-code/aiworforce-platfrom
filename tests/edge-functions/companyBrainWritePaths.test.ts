// EVERY COMPANY BRAIN EDIT GOES THROUGH ONE AUTHORIZED, VERSIONED WRITE —
// AND OPENING A PAGE NEVER WRITES THE BRAIN.
//
// Before this change five places wrote `company_brain`: onboarding's validated
// save, the Company Brain page (shallow direct write), the Signals radar drawer
// (whole cached profile), the product tour's legacy function (unguarded
// read-modify-write) and integration-readiness, which rewrote the whole Brain
// on every visit to Content or Signals. Any of the last four could silently
// revert a concurrent edit, and none kept the legacy copies agents and lead
// search read in line (docs/audits/company-brain-onboarding, P0-1, P0-3).
//
// These are SOURCE assertions. The edge handlers start `Deno.serve` on import,
// so they are pinned structurally; the update logic itself is exercised for
// real in _shared/companyBrainOneTruth.test.ts.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ROOT = new URL("../../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, ROOT));

/** Writes to company_brain: `.from("company_brain")` followed closely by insert/update/upsert. */
function brainWrites(src: string): string[] {
  const out: string[] = [];
  const re = /\.from\(\s*['"]company_brain['"]\s*(?:as\s+\w+)?\)([\s\S]{0,160})/g;
  for (const m of src.matchAll(re)) {
    const op = m[1].match(/\.(insert|update|upsert|delete)\(/);
    if (op && !/\.from\(/.test(m[1].slice(0, m[1].indexOf(op[0])))) out.push(op[1]);
  }
  return out;
}

function walk(dir: URL, files: string[] = []): string[] {
  for (const e of Deno.readDirSync(dir)) {
    const u = new URL(e.name + (e.isDirectory ? "/" : ""), dir);
    if (e.isDirectory) walk(u, files);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) files.push(u.pathname);
  }
  return files;
}

Deno.test("1. the frontend never writes company_brain directly", () => {
  const offenders = walk(new URL("src/", ROOT))
    .filter((f) => brainWrites(Deno.readTextFileSync(f)).length > 0)
    .map((f) => f.slice(f.indexOf("/src/") + 1));
  assertEquals(offenders, [], "edits go through saveCompanyBrainPatch (generate-company-brain-draft `update`)");
});

Deno.test("2. the Company Brain page and the radar drawer save through the one path", () => {
  for (const f of ["src/pages/CompanyBrainDashboard.tsx", "src/components/signals/EditRadarDrawer.tsx"]) {
    const src = read(f);
    assert(src.includes("saveCompanyBrainPatch("), `${f} uses the shared save`);
    assert(/expectedUpdatedAt:\s*\w/.test(src), `${f} sends the version it loaded`);
  }
  const radar = read("src/components/signals/EditRadarDrawer.tsx");
  assert(radar.includes("patch: { signal_preferences: prefs }"), "the radar sends only its own key, not the whole cached profile");
});

Deno.test("3. opening Content or Signals cannot rewrite the Brain: integration-readiness is read-only", () => {
  const src = read("supabase/functions/integration-readiness/index.ts");
  assertEquals(brainWrites(src), []);
  assertFalse(/from\(\s*["']company_brain["']/.test(src), "it does not even read the Brain any more");
  assertFalse(src.includes("SUPABASE_SERVICE_ROLE_KEY"), "no privileged client left to write with");
});

Deno.test("4. the update action sits behind the existing JWT + membership gate", () => {
  const src = read("supabase/functions/generate-company-brain-draft/index.ts");
  const gate = src.indexOf('if (!member) return json({ error: "forbidden" }, 403);');
  const update = src.indexOf('if (action === "update")');
  assert(src.indexOf("auth.getUser(") < gate && gate > 0, "the caller is authenticated before membership is checked");
  assert(update > gate, "update is only reachable after membership is verified");
  // Wrong workspace: the update branch reads and writes only the verified
  // workspace_id; nothing is read from the patch.
  const branch = src.slice(update, src.indexOf("// ---------------- Step 4/5", update));
  const brainReads = branch.match(/from\("company_brain"\)[\s\S]*?;/g) ?? [];
  assertEquals(brainReads.length, 1, "one read; the write goes through the authorized writer");
  assert(brainReads[0].includes('.eq("workspace_id", workspace_id)'), `unscoped read: ${brainReads[0].slice(0, 80)}`);
  assert(/authorizedBrainWrite\(admin, \{\s*workspaceId: workspace_id, actorId: userId, sessionId/.test(branch), "the write is scoped to the verified workspace and caller");
  assertFalse(/patch\.workspace_id|body\.patch\?\.workspace/.test(branch));
});

Deno.test("5. the update write is atomic on the version it was planned from — and re-authorized in the same transaction", () => {
  const src = read("supabase/functions/generate-company-brain-draft/index.ts");
  const branch = src.slice(src.indexOf('if (action === "update")'), src.indexOf("// ---------------- Step 4/5"));
  assert(branch.includes("planBrainUpdate("), "planned by the pure update logic");
  assert(/mode: "cas", profile: plan\.profile, expectedUpdatedAt: current!\.updated_at!/.test(branch), "conditional on the version read");
  assert(/written\.outcome === "stale"[\s\S]{0,140}409/.test(branch), "a write that lost the race is a 409, not a silent overwrite");
  assert(/written\.outcome !== "ok"\) \{ const r = brainWriteRefusal\(written\.outcome\)/.test(branch), "a revoked caller is refused, not written");
});

Deno.test("6. the product tour's legacy writer is compare-and-swap, re-authorized, and cannot write targeting", () => {
  const src = read("supabase/functions/setup-company-brain/index.ts");
  assertEquals(brainWrites(src), [], "no direct Brain write left");
  assert(/mode: row \? "cas" : "insert", profile: merged,\s*expectedUpdatedAt: row \?/.test(src), "writes land only on the version read");
  assert(/if \(written\.outcome !== "stale"\) throw new BrainWriteRefused\(written\.outcome\)/.test(src), "a revoked caller is refused");
  const allowed = src.slice(src.indexOf("const allowed: (keyof StructuredBrainPatch)[]"), src.indexOf("];", src.indexOf("const allowed: (keyof StructuredBrainPatch)[]")));
  assertFalse(allowed.includes('"icp"'), "legacy icp is a mirror now, not an input");
  assertFalse(allowed.includes('"competitors"'));
});

Deno.test("7. no handler writes company_brain directly; the authorized writer is the only path (AUTH-06)", () => {
  const files = walk(new URL("supabase/functions/", ROOT));
  const direct = files.filter((f) => brainWrites(Deno.readTextFileSync(f)).length > 0)
    .map((f) => f.slice(f.indexOf("supabase/functions/") + "supabase/functions/".length)).sort();
  assertEquals(direct, [], "every Brain write re-checks session, membership and role in its transaction");
  const rpcCallers = files.filter((f) => Deno.readTextFileSync(f).includes('"company_brain_authorized_write"'))
    .map((f) => f.slice(f.indexOf("supabase/functions/") + "supabase/functions/".length)).sort();
  assertEquals(rpcCallers, ["_shared/brainWriter.ts"]);
  const users = files.filter((f) => /authorizedBrainWrite\(/.test(Deno.readTextFileSync(f)) && !f.endsWith("brainWriter.ts"))
    .map((f) => f.slice(f.indexOf("supabase/functions/") + "supabase/functions/".length)).sort();
  assertEquals(users, ["generate-company-brain-draft/index.ts", "setup-company-brain/index.ts"]);
});

Deno.test("8. agents read provider readiness live, not from a copy stored in the Brain", () => {
  for (const f of ["supabase/functions/run-agent/index.ts", "supabase/functions/pilot-chat/index.ts"]) {
    assert(read(f).includes("integrationStatus: buildIntegrationStatus()"), f);
  }
});
