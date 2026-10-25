// The real-worker rehearsals (tests/realprocess) run in CI and the gate judges
// them. They are the only suite that runs the worker as a real process; a
// fixture or guard change that stops a real worker (a requester who is not a
// workspace member, 2026-10-25) went unnoticed while they ran only by hand.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parse } from "https://deno.land/std@0.224.0/yaml/mod.ts";
import { gateVerdict } from "../../scripts/ci/planCore.mjs";

type Step = { name?: string; run?: string; uses?: string; if?: string };
type Job = { name?: string; needs?: string | string[]; if?: string; "timeout-minutes"?: number; steps: Step[] };
const TEXT = Deno.readTextFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url));
const wf = parse(TEXT) as { jobs: Record<string, Job> & { plan: { outputs: Record<string, string> } } };

Deno.test("realprocess job: planned, its own Postgres, the real runner, and it must actually run every rehearsal", () => {
  const job = wf.jobs.realprocess;
  assert(job, "ci.yml has a realprocess job");
  assertEquals(job.needs, "plan");
  assertEquals(job.if, "needs.plan.outputs.realprocess == 'true'");
  assert(Number(job["timeout-minutes"]) > 0 && Number(job["timeout-minutes"]) <= 20, "time-bounded");
  const runs = job.steps.map((s) => s.run ?? "").join("\n");
  assert(runs.includes("tests/realprocess/run.sh"), "runs the repo's own runner");
  assert(/-ge 4/.test(runs), "a job that ran fewer than the four rehearsals (two SIGKILLs, an operator stop, the zero-Apify kickoff) fails");
  assert(runs.includes("docker run -d --name realprocess-pg"), "a disposable Postgres of its own");
  assertEquals(wf.jobs.plan.outputs.realprocess, "${{ steps.plan.outputs.realprocess }}");
  assert(Deno.readTextFileSync(new URL("../../scripts/ci/plan.mjs", import.meta.url)).includes("`realprocess=${p.contract}`"),
    "planned whenever the database contract is");
});

const base = (outputs: Record<string, string>, results: Record<string, string>) => ({
  needs: {
    plan: { result: "success", outputs: { level: "1", contract: "false", mutation: "false", contract_all: "false", ...outputs } },
    backend: { result: "success" }, replay: { result: "success" }, frontend: { result: "success" },
    contract: { result: "skipped" }, mutation: { result: "skipped" },
    ...Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { result: v }])),
  },
  tallies: [], shards: 8, minProofs: 64, contractTallies: [], contractShards: 3,
});

Deno.test("gate: a planned real-process run that failed, was skipped or is missing fails the gate", () => {
  for (const r of ["failure", "skipped", "cancelled"]) {
    const v = gateVerdict(base({ realprocess: "true" }, { realprocess: r }));
    assert(!v.ok, r);
    assert(v.problems.some((p: string) => p.startsWith("realprocess: required by the plan")), JSON.stringify(v.problems));
  }
  const missing = gateVerdict(base({ realprocess: "true" }, {}));
  assert(!missing.ok && missing.problems.some((p: string) => p.includes("realprocess")), "missing is not a pass");
});

Deno.test("gate: unplanned real processes may be skipped; a plan from before the job existed is not judged on it", () => {
  assert(gateVerdict(base({ realprocess: "false" }, { realprocess: "skipped" })).ok);
  assert(!gateVerdict(base({ realprocess: "false" }, { realprocess: "failure" })).ok, "a job that ran and failed is never ignored");
  assert(gateVerdict(base({}, {})).ok, "older plans: unchanged verdict");
  assert(gateVerdict(base({ realprocess: "true" }, { realprocess: "success" })).ok);
});
