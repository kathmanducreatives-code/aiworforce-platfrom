// The automated TEST deploy loop and the gated production promote
// (.github/workflows/deploy-test-functions.yml, deploy-production-discovery.yml,
// scripts/deploy/test-functions-smoke.ts). Offline: no network, no deploy.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parse } from "https://deno.land/std@0.224.0/yaml/mod.ts";
import {
  buildShaOf, countChecks, functionsToDeploy, PLAN_ACTION, planChecks, PROD_REF, registryCheck, renderSummary,
  secretChecks, SMOKE_QUERY, TEST_REF, verdict,
} from "../../scripts/deploy/test-functions-smoke.ts";

const ROOT = new URL("../../", import.meta.url);
const read = (p: string) => Deno.readTextFileSync(new URL(p, ROOT));
// deno-lint-ignore no-explicit-any
type Loose = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Wf = { on: Record<string, Loose>; concurrency: { group: string; "cancel-in-progress": boolean }; env: Record<string, string>; jobs: Record<string, Loose> };
const TEST_WF = read(".github/workflows/deploy-test-functions.yml");
const PROD_WF = read(".github/workflows/deploy-production-discovery.yml");
const SMOKE = read("scripts/deploy/test-functions-smoke.ts");
const test = parse(TEST_WF) as Wf;
const prod = parse(PROD_WF) as Wf;

Deno.test("TEST deploy: only after a successful CI run on launch/hardening, or by hand from it", () => {
  assertEquals(Object.keys(test.on).sort(), ["workflow_dispatch", "workflow_run"]);
  assertEquals(test.on.workflow_run, { workflows: ["CI"], types: ["completed"], branches: ["launch/hardening"] });
  const job = test.jobs.deploy;
  for (const s of ["workflow_run.conclusion == 'success'", "workflow_run.event == 'push'", "head_branch == 'launch/hardening'", "github.ref == 'refs/heads/launch/hardening'"]) {
    assert(job.if.includes(s), s);
  }
  assertEquals(test.concurrency, { group: "deploy-test-functions", "cancel-in-progress": false });
});

Deno.test("TEST deploy: one project, its own Environment, never production", () => {
  assertEquals(test.env.TEST_REF, "tlvnfrxzjhsjgdofwehb");
  assertEquals(TEST_REF, test.env.TEST_REF);
  assertEquals(test.jobs.deploy.environment, "supabase-test");
  // Every CLI project argument is the TEST ref; production appears only to be refused.
  const refs = [...TEST_WF.matchAll(/--project-ref\s+("?\$\w+"?|\S+)/g)].map((m) => m[1]);
  assert(refs.length >= 1 && refs.every((r) => r === '"$TEST_REF"'), refs.join(","));
  assertEquals([...TEST_WF.matchAll(new RegExp(PROD_REF, "g"))].length, 1, "the production ref is named once: in the refusal");
  for (const banned of ["SUPABASE_TARGET", "supabase-target.mjs", "supabase db", "secrets set", "migration up", "strategy_run", "environment: production"]) {
    assertFalse(TEST_WF.includes(banned), banned);
  }
  assert(TEST_WF.includes("is not on launch/hardening"), "ancestry check");
  assert(TEST_WF.includes("superseded"), "stale (non-tip) commits are not deployed");
  assert(TEST_WF.includes("rollback=true"), "moving TEST backwards needs an explicit rollback");
  assert(TEST_WF.includes("agentory/test-smoke"), "provenance status");
  assert(/case "\$fn" in lead-pipeline\|provider-connections\)/.test(TEST_WF), "only the two discovery functions");
});

Deno.test("production promote: manual, gated on TEST, shares the production deploy lock", () => {
  assertEquals(Object.keys(prod.on), ["workflow_dispatch"]);
  assertEquals(prod.jobs.promote.environment, "production");
  const held = parse(read(".github/workflows/deploy-held-back-functions.yml")) as Wf;
  assertEquals(prod.concurrency.group, held.concurrency.group, "never beside another production deploy");
  for (const k of ["sha", "confirm_sha", "migrations_reviewed", "rollback_ready", "flags_reviewed", "budget_verified"]) assert(prod.on.workflow_dispatch.inputs[k]?.required, k);
  for (const s of ['[ "$SHA" = "$CONFIRM" ]', 'select(.context=="agentory/test-smoke")', "no successful CI run", "held migrations are not applied", "PROVIDER_APOLLO_ENABLED", "LEAD_PIPELINE_PHONES_ENABLED", "openssl enc -aes-256-cbc", "SUPABASE_TARGET: production"]) {
    assert(PROD_WF.includes(s), s);
  }
  assertFalse(PROD_WF.includes(TEST_REF), "production promote never names TEST");
  for (const banned of ["db push", "secrets set", "apply_migration", "strategy_plan\"", "strategy_run\"", "workflow_run", "schedule"]) assertFalse(PROD_WF.includes(banned), banned);
  assertFalse(TEST_WF.includes("deploy-production-discovery"), "TEST never triggers production");
});

Deno.test("no new workflow carries the discovery worker's Environment or secrets", () => {
  for (const t of [TEST_WF, PROD_WF]) {
    assertFalse(t.includes("discovery" + "-test"));
    assertFalse(/secrets\.TEST_/.test(t));
  }
});

Deno.test("smoke script: plans only, never runs, prints no secret", () => {
  assertEquals(PLAN_ACTION, "strategy_plan");
  assertFalse(/action:\s*"(strategy_run|run)"/.test(SMOKE), "no paid action is representable");
  assert(SMOKE.includes("refusing a management call outside TEST"), "management calls are pinned to TEST");
  assertFalse(/console\.log\([^)]*(SMOKE_USER_PASSWORD|SUPABASE_ACCESS_TOKEN|password)/.test(SMOKE));
  assert(SMOKE_QUERY.includes("Prefer 20–500 employees"));
});

Deno.test("smoke: build header and change detection", () => {
  const sha = "a".repeat(40), old = "b".repeat(40);
  assertEquals(buildShaOf(`${sha}@2026-11-01T00:00:00Z`), sha);
  assertEquals(buildShaOf("unstamped@unknown"), null);
  assertEquals(buildShaOf(null), null);
  const graphs = { "lead-pipeline": ["supabase/functions/lead-pipeline/index.ts", "supabase/functions/_shared/x.ts"], "provider-connections": ["supabase/functions/provider-connections/index.ts"] };
  const r = functionsToDeploy({ graphs, live: { "lead-pipeline": { exists: true, sha: old }, "provider-connections": { exists: true, sha: old } }, changedSince: () => ["supabase/functions/_shared/x.ts", "docs/a.md"] });
  assertEquals(r.map((x) => [x.fn, x.deploy]), [["lead-pipeline", true], ["provider-connections", false]]);
  const unknown = functionsToDeploy({ graphs, live: { "lead-pipeline": { exists: true, sha: null }, "provider-connections": { exists: false, sha: null } }, changedSince: () => [] });
  assert(unknown.every((x) => x.deploy), "an unstamped or missing function is always deployed");
  const diverged = functionsToDeploy({ graphs, live: { "lead-pipeline": { exists: true, sha: old }, "provider-connections": { exists: true, sha: old } }, changedSince: () => null });
  assert(diverged.every((x) => x.deploy), "a non-ancestor live build is always replaced");
  assert(functionsToDeploy({ graphs, live: { "lead-pipeline": { exists: true, sha: old }, "provider-connections": { exists: true, sha: old } }, changedSince: () => ["supabase/config.toml"] }).every((x) => x.deploy));
});

Deno.test("smoke: state, flags and registry checks", () => {
  const before = { provider_usage_ledger: 0, lead_candidates: 1, scheduled_emails: 3 };
  assert(countChecks(before, { ...before }).every((c) => c.status === "pass"));
  const spent = countChecks(before, { ...before, provider_usage_ledger: 1 });
  assertEquals(spent.find((c) => c.id === "8")!.status, "fail");
  assertEquals(countChecks(before, { ...before, scheduled_emails: 4 }).find((c) => c.id === "9")!.status, "fail");
  assertEquals(countChecks(before, { ...before, lead_candidates: 2 }).find((c) => c.id === "8b")!.status, "fail");

  const ok = ["LEAD_PIPELINE_ENABLED", "LEAD_PIPELINE_WORKSPACES", "PROVIDER_DISCOVERY_ENABLED", "PROVIDER_DISCOVERY_WORKSPACES", "PROVIDER_APIFY_DISCOVERY_ENABLED", "OPENAI_API_KEY"];
  assert(secretChecks(ok, true).every((c) => c.status === "pass"));
  assertEquals(secretChecks([...ok, "PROVIDER_APOLLO_ENABLED"], true).find((c) => c.id === "7")!.status, "fail");
  assertEquals(secretChecks(ok.slice(1), true).find((c) => c.id === "7a")!.status, "fail");
  assertEquals(secretChecks(ok, false).find((c) => c.id === "5a")!.status, "fail");
  assertEquals(secretChecks(ok, null).find((c) => c.id === "5a")!.status, "skip");
  assertEquals(registryCheck().status, "pass", "Apollo / founder / employees / people search stay unavailable at this commit");
});

Deno.test("smoke: plan checks fail loudly on each regression", () => {
  const good = {
    plan: { status: "ready", strategy: "apify_only", selectedBy: "model", planHash: "0123abcd", estimate: { leadoceanRecords: 0, apifyUsd: 0.06105 },
      steps: [{ capability: "apify.linkedin_job_search", provider: "apify", maxItems: 20 }, { capability: "apify.linkedin_company_record", provider: "apify", maxItems: 10 }] },
    interpretation: { hard: [{ key: "geography_hq" }, { key: "signal" }], preferences: [{ key: "employee_range", values: { min: 20, max: 500 } }],
      signals: [{ kind: "hiring", hard: true, windowDays: 30, roleTerms: ["salespeople"], roleFamilies: ["gtm_sales"] }], companyBrain: { status: "absent" } },
  };
  assert(planChecks(200, good).every((c) => c.status === "pass"), JSON.stringify(planChecks(200, good)));
  const failed = (b: unknown, s = 200) => planChecks(s, b as never).filter((c) => c.status === "fail").map((c) => c.id);
  const clone = () => structuredClone(good);
  const hardSize = clone(); hardSize.interpretation.hard.push({ key: "employee_range" });
  assertEquals(failed(hardSize), ["P1"]);
  const narrowed = clone(); narrowed.interpretation.preferences[0].values = { min: 20, max: 200 };
  assertEquals(failed(narrowed), ["P2"]);
  const noSales = clone(); noSales.interpretation.signals[0].roleFamilies = ["engineering"]; noSales.interpretation.signals[0].roleTerms = ["engineers"];
  assertEquals(failed(noSales), ["P3"]);
  const apollo = clone(); apollo.plan.steps.push({ capability: "apollo.people_search", provider: "apollo", maxItems: 5 });
  assertEquals(failed(apollo), ["P4"]);
  const hash = clone(); hash.plan.planHash = "";
  assertEquals(failed(hash), ["P5"]);
  const over = clone(); over.plan.estimate.apifyUsd = 0.3;
  assertEquals(failed(over), ["P6"]);
  assertEquals(failed({ error: "disabled" }, 404), ["P0"]);
  const md = renderSummary({ sha: "a".repeat(40), runUrl: "u", deployed: [], versions: {}, checks: planChecks(200, good), stage: "done" });
  assert(md.includes("✅ READY"));
  assertEquals(verdict([{ id: "x", name: "x", status: "skip", detail: "" }]), "NOT READY", "a skipped check is not readiness");
});
