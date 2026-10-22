// A WORKER KILLED MID-MISSION — the next worker must finish it, buying nothing twice.
//
// Offline repro (2026-10-22, real worker process, A7 vendor fakes): worker 1 was
// SIGKILLed right after its first paid run started — the job search — and before
// its first checkpoint. Worker 2 re-claimed the queue row three times; each time
// run-agent refused the resume (`continuation_refused: no_checkpoint`, HTTP 409),
// the runner read the bound task as still `running`, and the row went back to
// `resumable` until its claims ran out and the terminal reconcile failed it.
// Nothing was double-bought, but the mission could never run again.
//
// The cause: the queue binds the task BEFORE any paid boundary
// (`bind_lead_mission_execution` — one task per mission, for life), while the
// resume path requires a checkpoint (`decideResume`, `claim_sourcing_continuation`).
// A first slice that dies before it checkpoints leaves a task the queue may only
// resume and run-agent may never resume.
//
// These run the real runner, run-agent handler, SQL admission gate and PostgREST,
// with the kill emulated in-process (lib/discoveryScenario.ts `interrupt`).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sql } from "./lib/harness.ts";
import { boundsHeld, runScenario } from "./lib/discoveryScenario.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };
const reconciliation = Deno.readTextFileSync(new URL("../../scripts/test-project/smoke-reconciliation.sql", import.meta.url));
const unreconciled = (queueId: string) => sql.unsafe(reconciliation.replace(":'queue_id'", `'${queueId}'`));

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const posts = (r: { vendorRequests: Array<{ method: string; path: string }> }, actor: string) =>
  r.vendorRequests.filter((v) => v.method === "POST" && v.path.includes(actor)).length;
async function lineageOf(taskId: string) {
  const [l] = await sql`select status, generation from public.lead_lineages where lineage_id = ${taskId}`;
  return l as Json | undefined;
}

Deno.test("kill after the first paid start, before the first checkpoint: the next worker resumes it and ends it, buying nothing twice", opts, async () => {
  const r = await runScenario({ label: "kill-before-checkpoint", interrupt: "jobs_status" });
  assertEquals(r.trace.killed_at, "jobs_status");
  assertEquals(r.trace.resumed_from.checkpointed, false, "killed before the first checkpoint");
  // It ran again and ended, instead of going back to `resumable` (refused_409 / running).
  assert(r.trace.runner?.terminal === true, `the resumed run ended: ${JSON.stringify(r.trace.runner)}`);
  assertEquals(r.trace.handler?.status, 200, `run-agent accepted the resume: ${JSON.stringify(r.trace.handler?.body)}`);
  assertEquals((await lineageOf(r.trace.resumed_from.task_id))?.generation, 2, "a second generation ran on the same lineage");
  // The run id was recorded before the kill. The re-entered slice adopts that
  // run by id from the ledger and reads its dataset: the start is never sent
  // again, so the gate is not even asked; the run id and its committed maximum stay.
  assertEquals(posts(r, "linkedin-job-search"), 1, "the job search is bought once");
  const jobs = r.of("provider").filter((o) => o.actor.includes("linkedin-job-search"));
  assertEquals(jobs.map((o) => o.provider_run_id), ["run-jobs"]);
  assert(r.outcome.attempts.some((a: string) => a.startsWith("adopted run run-jobs") && a.includes("without a second charge")),
    `the dead slice's run was adopted: ${JSON.stringify(r.outcome.attempts)}`);
  assert(!r.refused.includes("adopt") && !r.refused.includes("uncertain"), `no replayed start reached the gate: ${JSON.stringify(r.refused)}`);
  assert(!Object.values(r.outcome.credits).includes("refunded"), `nothing refunded: ${JSON.stringify(r.outcome.credits)}`);
  assertEquals(r.outcome.credits.apify_linkedin_job_search, "charged", "its credit is charged once, by the adoption's settlement");
  // Every provider purchase stays listed for the operator to reconcile against the vendor.
  const open = (await unreconciled(r.m.queueId)) as Json[];
  assertEquals(open.filter((o) => o.actor === "apify:harvestapi~linkedin-job-search").length, 1, "one job-search liability, not two");
  // THE DEAD SLICE'S PURCHASE IS USED, NOT ONLY NOT RE-BOUGHT. The re-entered
  // slice adopts the recorded run by id and reads its dataset, so the mission
  // qualifies from the search it already paid for (before: `budget_exhausted`,
  // nothing qualified, the dataset stranded).
  assertEquals(r.outcome.terminal, r.outcome.terminal.length ? [r.outcome.terminal[0]] : [], "one terminal verdict");
  assert(!["budget_exhausted"].includes(r.outcome.terminal[0]), `not stranded: ${JSON.stringify(r.outcome)}`);
  assertEquals(r.outcome.qualified.length, 1, `qualified from the adopted search: ${JSON.stringify(r.outcome)}`);
  boundsHeld(r);
});

Deno.test("kill during the first paid start (no answer, no run id): the next worker resumes, never re-buys, and the liability stays open", opts, async () => {
  const r = await runScenario({ label: "kill-in-first-start", interrupt: "jobs_post" });
  assertEquals(r.trace.resumed_from.checkpointed, false);
  assert(r.trace.runner?.terminal === true, `the resumed run ended: ${JSON.stringify(r.trace.runner)}`);
  assertEquals(r.trace.handler?.status, 200, `run-agent accepted the resume: ${JSON.stringify(r.trace.handler?.body)}`);
  // Whether the vendor started a run is unknown: it is never started again,
  // never refunded, and still listed for a person to reconcile.
  assertEquals(posts(r, "linkedin-job-search"), 1, "the uncertain start is never sent again");
  const jobs = r.of("provider").filter((o) => o.actor.includes("linkedin-job-search"));
  assertEquals(jobs.length, 1);
  assertEquals(jobs[0].provider_run_id, null);
  assert(Number(jobs[0].committed_microusd) > 0, "its committed maximum is kept");
  assert(!Object.values(r.outcome.credits).includes("refunded"), `nothing refunded: ${JSON.stringify(r.outcome.credits)}`);
  const open = (await unreconciled(r.m.queueId)) as Json[];
  assertEquals(open.map((o) => [o.actor, o.state]), [["apify:harvestapi~linkedin-job-search", "open"]], "the purchase is listed as open liability");
  assertEquals(r.outcome.qualified, [], "nothing qualifies without the search results");
  boundsHeld(r);
});

Deno.test("positive control — kill after the first checkpoint: the next worker resumes from it and finishes", opts, async () => {
  const r = await runScenario({ label: "kill-after-checkpoint", interrupt: "details_post" });
  assertEquals(r.trace.killed_at, "details_post");
  assertEquals(r.trace.resumed_from.checkpointed, true, "killed after the first checkpoint");
  assert(r.trace.runner?.terminal === true, `the resumed run ended: ${JSON.stringify(r.trace.runner)}`);
  assertEquals(posts(r, "linkedin-job-search"), 1, "the job search is not bought again");
  assertEquals(posts(r, "linkedin-company"), 1, "the uncertain details start is not sent again");
  boundsHeld(r);
});
