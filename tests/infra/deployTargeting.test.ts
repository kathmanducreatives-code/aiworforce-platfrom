// PHASE 0B — PRODUCTION MUST NOT BE REACHABLE BY ACCIDENT.
//
// Until this phase, `supabase/config.toml` named the production project. Every
// CLI command that resolves its project from config — `db push`, `link`,
// `db pull`, `migration list` — aimed at production from an ordinary working
// tree, and the only thing preventing a production write was that the CLI
// account happened to lack access. That is luck, not a safeguard.
//
// These tests pin the replacement: a safe checked-in default, and a wrapper that
// fails CLOSED rather than defaulting upward.

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveTarget, configuredRef, environmentOf, refusalFor,
} from "../../scripts/supabase-target.mjs";

const TEST_REF = "zbwsbnqqpkvdhqwavjke";
const PROD_REF = "wqnigjhcwjxtmordrwno";
const CONFIG = new URL("../../supabase/config.toml", import.meta.url).pathname;

// ═══ THE CHECKED-IN DEFAULT ═══════════════════════════════════════════════

Deno.test("config.toml names TEST, not production", () => {
  const ref = configuredRef(CONFIG);
  assertEquals(ref, TEST_REF, "the checked-in default project must be TEST");
  assertEquals(environmentOf(ref), "test");
  assert(ref !== PROD_REF, "production must never be the repo default again");
});

Deno.test("the canonical refs are not confused with each other", () => {
  assertEquals(environmentOf(TEST_REF), "test");
  assertEquals(environmentOf(PROD_REF), "production");
  assertEquals(environmentOf("something-else"), "unknown",
    "an unrecognised ref must be 'unknown' so callers can fail closed on it");
});

// ═══ FAIL-CLOSED TARGET RESOLUTION ════════════════════════════════════════

Deno.test("test is the default, including for an unset environment", () => {
  for (const env of [{}, { SUPABASE_TARGET: "" }, { SUPABASE_TARGET: "  " }]) {
    const r = resolveTarget({ requested: "test", env });
    assert(r.ok);
    assertEquals(r.ref, TEST_REF);
  }
});

Deno.test("production is REFUSED without the explicit override", () => {
  for (const env of [{}, { SUPABASE_TARGET: "test" }, { SUPABASE_TARGET: "prod" }, { SUPABASE_TARGET: "PRODUCTIO" }]) {
    const r = resolveTarget({ requested: "production", env });
    assertEquals(r.ok, false, `production must not resolve with env ${JSON.stringify(env)}`);
    assertStringIncludes(r.reason ?? "", "SUPABASE_TARGET=production");
  }
});

Deno.test("production requires BOTH the explicit script and the explicit env", () => {
  const r = resolveTarget({ requested: "production", env: { SUPABASE_TARGET: "production" } });
  assert(r.ok, "the deliberate combination must be allowed — this is not a lockout");
  assertEquals(r.ref, PROD_REF);
  assertEquals(r.target, "production");
});

Deno.test("a declared production target does NOT leak into the test command", () => {
  // A stale shell with SUPABASE_TARGET=production must not quietly make
  // `npm run supabase:test` do something else. Refusing is safer than ignoring.
  const r = resolveTarget({ requested: "test", env: { SUPABASE_TARGET: "production" } });
  assertEquals(r.ok, false);
  assertStringIncludes(r.reason ?? "", "Refusing rather than silently ignoring");
});

Deno.test("an unrecognised request never escalates to production", () => {
  // The one behaviour this must never have: failing UP on a typo.
  for (const requested of ["", "prd", "prod", "TEST ", undefined as unknown as string]) {
    const r = resolveTarget({ requested, env: {} });
    assert(r.ok);
    assertEquals(r.ref, TEST_REF, `"${requested}" must resolve to TEST, never production`);
  }
});

// ═══ COMMANDS THAT ARE REFUSED OUTRIGHT ═══════════════════════════════════

Deno.test("db push is refused, with the reason", () => {
  const r = refusalFor(["db", "push"]);
  assert(r, "db push must be refused — local and remote migration versions do not correspond");
  assertStringIncludes(r?.why ?? "", "96");
});

Deno.test("destructive and history-rewriting commands are refused", () => {
  for (const cmd of [["db", "reset"], ["db", "pull"]]) {
    assert(refusalFor(cmd), `${cmd.join(" ")} must be refused`);
  }
});

Deno.test("ordinary read commands are not refused", () => {
  for (const cmd of [["functions", "list"], ["secrets", "list"], ["migration", "list"], ["projects", "list"]]) {
    assertEquals(refusalFor(cmd), null, `${cmd.join(" ")} must remain available`);
  }
});

// ═══ THE EXISTING GUARD STILL FAILS CLOSED ════════════════════════════════

async function verifyDeployTarget(expect: string, ref: string) {
  const cmd = new Deno.Command("node", {
    args: ["scripts/verify-deploy-target.mjs", "--expect", expect],
    env: { ...Deno.env.toObject(), DEPLOY_SUPABASE_PROJECT_REF: ref },
    stdout: "piped", stderr: "piped",
  });
  const { code } = await cmd.output();
  return code;
}

Deno.test("verify-deploy-target refuses a PROD ref when TEST was expected", async () => {
  assertEquals(await verifyDeployTarget("test", PROD_REF), 1,
    "treating production as test must be a non-zero exit, not a warning");
});

Deno.test("verify-deploy-target refuses a TEST ref when PROD was expected", async () => {
  assertEquals(await verifyDeployTarget("production", TEST_REF), 1);
});

Deno.test("verify-deploy-target accepts the matching pair", async () => {
  assertEquals(await verifyDeployTarget("test", TEST_REF), 0);
});

Deno.test("verify-deploy-target refuses an unknown ref", async () => {
  assertEquals(await verifyDeployTarget("test", "notaprojectref"), 1,
    "an unrecognised ref must fail closed rather than be assumed safe");
});
