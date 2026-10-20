// The database-contract workflow's two stages (docs/launch/ci.md, "Two-stage
// testing"). Deferring work on drafts must never quietly become skipping it:
// the contract tests run on every event, and the mutation proofs are skipped
// ONLY on a draft pull request — every Stage 2 trigger runs the complete job.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parse } from "https://deno.land/std@0.224.0/yaml/mod.ts";

interface Step { name?: string; run?: string; if?: string; uses?: string }
const wf = parse(Deno.readTextFileSync(new URL("../../.github/workflows/db-contract.yml", import.meta.url))) as {
  on: { pull_request: { types: string[] }; push: { branches: string[] }; workflow_dispatch: unknown };
  jobs: Record<string, { if?: string; "timeout-minutes": number; steps: Step[] }>;
};
const job = wf.jobs["db-contract"];
const step = (name: string) => job.steps.find((s) => s.name?.startsWith(name));
const DRAFT_ONLY = "github.event_name != 'pull_request' || github.event.pull_request.draft == false";

Deno.test("db-contract: Stage 2 triggers — ready-for-review PRs, protected and integration branches, manual dispatch", () => {
  for (const t of ["opened", "synchronize", "reopened", "ready_for_review"]) {
    assert(wf.on.pull_request.types.includes(t), `pull_request.${t}`);
  }
  for (const b of ["main", "launch/hardening", "integration/**"]) assert(wf.on.push.branches.includes(b), `push to ${b}`);
  assert("workflow_dispatch" in wf.on, "can be run by hand on any branch");
});

Deno.test("db-contract: the contract tests run on every event, drafts included", () => {
  assertEquals(job.if, undefined, "the job itself is never skipped");
  const contract = step("Contract tests")!;
  assertEquals(contract.run, "tests/db-contract/run.sh");
  assertEquals(contract.if, undefined, "no condition on the contract tests");
});

Deno.test("db-contract: the mutation proofs are deferred ONLY on draft pull requests", () => {
  const mutation = step("Mutation proof")!;
  assertEquals(mutation.run, "tests/db-contract/mutation.sh", "still the complete proof script");
  assertEquals(mutation.if, DRAFT_ONLY, "skipped on a draft PR and on nothing else");
  // Every other step is unconditional, except the failure-only diagnostic.
  for (const s of job.steps) {
    if (s === mutation || s.name === "Postgres log on failure") continue;
    assertEquals(s.if, undefined, `${s.name ?? s.uses} must not be conditional`);
  }
  assertEquals(job["timeout-minutes"], 45, "room for the complete run");
});
