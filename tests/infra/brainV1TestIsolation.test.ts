// Company Brain V1 — TEST isolation. "Test" must never mean production.
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PRODUCTION_REF, validateManifest } from "../../scripts/test-project/brain-v1/check-manifest.mjs";

const ROOT = new URL("../../", import.meta.url);
const read = (p: string) => Deno.readTextFileSync(new URL(p, ROOT));
const manifest = JSON.parse(read("scripts/test-project/brain-v1/manifest.json"));
const opts = {
  root: ROOT.pathname,
  read: (p: string) => read(p),
  exists: (p: string) => { try { Deno.statSync(new URL(p, ROOT)); return true; } catch { return false; } },
};

Deno.test("the Brain V1 TEST manifest is valid and targets the isolated TEST project", () => {
  assertEquals(validateManifest(manifest, opts), []);
  assertEquals(manifest.target.ref, "tlvnfrxzjhsjgdofwehb");
  assert(manifest.target.ref !== PRODUCTION_REF);
});

Deno.test("the validator refuses production, a production DB URL, the prod-URL cron and a missing function", () => {
  const bad = (patch: (m: typeof manifest) => void) => { const m = structuredClone(manifest); patch(m); return validateManifest(m, opts); };
  assert(bad((m) => { m.target.ref = PRODUCTION_REF; }).some((p) => p.includes("refused")));
  assert(validateManifest(manifest, { ...opts, dbUrl: `postgresql://postgres.${PRODUCTION_REF}:x@h/db` }).length > 0);
  assert(bad((m) => { m.migrations.push({ order: 4, file: "supabase/migrations/20260825140000_monitoring_cron.sql", kind: "shipped" }); })
    .some((p) => p.includes("hosted functions URL")), "the cron migration that calls production is caught");
  assert(bad((m) => { m.functions.push({ name: "does-not-exist", why: "" }); }).some((p) => p.includes("does not exist")));
  assert(bad((m) => { m.migrations.reverse(); }).some((p) => p.includes("order")));
});

Deno.test("the held Brain memory migration contains no hosted URL and no project ref", () => {
  const sql = read("supabase/migrations-held/20261110120000_company_brain_memory.sql");
  assertEquals(/supabase\.co/i.test(sql), false);
  assertEquals(sql.includes(PRODUCTION_REF), false);
});

Deno.test("no script names production as its TEST target", () => {
  // `TEST…REF = "<production>"` is how a "test" deploy reached production.
  // The lead-quality benchmark is the one known exception: it checks production
  // FIRST and refuses it, so it fails closed (owned by the lead track).
  const allow = new Set(["scripts/lead-quality-benchmark/types.ts"]);
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of Deno.readDirSync(new URL(dir, ROOT))) {
      const p = `${dir}${e.name}`;
      if (e.isDirectory) { if (!["node_modules", "workdir", "fixtures"].includes(e.name)) walk(`${p}/`); continue; }
      if (!/\.(m?js|ts)$/.test(e.name) || allow.has(p)) continue;
      const src = read(p);
      if (new RegExp(`TEST[A-Z_]*REF\\s*[:=]\\s*["']${PRODUCTION_REF}["']`).test(src) ||
          new RegExp(`\\btest:\\s*["']${PRODUCTION_REF}["']`).test(src)) offenders.push(p);
    }
  };
  walk("scripts/");
  assertEquals(offenders, []);
});

Deno.test("the preflight is read-only and checks for the no-Brain guard", () => {
  const sql = read("scripts/test-project/brain-v1/preflight.sql");
  assertEquals(/\b(insert|update|delete|drop|alter|create|grant|revoke|truncate)\b/i.test(sql.replace(/--.*$/gm, "")), false);
  assertStringIncludes(sql, "discovery_test_no_company_brain");
});
