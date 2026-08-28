// A CHECKPOINT IS A COMPLETE RECORD, OR IT IS A STUCK ROW.
//
// ── THE RUN THIS REPRODUCES ────────────────────────────────────────────────
//
// Task 5c461aa3, 2026-08-28 16:36. The first run to complete real provider
// work: `harvestapi/linkedin-company-search` returned 30 companies,
// `harvestapi/linkedin-company` enriched 4, and the engine checkpointed at the
// stage boundary — 30 discovered, 10 shortlisted, 2 credits charged.
//
// The hiring search then started (`nyjSdju8xF7IEcgoc`), ran 116 seconds, and
// SUCCEEDED with 74 job items. The edge function's wall clock expired at ~186s
// and the platform killed the isolate mid-poll.
//
// The checkpoint had written `result` and nothing else. `tasks.status` stayed
// `running` forever, so the execution card spun; the terminal guard that exists
// to prevent exactly this could not help, because its `finally` does not run
// when an isolate is hard-killed. And because the row never became resumable,
// the ledger-based pending-run recovery — which already exists and would have
// adopted that finished dataset — was never reached.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { projectStatus } from "../../../supabase/functions/_shared/taskStatusContract.ts";
import { recoverPendingRuns } from "../../../supabase/functions/_shared/pendingRunRecovery.ts";

const SRC = await Deno.readTextFile(
  new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));

Deno.test("1. a checkpoint writes the row status, not only the result", () => {
  const i = SRC.indexOf('terminal_status: "continuation_required"');
  assert(i > 0, "the checkpoint write must exist");
  // The update object runs from here to the `.eq("id", task.id)` that closes it.
  const write = SRC.slice(i, SRC.indexOf('.eq("id", task.id)', i));
  assert(write.includes('status: projectStatus("continuation_required").rowStatus'),
    "status must be written with the result, from the shared mapping");
});

Deno.test("2. that status is the resumable one, not a terminal one", () => {
  const p = projectStatus("continuation_required");
  assertEquals(p.rowStatus, "ready", "the row must advertise itself as resumable");
  assertEquals(p.taskStatus, "partial", "and the workflow as unfinished");
});

Deno.test("3. the plan stops saying it is executing", () => {
  const i = SRC.indexOf('terminal_status: "continuation_required"');
  const after = SRC.slice(i, i + 9000);
  assert(after.includes('.update({ status: "partial" })'),
    "a checkpointed plan must not stay `executing` beside a resumable task");
  assert(after.includes('.eq("status", "executing")'),
    "and it must not overwrite a plan that already reached a verdict");
});

Deno.test("4. the checkpoint says so in the conversation", () => {
  // LIVE: the last thing the user saw was "I created a 1-step plan", then five
  // minutes of nothing while 30 companies sat saved behind a spinner.
  const i = SRC.indexOf('kind: "run_checkpoint"');
  assert(i > 0, "a checkpoint must announce itself");
  const notice = SRC.slice(Math.max(0, i - 2200), i);
  assert(notice.includes("hit its time limit"),
    "it must say the run paused, not that it failed");
  assert(notice.includes("Nothing is lost and nothing extra was charged"),
    "and be explicit about cost, because the user has already been charged twice");
  assert(SRC.slice(i - 3000, i).includes('filter("metadata->>kind", "eq", "run_checkpoint")'),
    "one notice per plan, not one per checkpoint");
});

Deno.test("5. a killed run's provider run is still recoverable from the ledger", () => {
  // The recovery already existed; the stuck row is what kept it unreachable.
  // These are the exact ledger fields the killed call left behind.
  //
  // `capability` here is the ACTOR key, which is what `pending_runs.provider`
  // holds — and `request_input.input` is what the fingerprint is built from, so
  // an adopted run can only satisfy a call asking the same thing. Both are
  // present on the production row; this is that row.
  const recovered = recoverPendingRuns([{
    capability: "apify_linkedin_job_search",
    provider_id: "apify",
    provider_run_id: "nyjSdju8xF7IEcgoc",
    dataset_id: "AoKBKfAtWGepM18rR",
    status: "started",
    started_at: "2026-08-28T16:37:40.700Z",
    request_input: { input: { company: ["acme"], sortBy: "date" } },
    // deno-lint-ignore no-explicit-any
  } as any]);
  assertEquals(recovered.length, 1,
    "a started run with an id, a dataset and a recorded input must be adoptable");
  assertEquals(recovered[0].run_id, "nyjSdju8xF7IEcgoc");
  assertEquals(recovered[0].dataset_id, "AoKBKfAtWGepM18rR");
  assert(recovered[0].input_fingerprint,
    "and it must carry a fingerprint, so it cannot satisfy a different call");

  // A run with no recorded input stays unadopted — the fingerprint is what
  // stops a batch of one inheriting a batch of ten's dataset.
  assertEquals(recoverPendingRuns([{
    capability: "apify_linkedin_job_search", provider_id: "apify",
    provider_run_id: "x", dataset_id: "y", status: "started",
    // deno-lint-ignore no-explicit-any
  } as any]).length, 0);
});
