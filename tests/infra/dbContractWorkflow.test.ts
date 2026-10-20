// The database contract and mutation proofs inside the tiered CI workflow
// (docs/launch/ci.md, "Test levels"). Deferring work must never quietly become
// skipping it: the contract and the proofs are PLANNED, every planned job must
// succeed, and one always-running gate judges every job — a skipped, cancelled
// or missing required job fails it.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parse } from "https://deno.land/std@0.224.0/yaml/mod.ts";

interface Step { name?: string; run?: string; if?: string; uses?: string; env?: Record<string, string> }
interface Job {
  name?: string; if?: string; needs?: string | string[]; "timeout-minutes": number; steps: Step[];
  strategy?: { "fail-fast"?: boolean; matrix: { shard: number[] } };
}
const TEXT = Deno.readTextFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url));
const wf = parse(TEXT) as {
  on: { pull_request: { types: string[] }; push: { branches: string[] }; workflow_dispatch: { inputs: { level: { options: string[] } } } };
  concurrency: { "cancel-in-progress": string };
  env: Record<string, string>;
  jobs: Record<string, Job>;
};
const step = (job: string, name: string) => wf.jobs[job].steps.find((s) => s.name?.startsWith(name));

Deno.test("levels: ready-for-review PRs, release branches and a manual full run all trigger CI", () => {
  for (const t of ["opened", "synchronize", "reopened", "ready_for_review"]) {
    assert(wf.on.pull_request.types.includes(t), `pull_request.${t}`);
  }
  for (const b of ["main", "launch/hardening", "integration/**"]) assert(wf.on.push.branches.includes(b), `push to ${b}`);
  assertEquals(wf.on.workflow_dispatch.inputs.level.options, ["full", "integration"], "full verification by hand");
  let separate = false;
  try { Deno.statSync(new URL("../../.github/workflows/db-contract.yml", import.meta.url)); separate = true; } catch { /* folded in */ }
  assert(!separate, "one workflow, one gate: the database jobs live in ci.yml");
});

Deno.test("concurrency: only pull-request runs are superseded; release and manual runs always finish", () => {
  assertEquals(wf.concurrency["cancel-in-progress"], "${{ github.event_name == 'pull_request' }}");
});

Deno.test("contract: planned, sharded, each shard its own Postgres, running the real runner", () => {
  const job = wf.jobs.contract;
  assertEquals(job.needs, "plan");
  assertEquals(job.if, "needs.plan.outputs.contract == 'true'");
  assertEquals(job.strategy!["fail-fast"], false, "one failing shard does not hide another");
  assertEquals(job.strategy!.matrix.shard, [1, 2, 3]);
  assert(step("contract", "Start a disposable Postgres")!.run!.includes("docker run"), "a fresh Postgres per shard");
  const run = step("contract", "Contract tests")!.run!;
  assert(run.includes("tests/db-contract/run.sh $FILES"));
  assert(run.includes(`*) echo "unknown shard $SHARD" >&2; exit 2`), "an unknown shard fails, never runs nothing");
});

Deno.test("mutation: planned, every shard runs the COMPLETE proof script, and reports a tally", () => {
  const job = wf.jobs.mutation;
  assertEquals(job.if, "needs.plan.outputs.mutation == 'true'");
  assertEquals(job.strategy!["fail-fast"], false);
  assertEquals(job.strategy!.matrix.shard.length, Number(wf.env.MUTATION_SHARDS));
  assertEquals(job.strategy!.matrix.shard, [...Array(Number(wf.env.MUTATION_SHARDS)).keys()]);
  const proof = step("mutation", "Mutation proof")!;
  assertEquals(proof.run, "tests/db-contract/mutation.sh", "the whole script; the shard only picks every Nth proof");
  assertEquals(proof.if, undefined);
  assert(TEXT.includes('if-no-files-found: error'), "a shard without a tally is an error");
  assertEquals(Number(wf.env.MIN_PROOFS), 64, "the gate's floor on the proof count");
});

Deno.test("gate: always runs, needs every job, and is the only thing that judges them", () => {
  const gate = wf.jobs.gate;
  assertEquals(gate.name, "CI gate");
  assertEquals(gate.if, "always()", "a failed, skipped or cancelled job is judged, not ignored");
  const needs = gate.needs as string[];
  for (const j of Object.keys(wf.jobs)) if (j !== "gate") assert(needs.includes(j), `the gate needs ${j}`);
  const judge = step("gate", "Judge the run")!;
  assertEquals(judge.run, "node scripts/ci/gate.mjs");
  assertEquals(judge.env!.NEEDS, "${{ toJSON(needs) }}");
});

Deno.test("fast suites: never planned away — no condition on backend, replay or frontend", () => {
  for (const j of ["backend", "replay", "frontend"]) {
    assertEquals(wf.jobs[j].if, undefined, `${j} runs at every level`);
    assertEquals(wf.jobs[j].needs, undefined, `${j} starts at once, in parallel`);
    for (const s of wf.jobs[j].steps) assertEquals(s.if, undefined, `${j}: ${s.name ?? s.uses} is unconditional`);
  }
});
