// A RUN ALWAYS ENDS SOMEWHERE — proved against the REAL run-agent wrapper.
//
// `executionFinalizer.test.ts` proves the DECISION is total. These tests prove
// the decision reaches the ROWS: that `createRunTerminalGuard` — the same
// function `run-agent/index.ts` calls, not a re-implementation — writes a
// terminal `tasks.status` and `task_plans.status` on every exit path.
//
// The distinction matters here more than usual. The `user_input` / `input`
// transport defect survived a green suite precisely because the test asserted
// the sender's shape and never the receiver's. So these tests substitute the
// four database primitives and assert what was WRITTEN.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import { assert, assertEquals, assertFalse, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createRunTerminalGuard, mapTerminalRecordToRows,
  TERMINAL_PLAN_STATUSES, TERMINAL_TASK_STATUSES,
  type TerminalGuardDb,
} from "../../../supabase/functions/_shared/leadRunTerminalGuard.ts";
import {
  createExecutionDeadline, decideTerminalRecord,
} from "../../../supabase/functions/_shared/leadExecutionFinalizer.ts";

/** A database of two rows, recording every write. */
function fakeDb(init: { task?: string; plan?: string; result?: Record<string, unknown> } = {}) {
  const rows = {
    task: init.task ?? "running",
    plan: init.plan ?? "executing",
    result: init.result ?? {} as Record<string, unknown>,
  };
  const writes: Array<{ table: "tasks" | "task_plans"; patch: Record<string, unknown> }> = [];
  const db: TerminalGuardDb = {
    readTaskStatus: () => Promise.resolve(rows.task),
    readPlanStatus: () => Promise.resolve(rows.plan),
    readTaskResult: () => Promise.resolve(rows.result),
    writeTask: (_id, patch) => {
      rows.task = patch.status;
      rows.result = patch.result;
      writes.push({ table: "tasks", patch: patch as unknown as Record<string, unknown> });
      return Promise.resolve();
    },
    writePlan: (_id, patch) => {
      rows.plan = patch.status;
      writes.push({ table: "task_plans", patch: patch as unknown as Record<string, unknown> });
      return Promise.resolve();
    },
  };
  return { db, rows, writes };
}

const IDS = { taskId: "c8a6e53d-c227-4405-9fcc-e0791b03a4ec", planId: "8cead2f4" };

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

// ═════════════════ 1. run-agent always writes a terminal task status ══

Deno.test("1. an unhandled exception still leaves a terminal task and plan", async () => {
  const { db, rows } = fakeDb();
  const guard = createRunTerminalGuard(db);
  guard.bind(IDS);

  await assertRejects(
    () => guard.run(() => { throw new Error("edge function killed"); }),
    Error, "edge function killed",
  );

  assertEquals(rows.task, "failed");
  assertEquals(rows.plan, "failed");
  assert(TERMINAL_TASK_STATUSES.includes(rows.task));
  assertFalse(rows.task === "running", "the exact state task c8a6e53d was left in");
  assertEquals((rows.result as { terminal_status?: string }).terminal_status, "unhandled_exception");
});

Deno.test("1b. a clean run writes complete, on both rows", async () => {
  const { db, rows } = fakeDb();
  const guard = createRunTerminalGuard(db);
  guard.bind(IDS);
  guard.observe({
    completed_capabilities: ["startup_company_discovery", "persistence"],
    pending_capabilities: [],
    qualified_company_keys: ["domain:snapmagic.com"],
  });

  const out = await guard.run(() => Promise.resolve("response"));
  assertEquals(out, "response");
  assertEquals(rows.task, "complete");
  assertEquals(rows.plan, "complete");
});

// ═════════════════════ 2. the plan never stays executing ══

Deno.test("2. no exit path leaves the plan executing", async () => {
  for (const body of [
    () => Promise.resolve("ok"),
    () => Promise.reject(new Error("boom")),
    () => Promise.resolve(undefined),
  ]) {
    const { db, rows } = fakeDb();
    const guard = createRunTerminalGuard(db);
    guard.bind(IDS);
    try { await guard.run(body as () => Promise<unknown>); } catch { /* expected for one */ }
    assertFalse(rows.plan === "executing", "the plan must never stay executing");
    assert(TERMINAL_PLAN_STATUSES.includes(rows.plan), `unexpected plan status ${rows.plan}`);
  }
});

// ═══════════════ 3/4. the deadline blocks work and state is persisted ══

Deno.test("3. hitting the deadline is written as partial and resumable", async () => {
  const c = clock();
  const deadline = createExecutionDeadline({ budgetMs: 10_000, now: c.now, assumedCallMs: 12_000 });
  const { db, rows } = fakeDb();
  const guard = createRunTerminalGuard(db, { deadline });
  guard.bind(IDS);
  guard.observe({
    completed_capabilities: ["startup_company_discovery"],
    pending_capabilities: ["company_identity_resolution", "company_enrichment"],
    provider_attempts: [1, 2, 3],
    accumulated_cost_units: 4,
  });

  await guard.run(() => Promise.resolve(null));

  // `ready` + plan `partial` is the pair `deriveWorkflowUiState` reads as a
  // checkpointed partial run. `complete` would claim leads never delivered;
  // `running` is the hang.
  assertEquals(rows.task, "ready");
  assertEquals(rows.plan, "partial");
  const r = rows.result as Record<string, unknown>;
  assertEquals(r.task_status, "partial");
  assertEquals(r.terminal_status, "execution_deadline_reached");
  assertEquals(r.resumable, true);
});

Deno.test("4. capability state is persisted before the deadline exit", async () => {
  const c = clock();
  const deadline = createExecutionDeadline({ budgetMs: 10_000, now: c.now, assumedCallMs: 12_000 });
  const { db, rows } = fakeDb();
  const guard = createRunTerminalGuard(db, { deadline });
  guard.bind(IDS);
  guard.observe({
    completed_capabilities: ["startup_company_discovery"],
    pending_capabilities: ["company_enrichment"],
    provider_attempts: [1, 2, 3, 4, 5],
    accumulated_cost_units: 7,
    pending_runs: [],
  });

  await guard.run(() => Promise.resolve(null));

  const r = rows.result as Record<string, unknown>;
  assertEquals(r.provider_attempts, 5, "attempts survive the exit");
  assertEquals(r.accumulated_cost_units, 7, "cost is never reported as zero");
  assertEquals(r.last_completed_capability, "startup_company_discovery");
  assertEquals((r.pending_capabilities as string[]).length, 1);
});

Deno.test("4b. an in-flight paid run keeps its run and dataset ids", async () => {
  const { db, rows } = fakeDb();
  const guard = createRunTerminalGuard(db);
  guard.bind(IDS);
  guard.observe({
    pending_runs: [{
      run_id: "rWikfnKgnp5DazDYr", dataset_id: "KmurtcXfCOhGcBmH4",
      provider: "apify_yc_companies_memo23",
    }],
    accumulated_cost_units: 2,
  });

  await guard.run(() => Promise.resolve(null));

  assertEquals(rows.task, "ready");
  assertEquals(rows.plan, "partial");
  const r = rows.result as Record<string, unknown>;
  assertEquals(r.terminal_status, "continuation_required");
  const pending = r.pending_runs as Array<{ run_id: string; dataset_id: string }>;
  assertEquals(pending[0].run_id, "rWikfnKgnp5DazDYr");
  assertEquals(pending[0].dataset_id, "KmurtcXfCOhGcBmH4",
    "abandoning a billed run is what wasted this dataset the first time");
  assertEquals(r.resumable, true);
});

// ══════════════════ 5. a successful completion is never overwritten ══

Deno.test("5. the guard never demotes a status the handler already wrote", async () => {
  for (const already of ["complete", "failed", "skipped", "ready"]) {
    const { db, rows, writes } = fakeDb({ task: already, plan: "complete" });
    const guard = createRunTerminalGuard(db);
    guard.bind(IDS);
    await guard.run(() => Promise.resolve("ok"));
    assertEquals(rows.task, already, `${already} must survive the finalizer`);
    assertEquals(writes.length, 0, "a finished run is not rewritten at all");
  }
});

Deno.test("5b. a write failure cannot mask the run's outcome", async () => {
  const errs: unknown[] = [];
  const db: TerminalGuardDb = {
    readTaskStatus: () => Promise.resolve("running"),
    readPlanStatus: () => Promise.resolve("executing"),
    writeTask: () => { throw new Error("db down"); },
    writePlan: () => Promise.resolve(),
  };
  const guard = createRunTerminalGuard(db, { onWriteError: (e) => errs.push(e) });
  guard.bind(IDS);
  const out = await guard.run(() => Promise.resolve(42));
  assertEquals(out, 42);
  assertEquals(errs.length, 1);
});

Deno.test("5c. the result patch MERGES — the preflight record is not destroyed", async () => {
  const { db, rows } = fakeDb({
    result: { paid_execution_preflight: { ok: true, first_provider: "apify_yc_companies_memo23" } },
  });
  const guard = createRunTerminalGuard(db);
  guard.bind(IDS);
  await guard.run(() => Promise.resolve(null));
  const r = rows.result as Record<string, unknown>;
  assert(r.paid_execution_preflight, "the one record that explains a blocked run must survive");
  assert(r.terminal_record, "and the terminal record is added alongside it");
});

// ═══════════════════════════ row-mapping totality ══

Deno.test("6. every finalizer status maps to a row status the UI understands", () => {
  const cases: Array<[Parameters<typeof decideTerminalRecord>[0], Parameters<typeof decideTerminalRecord>[1]]> = [
    [{ completed_capabilities: ["a"], qualified_company_keys: ["k"] }, { elapsedMs: 1 }],
    [{ completed_capabilities: ["a"], qualified_company_keys: [] }, { elapsedMs: 1 }],
    [{ pending_capabilities: ["x"] }, { elapsedMs: 1 }],
    [{ terminal_reason: "provider_failure" }, { elapsedMs: 1 }],
    [{ terminal_reason: "provider_input_validation_failed" }, { elapsedMs: 1 }],
    [{ pending_runs: [{ run_id: "R", dataset_id: null, provider: "p" }] }, { elapsedMs: 1 }],
    [null, { elapsedMs: 1, deadlineReached: true }],
    [null, { elapsedMs: 1, error: new Error("x") }],
  ];
  for (const [state, ctx] of cases) {
    const rows = mapTerminalRecordToRows(decideTerminalRecord(state, ctx));
    assert(TERMINAL_TASK_STATUSES.includes(rows.task_status), `bad task status ${rows.task_status}`);
    assert(TERMINAL_PLAN_STATUSES.includes(rows.plan_status), `bad plan status ${rows.plan_status}`);
    // A row status outside this vocabulary keeps `deriveWorkflowUiState`
    // spinning, which is the bug wearing a different name.
    assert(["complete", "failed", "ready"].includes(rows.task_status));
  }
});

Deno.test("7. run-agent actually installs the guard around its whole body", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));
  assert(src.includes("createRunTerminalGuard(supabaseTerminalGuardDb("),
    "the guard must be built from the real supabase client");
  assert(src.includes("await terminalGuard.run(async () => {"),
    "the handler body must run INSIDE the guard, not beside it");
  assert(src.includes("terminalGuard.bind({ taskId: task.id"),
    "the guard must be told which rows to finalize");
  assert(src.includes("deadline: terminalGuard.deadline"),
    "the engine must share the guard's clock, not keep a second one");
  // The guard is installed before the first paid boundary.
  assert(src.indexOf("terminalGuard.bind({") < src.indexOf("assertPaidExecutionAllowed(paidPreflight)"),
    "binding must happen before anything can be bought");
});
