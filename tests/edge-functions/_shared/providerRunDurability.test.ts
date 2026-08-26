// A BILLED RUN MUST BE REFERENCEABLE THE MOMENT IT EXISTS.
//
// The Apify invoker has always been async: `POST /acts/{actor}/runs` returns a
// run id immediately, the poll waits, and `resume_run_id` adopts an existing
// run via `GET /actor-runs/{id}` with no second charge. The engine records
// pending runs, the finalizer ranks `pending_external_run` above every other
// outcome, and a continuation resumes them.
//
// All of that depended on the call RETURNING — a graceful pending exit. The run
// id lived only in memory between the start POST and that return, and the Edge
// Function wall clock does not return: it kills.
//
// Run 78cff5e5: `harvestapi/linkedin-job-search` started 09:13:05, the function
// was killed mid-call, and the row read `status: "started",
// provider_run_id: null` for a run that was started, billed and running. The
// task sat `running` for 47 minutes with `updated_at` frozen at creation.
//
// Two changes, pinned here: the id is written when it exists, and a killed run
// is swept back to a claimable state.
//
// Pure. Reads source; no network, no provider, no model call.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildStartedRow,
  withExecutionAudit,
  type ExecutionLedgerRow,
} from "../../../supabase/functions/_shared/executionLedger.ts";
import { EDGE_WALL_CLOCK_MS } from "../../../supabase/functions/_shared/leadExecutionFinalizer.ts";

const spec = {
  workspace_id: "w", task_id: "t", plan_id: null,
  execution_owner: "capability_engine_v1", planner_owner: null,
  stage: "hiring_evidence" as const, capability: "hiring_verification",
  reason: "fill_required_evidence", provider_id: "apify",
  actor_id: "harvestapi/linkedin-job-search",
  request_input: { company: ["https://www.linkedin.com/company/x"] },
  logical_call_key: "t:apify_linkedin_job_search:abc",
};

Deno.test("a started row begins with no run id — the window this closes", () => {
  const row = buildStartedRow(spec as never);
  assertEquals(row.status, "started");
  assertEquals(row.provider_run_id, null);
  assertEquals(row.dataset_id, null);
});

Deno.test("the run id reaches the row BEFORE the call resolves", async () => {
  const writes: Array<Partial<ExecutionLedgerRow>> = [];
  let idAtWaitTime: string | null = null;

  await withExecutionAudit(
    {
      insert: async () => {},
      finalize: async (_id, patch) => { writes.push(patch); },
    },
    spec as never,
    async (progress) => {
      // The start POST has returned; the run exists and is billed.
      await progress({ provider_run_id: "RUN123", dataset_id: "DS456" });
      // Anything after this line can be killed by the platform. What matters is
      // that the write above already landed.
      idAtWaitTime = (writes.find((w) => w.provider_run_id)?.provider_run_id ?? null) as string | null;
      return { result: [], outcome: { status: "succeeded" } as never };
    },
  );

  assertEquals(idAtWaitTime, "RUN123",
    "the id must be persisted before the wait, not after it");
  const first = writes[0];
  assertEquals(first.provider_run_id, "RUN123");
  assertEquals(first.dataset_id, "DS456");
});

Deno.test("a progress write that fails does not fail the call", async () => {
  // Losing observability must never cost a run that is otherwise fine.
  const out = await withExecutionAudit(
    {
      insert: async () => {},
      finalize: async () => { throw new Error("db down"); },
    },
    spec as never,
    async (progress) => {
      await progress({ provider_run_id: "RUN123" });
      return { result: ["ok"], outcome: { status: "succeeded" } as never };
    },
  );
  assertEquals(out, ["ok"]);
});

Deno.test("a null writer still runs the call", () => {
  // The "auditing disabled behaves identically" property, which now has to
  // survive the progress argument too.
  return withExecutionAudit(null, spec as never, async (progress) => {
    await progress({ provider_run_id: "X" }); // no-op, must not throw
    return { result: ["ran"], outcome: { status: "succeeded" } as never };
  }).then((r) => assertEquals(r, ["ran"]));
});

// ── the invoker persists at the right moment ──────────────────────────────

Deno.test("the Apify runner writes the id before it starts polling", () => {
  const REG = Deno.readTextFileSync(
    new URL("../../../supabase/functions/_shared/toolRegistry.ts", import.meta.url),
  );
  const persistAt = REG.indexOf("onRunStarted?.({ run_id");
  const pollAt = REG.indexOf("const deadline = Date.now() + 90_000;");
  assert(persistAt > 0, "the runner must report the run id");
  assert(pollAt > 0, "the poll loop is still there");
  assert(
    persistAt < pollAt,
    "the id must be persisted BEFORE the poll — everything after it can be killed",
  );
});

Deno.test("the audit wires the run id straight onto the row", () => {
  const REG = Deno.readTextFileSync(
    new URL("../../../supabase/functions/_shared/toolRegistry.ts", import.meta.url),
  );
  assert(
    /progress\(\{\s*provider_run_id: run_id/.test(REG),
    "the started row must receive the run id, not just a log line",
  );
});

// ── the sweeper ───────────────────────────────────────────────────────────

Deno.test("the sweeper waits far longer than the wall clock", () => {
  const SQL = Deno.readTextFileSync(
    new URL("../../../supabase/migrations/20260826100000_sweep_stuck_runs.sql", import.meta.url),
  );
  const m = /stale_after interval default interval '(\d+) minutes'/.exec(SQL);
  assert(m, "the staleness threshold must be explicit");
  const thresholdMs = Number(m![1]) * 60_000;
  // The wall clock BOUNDS a live invocation: nothing can still be running past
  // it. At least double that is the margin — re-claiming a run that is in fact
  // still executing is how one provider call gets paid for twice.
  assert(
    thresholdMs >= EDGE_WALL_CLOCK_MS * 2,
    `a live invocation must never be swept: ${thresholdMs}ms vs a ${EDGE_WALL_CLOCK_MS}ms wall clock`,
  );
});

Deno.test("the sweeper makes a killed run claimable, not failed", () => {
  const SQL = Deno.readTextFileSync(
    new URL("../../../supabase/migrations/20260826100000_sweep_stuck_runs.sql", import.meta.url),
  );
  assert(/set status = 'ready'/.test(SQL),
    "`ready` is RESUMABLE_ROW_STATUS — `failed` would discard paid, recoverable work");
  assertEquals(/set status = 'failed'/.test(SQL), false);
  assert(/status = 'running'/.test(SQL), "it may only touch runs that claim to be running");
  assert(/ops_stuck_run_archive/.test(SQL),
    "the pre-sweep snapshot is the only record of what the killed invocation wrote");
});
