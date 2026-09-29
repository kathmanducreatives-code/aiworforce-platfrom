// THE ALARM: A SCHEDULED CHECK THAT FAILS WHEN A PERSON SHOULD LOOK.
//
// .github/workflows/ops-health.yml runs scripts/ops/check-health.ts every 15
// minutes (critical only) and daily (warnings too); GitHub emails a failed
// scheduled run. Pinned here: what fails the run, what does not, and that the
// workflow holds only the ops token — never a service key. PURE.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parse } from "https://deno.land/std@0.224.0/yaml/mod.ts";
import { exitCode, opsAlerts, workerAlert, type Alert } from "../../scripts/ops/check-health.ts";

const read = (p: string) => Deno.readTextFileSync(new URL(`../../${p}`, import.meta.url));
const WF = read(".github/workflows/ops-health.yml");
interface Workflow {
  on: { schedule: Array<{ cron: string }>; workflow_dispatch: unknown };
  permissions: Record<string, string>;
  jobs: { check: { env: Record<string, string>; steps: Array<{ name?: string; if?: string; run?: string; uses?: string }> } };
}
const wf = parse(WF) as Workflow;
const warn: Alert = { severity: "warn", code: "model_spend_high", detail: "" };
const crit: Alert = { severity: "critical", code: "queue_unclaimed", detail: "" };

Deno.test("EXIT: the 15-minute run fails on critical only; the daily run fails on warnings too", () => {
  assertEquals(exitCode([], "critical"), 0);
  assertEquals(exitCode([warn], "critical"), 0, "no email every 15 minutes about a slow beta request");
  assertEquals(exitCode([warn], "warn"), 1);
  assertEquals(exitCode([crit], "critical"), 1);
});

Deno.test("AN ALARM THAT CANNOT READ IS AN ALARM: unreachable, refused, disabled or malformed are critical", () => {
  assertEquals(opsAlerts({ reachable: false })[0].code, "ops_unreachable");
  assertEquals(opsAlerts({ reachable: true, status: 401, body: {} })[0].code, "ops_unauthorized");
  assertEquals(opsAlerts({ reachable: true, status: 503, body: {} })[0].code, "ops_disabled");
  assertEquals(opsAlerts({ reachable: true, status: 200, body: {} })[0].code, "ops_bad_response");
  assertEquals(opsAlerts({ reachable: true, status: 200, body: { alerts: [] } }), []);
  for (const a of [opsAlerts({ reachable: false })[0], opsAlerts({ reachable: true, status: 503, body: {} })[0]]) {
    assertEquals(a.severity, "critical");
  }
});

Deno.test("THE WORKER: unreachable or not ok (including 'stalled') is critical; ok is silent", () => {
  assertEquals(workerAlert({ reachable: false })!.code, "worker_unreachable");
  assertEquals(workerAlert({ reachable: true, status: 503, body: { ok: false, status: "stalled" } })!.code, "worker_unhealthy");
  assert(workerAlert({ reachable: true, status: 200, body: { ok: false, status: "stalled" } })!.detail.includes("stalled"));
  assertEquals(workerAlert({ reachable: true, status: 200, body: { ok: true, status: "polling" } }), null);
});

Deno.test("WORKFLOW: every 15 minutes and daily at 08:00 UTC, the daily run fails on warnings", () => {
  assertEquals(wf.on.schedule.map((s) => s.cron), ["*/15 * * * *", "0 8 * * *"]);
  const check = wf.jobs.check.steps.find((s) => s.name === "Check")!;
  assert(check.run!.includes(`if [ "\${{ github.event.schedule }}" = "0 8 * * *" ]; then FAIL_ON=warn; fi`));
  assert(check.run!.includes("scripts/ops/check-health.ts --fail-on \"$FAIL_ON\""));
});

Deno.test("WORKFLOW HOLDS ONLY THE OPS TOKEN: no service key, no database URL, read-only permissions", () => {
  assertEquals(wf.permissions, { contents: "read" });
  const secrets = [...WF.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]).sort();
  assertEquals([...new Set(secrets)], ["OPS_HEALTH_TOKEN", "OPS_HEALTH_URL", "WORKER_HEALTH_URL"]);
  assertFalse(/SERVICE_ROLE|DATABASE_URL|DB_URL|supabase (functions )?deploy/i.test(WF));
});

Deno.test("UNCONFIGURED SKIPS, it does not fail every 15 minutes", () => {
  const steps = wf.jobs.check.steps;
  const skip = steps.find((s) => s.name === "Not configured yet")!;
  assertEquals(skip.if, "env.OPS_HEALTH_URL == '' || env.OPS_HEALTH_TOKEN == ''");
  for (const s of steps.filter((x) => x !== skip)) {
    assertEquals(s.if, "env.OPS_HEALTH_URL != '' && env.OPS_HEALTH_TOKEN != ''", s.name ?? s.uses);
  }
});

Deno.test("THE CHECKER never prints the token", () => {
  const src = read("scripts/ops/check-health.ts");
  const logs = src.split("\n").filter((l) => /console\.(log|error)/.test(l));
  assertFalse(logs.some((l) => /\$\{token\}|x-ops-token/.test(l)), logs.join("\n"));
});
