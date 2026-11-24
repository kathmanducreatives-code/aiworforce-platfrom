// The auto-merge policy as code (scripts/dev/pr-risk.mjs), the loop status report
// (scripts/dev/loop-status.mjs) and the local test selector (scripts/dev/affected-tests.mjs).
// Offline: pure functions on fixtures.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classify } from "../../scripts/dev/pr-risk.mjs";
import { ciSummary, deploySummary, DEPLOY_JOB } from "../../scripts/dev/loop-status.mjs";
import { affected } from "../../scripts/dev/affected-tests.mjs";

const PR = { base: "launch/hardening", state: "open", draft: false, title: "Make B2B a preference", head: "a".repeat(40), branch: "claude/b2b" };
const file = (filename: string, patch: string | null = "@@ -1 +1 @@\n-old\n+new", status = "modified") => ({ filename, status, patch });

Deno.test("routine logic, tests and docs are eligible for auto-merge", () => {
  const r = classify(PR, [
    file("supabase/functions/_shared/missionCriteria.ts"), file("src/lib/leadLibrary/canonicalLeadView.ts"),
    file("tests/edge-functions/_shared/x.test.ts", "+  Deno.env.get('LEAD_PIPELINE_ENABLED') // a test may name flags"),
    file("docs/launch/test-deploy-loop.md", "+ ohsdatpvfdjdemstoiuj is production (docs may name it)"),
  ]);
  assertEquals(r, { verdict: "auto_merge_eligible", blockers: [], reasons: [] });
});

Deno.test("authorised 2026-11-02: workflows, CI, TEST deploy scripts, auth, flags, dependencies and recovery are eligible", () => {
  for (const p of [
    ".github/workflows/ci.yml", ".github/workflows/deploy-test-functions.yml", "scripts/ci/gate.mjs", "scripts/deploy/test-functions-smoke.ts",
    "supabase/config.toml", "supabase/functions/_shared/requestAuth.ts", "supabase/functions/_shared/authHelpers.ts",
    "supabase/functions/_shared/discoveryProviders/flags.ts", "supabase/functions/_shared/discoveryProviders/budget.ts",
    "supabase/functions/_shared/discoveryProviders/adapters/apify.ts", "supabase/functions/lead-pipeline/index.ts",
    "package.json", "package-lock.json", "deno.lock", "supabase/functions/deno.json", "scripts/dev/loop-status.mjs",
  ]) {
    assertEquals(classify(PR, [file(p)]).verdict, "auto_merge_eligible", p);
  }
  // Ordinary changed lines touching flags, env, auth: careful testing, not an owner merge.
  for (const line of ["+  if (env('PROVIDER_APOLLO_ENABLED'))", "+const key = Deno.env.get('OPENAI_API_KEY');", "+  verify_jwt: true", "+    permissions: { contents: read }"]) {
    assertEquals(classify(PR, [file("supabase/functions/_shared/x.ts", `@@ -1 +1 @@\n${line}`)]).verdict, "auto_merge_eligible", line);
  }
  assertEquals(classify({ ...PR, title: "Recovery: fix TEST deploy" }, [file("scripts/deploy/test-functions-smoke.ts")]).verdict, "auto_merge_eligible");
});

Deno.test("still the owner's: production, GitHub permissions, schema, paid-provider enablement, outreach, the policy", () => {
  for (const p of [
    ".github/workflows/deploy-production-discovery.yml", ".github/workflows/deploy-held-back-functions.yml", ".github/CODEOWNERS",
    "scripts/supabase-target.mjs", "scripts/verify-deploy-target.mjs", "scripts/dev/pr-risk.mjs", "tests/infra/prRisk.test.ts",
    "supabase/migrations/20261102_x.sql", "supabase/functions/send-scheduled-emails/index.ts", "src/lib/phoneDialer.ts", "railway.json",
  ]) {
    assertEquals(classify(PR, [file(p)]).verdict, "owner_required", p);
  }
  for (const line of [
    "+  perItemUsd: 0.004,", "-  maxApifyUsd: 0.25,", "+export const APOLLO_ACCESS_VALIDATED = true;", "+const PROD = 'ohsdatpvfdjdemstoiuj';",
    "+    environment: production", "+      contents: write", "+      administration: write",
  ]) {
    assertEquals(classify(PR, [file(".github/workflows/deploy-test-functions.yml", `@@ -1 +1 @@\n${line}`)]).verdict, "owner_required", line);
  }
  // Unchanged context lines are not changes.
  assertEquals(classify(PR, [file("supabase/functions/_shared/leadPipeline/strategy.ts", "@@ -1 +1 @@\n   perItemUsd: 0.004,\n+// a comment")]).verdict, "auto_merge_eligible");
});

Deno.test("what cannot be reviewed, and deleted tests, need the owner", () => {
  assertEquals(classify(PR, [file("supabase/functions/_shared/big.ts", null)]).verdict, "owner_required", "GitHub omitted the diff");
  assertEquals(classify(PR, [file("tests/edge-functions/_shared/x.test.ts", null, "removed")]).verdict, "owner_required", "never weaken tests");
  assertEquals(classify(PR, []).verdict, "owner_required", "nothing listed");
  assertEquals(classify(PR, [{ filename: "src/new.ts", status: "renamed", previous_filename: "scripts/dev/pr-risk.mjs", patch: "" }]).verdict, "owner_required");
});

Deno.test("wrong base, draft, closed, or a head that moved since testing: not eligible at all", () => {
  assertEquals(classify({ ...PR, base: "main" }, [file("src/a.ts")]).verdict, "not_eligible");
  assertEquals(classify({ ...PR, draft: true }, [file("src/a.ts")]).verdict, "not_eligible");
  assertEquals(classify({ ...PR, state: "closed" }, [file("src/a.ts")]).verdict, "not_eligible");
  const moved = classify(PR, [file("src/a.ts")], "b".repeat(40));
  assertEquals(moved.verdict, "not_eligible");
  assert(moved.blockers[0].includes("head moved"));
  assertEquals(classify(PR, [file("src/a.ts")], PR.head).verdict, "auto_merge_eligible");
});

Deno.test("status report: CI gate, failures, and the TEST deploy outcomes", () => {
  const ok = (name: string) => ({ name, status: "completed", conclusion: "success" });
  assertEquals(ciSummary([ok("CI gate"), ok("Plan tests"), { name: "Mutation proofs", status: "completed", conclusion: "skipped" }]).state, "success");
  const red = ciSummary([{ name: "CI gate", status: "completed", conclusion: "failure" }, { name: "Edge functions", status: "completed", conclusion: "failure" }]);
  assertEquals([red.state, red.failed], ["failure", ["CI gate", "Edge functions"]]);
  assertEquals(ciSummary([{ name: "CI gate", status: "in_progress", conclusion: null }]).state, "running");
  assertEquals(DEPLOY_JOB, "Deploy and smoke-test TEST", "matches the job name in deploy-test-functions.yml");
  assertEquals(deploySummary(null, null).deploy, "not started");
  assert(deploySummary({ status: "completed", conclusion: "success", html_url: "u" }, null).deploy.startsWith("superseded"));
  const ready = deploySummary({ status: "completed", conclusion: "success", html_url: "u" }, { state: "success", description: "TEST READY" });
  assertEquals(ready.smoke, "success: TEST READY");
});

Deno.test("deploy job name in the report matches the workflow", () => {
  assert(Deno.readTextFileSync(new URL("../../.github/workflows/deploy-test-functions.yml", import.meta.url)).includes(`name: ${DEPLOY_JOB}`));
});

Deno.test("affected tests: an import chain or a changed test selects it; an unrelated change does not", () => {
  const files: Record<string, string> = {
    "tests/a.test.ts": 'import { x } from "../src/x.ts";',
    "tests/b.test.ts": 'import { y } from "../src/y.ts";',
    "src/x.ts": 'export { z } from "./z.ts"; export const x = 1;',
    "src/z.ts": "export const z = 1;",
    "src/y.ts": "export const y = 1;",
  };
  const read = (f: string) => files[f] ?? null;
  const tests = ["tests/a.test.ts", "tests/b.test.ts"];
  assertEquals(affected(tests, ["src/z.ts"], read), ["tests/a.test.ts"], "transitive import");
  assertEquals(affected(tests, ["src/y.ts"], read), ["tests/b.test.ts"]);
  assertEquals(affected(tests, ["docs/readme.md"], read), []);
  assertEquals(affected(tests, ["tests/b.test.ts"], read), ["tests/b.test.ts"], "a changed test runs");
  // A test that reads a path the scanner cannot name is always selected.
  files["tests/c.test.ts"] = "const p = name(); Deno.readTextFileSync(p);";
  assertEquals(affected(["tests/c.test.ts"], ["docs/readme.md"], read), ["tests/c.test.ts"]);
});
