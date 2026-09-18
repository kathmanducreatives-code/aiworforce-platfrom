// LEAD V2 P4.1 — A CANCELLED MISSION LEAVES NO RECORD SAYING OTHERWISE.
//
// Canary 3dbcec17 was cancelled 2.8 seconds after its slice released, so the
// queue row was `resumable` and unclaimed. Nothing claims a cancelled row, so
// no release ever followed, and the reconciliation the worker runs on its own
// release never ran:
//
//     queue cancelled / task ready / lineage active
//
// These tests drive the real modules — `leadMissionCancellation.ts` over a fake
// row store, and the real worker loop — and assert the invariant holds, twice
// over, and that nothing terminal-and-successful is ever rewritten.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CANCEL_SWEEP_LIMIT, CANCELLED_REASON, reconcileTerminalRows, sweepCancelledMissions,
  type CancelSweepDb, type CancelledQueueRow,
} from "../../../supabase/functions/_shared/leadMissionCancellation.ts";
import { terminalViolations } from "../../../supabase/functions/_shared/leadMissionTerminal.ts";
import { runWorkerLoop, type WorkerDeps } from "../../../supabase/functions/_shared/leadMissionWorkerCore.ts";

const NOW = "2026-09-18T07:30:00.000Z";

interface Row { status: string | null; result?: Record<string, unknown> | null }

/** The rows as the live canary left them: queue cancelled, everything else alive. */
function store(over: { task?: Row; lineage?: Row; plan?: Row; queue?: CancelledQueueRow[] } = {}) {
  const tasks = new Map<string, Row>([["t1", over.task ?? { status: "ready", result: { terminal_status: "continuation_required", output: "keep me" } }]]);
  const lineages = new Map<string, Row>([["t1", over.lineage ?? { status: "active" }]]);
  const plans = new Map<string, Row>([["p1", over.plan ?? { status: "executing" }]]);
  const reads: string[] = [];
  const writes: Array<{ table: string; id: string; patch: Record<string, unknown> }> = [];
  const db: CancelSweepDb = {
    readTask: (id) => { reads.push(`task:${id}`); return Promise.resolve((tasks.get(id) ?? null) as never); },
    readLineage: (id) => { reads.push(`lineage:${id}`); return Promise.resolve((lineages.get(id) ?? null) as never); },
    readPlan: (id) => { reads.push(`plan:${id}`); return Promise.resolve((plans.get(id) ?? null) as never); },
    writeTask: (id, patch) => { writes.push({ table: "tasks", id, patch }); tasks.set(id, { status: patch.status, result: patch.result }); return Promise.resolve(); },
    writeLineage: (id, patch) => { writes.push({ table: "lead_lineages", id, patch }); lineages.set(id, { status: patch.status }); return Promise.resolve(); },
    writePlan: (id, patch) => { writes.push({ table: "task_plans", id, patch }); plans.set(id, { status: patch.status }); return Promise.resolve(); },
    listCancelled: (limit) => {
      reads.push(`listCancelled:${limit}`);
      return Promise.resolve((over.queue ?? [{ id: "q1", task_id: "t1", lineage_id: "t1", request: { plan_id: "p1" } }]).slice(0, limit));
    },
  };
  return { db, tasks, lineages, plans, reads, writes };
}
const rowsOf = (s: ReturnType<typeof store>) => ({
  task: (s.tasks.get("t1") ?? null) as { status: string | null; result: Record<string, unknown> | null } | null,
  lineage: (s.lineages.get("t1") ?? null) as { status: string | null } | null,
  plan: (s.plans.get("p1") ?? null) as { status: string | null } | null,
});

Deno.test("cancel: queue, task, lineage and plan end together, and the lease is released", async () => {
  const s = store();
  assert(terminalViolations("cancelled", rowsOf(s)).length > 0, "the canary's state is inconsistent to begin with");
  const r = await reconcileTerminalRows(s.db, "cancelled", CANCELLED_REASON, { taskId: "t1", lineageId: "t1", planId: "p1" }, NOW);

  assertEquals(r.written, ["task", "lineage", "plan"]);
  assertEquals(r.remaining, [], "nothing still disagrees with a cancelled queue");
  assertEquals(terminalViolations("cancelled", rowsOf(s)), []);

  const task = s.tasks.get("t1")!;
  assertEquals(task.status, "failed");
  const result = task.result as Record<string, unknown>;
  assertEquals(result.terminal_status, CANCELLED_REASON);
  assertEquals(result.task_status, "failed");
  assertEquals((result.auto_continuation as Record<string, unknown>).continuing, false);
  assertEquals((result.v2_terminal as Record<string, unknown>).queue_status, "cancelled");
  assertEquals(result.output, "keep me", "the run's own result is preserved, not replaced");

  assertEquals(s.lineages.get("t1")!.status, "cancelled");
  const lineageWrite = s.writes.find((w) => w.table === "lead_lineages")!.patch;
  assertEquals([lineageWrite.lease_holder, lineageWrite.lease_expires_at], [null, null], "the lineage lease is released");
  assertEquals(lineageWrite.terminal_reason, CANCELLED_REASON);
  assertEquals(s.plans.get("p1")!.status, "failed");
});

Deno.test("cancel is idempotent: a second reconciliation writes nothing", async () => {
  const s = store();
  const first = await reconcileTerminalRows(s.db, "cancelled", CANCELLED_REASON, { taskId: "t1", lineageId: "t1", planId: "p1" }, NOW);
  assertEquals(first.written.length, 3);
  const writesAfterFirst = s.writes.length;
  const second = await reconcileTerminalRows(s.db, "cancelled", CANCELLED_REASON, { taskId: "t1", lineageId: "t1", planId: "p1" }, "2026-09-18T09:00:00.000Z");
  assertEquals([second.violations, second.written, second.remaining], [[], [], []]);
  assertEquals(s.writes.length, writesAfterFirst, "no second write");
});

Deno.test("a cancelled mission cannot be continued: the task is not resumable and asks for no continuation", async () => {
  const s = store();
  await reconcileTerminalRows(s.db, "cancelled", CANCELLED_REASON, { taskId: "t1", lineageId: "t1", planId: "p1" }, NOW);
  const task = s.tasks.get("t1")!;
  const result = task.result as Record<string, unknown>;
  // `deriveWorkflowUiState` reads these: `failed` is terminal, `ready` offers Continue.
  assertEquals(task.status, "failed");
  assert(!["ready", "running", "pending", "partial"].includes(String(task.status)));
  assert(result.terminal_status !== "continuation_required", "nothing re-dispatches it");
  assertEquals((result.auto_continuation as Record<string, unknown>).decision, CANCELLED_REASON);
});

Deno.test("a cancelled mission is never claimed again — the claim SQL says so", () => {
  const sql = Deno.readTextFileSync(new URL(
    "../../../supabase/migrations-held/20260910140000_lead_mission_v2_claim.sql", import.meta.url));
  const claim = sql.slice(sql.indexOf("function public.claim_next_lead_mission"), sql.indexOf("function public.bind_lead_mission_execution"));
  assert(/q\.status\s+in\s+\('queued',\s*'resumable'\)/i.test(claim), "only queued and resumable are claimable");
  // The only other claimable branch is a RUNNING row whose lease has lapsed.
  assert(/q\.status\s*=\s*'running'\s+and\s+q\.lease_expires_at[^)]*<=\s*now\(\)/i.test(claim));
  assert(!/q\.status\s*=\s*'cancelled'/i.test(claim), "no branch claims a cancelled row");
  // Where the claim DOES mention cancelled, it is to refuse: a cancelled lineage.
  assert(/l\.status\s+in\s+\('cancelled',\s*'terminal'\)/i.test(claim));
  // And the cancellation itself only ever ends a LIVE mission.
  const cancel = sql.slice(sql.indexOf("function public.cancel_lead_mission"));
  assert(/status\s+in\s+\('queued',\s*'resumable',\s*'running'\)/i.test(cancel),
    "a complete or failed mission is not cancellable, so cancelling cannot revive one");
});
Deno.test("the sweep reconciles cancelled missions and leaves consistent ones alone", async () => {
  const s = store();
  const first = await sweepCancelledMissions(s.db, NOW);
  assertEquals([first.scanned, first.reconciled], [1, 1]);
  assertEquals(first.details[0].remaining, []);
  const writes = s.writes.length;
  const second = await sweepCancelledMissions(s.db, NOW);
  assertEquals([second.scanned, second.reconciled], [1, 0], "a second sweep finds nothing to do");
  assertEquals(s.writes.length, writes);
});

Deno.test("the sweep never rewrites a mission that ended successfully", async () => {
  // A completed mission: the sweep only ever lists CANCELLED queue rows, so it
  // is not visited at all — and even if it were, its rows already agree.
  const s = store({
    task: { status: "completed", result: { terminal_status: "complete" } },
    lineage: { status: "terminal" }, plan: { status: "complete" },
    queue: [],
  });
  const r = await sweepCancelledMissions(s.db, NOW);
  assertEquals([r.scanned, r.reconciled], [0, 0]);
  assertEquals(s.writes, []);
  assertEquals(s.reads, [`listCancelled:${CANCEL_SWEEP_LIMIT}`], "no task, lineage or plan was even read");

  const consistent = store({
    task: { status: "completed", result: { terminal_status: "complete" } },
    lineage: { status: "terminal" }, plan: { status: "complete" },
  });
  const r2 = await reconcileTerminalRows(consistent.db, "complete", "complete", { taskId: "t1", lineageId: "t1", planId: "p1" }, NOW);
  assertEquals([r2.violations, r2.written], [[], []]);
  assertEquals(consistent.writes, [], "a finished, consistent mission is never mutated");
});

Deno.test("the worker sweeps only when idle, and a sweep failure never stops the loop", async () => {
  const calls: string[] = [];
  // `runWorkerLoop` asks `shouldStop` twice per iteration, so iterations are
  // counted by the claims the loop actually makes.
  const stopAfter = (n: number) => () => calls.filter((c) => c === "claim").length >= n;
  const base = (over: Partial<WorkerDeps>): WorkerDeps => ({
    workerId: "w1",
    config: { leaseSeconds: 180, heartbeatIntervalMs: 1000, missionCeilingMs: 1000, idlePollMs: 0 },
    claim: () => { calls.push("claim"); return Promise.resolve({ claimed: false, reason: "no_work" }); },
    heartbeatFor: () => ({ start: () => {}, stop: () => {} }),
    runMission: () => Promise.resolve({ status: "ok", terminal: true }),
    release: () => Promise.resolve(),
    sleep: () => Promise.resolve(),
    log: () => {},
    ...over,
  } as WorkerDeps);

  await runWorkerLoop(base({
    sweepCancelled: () => { calls.push("sweep"); return Promise.resolve({ scanned: 1, reconciled: 1 }); },
  }), stopAfter(2));
  // The loop re-checks `shouldStop` after the claim, so the run ends on the
  // second claim: one sweep for the one completed idle tick.
  assertEquals(calls, ["claim", "sweep", "claim"], "one sweep per idle tick");

  // A BUSY tick never sweeps. The first claim returns work, the second does
  // not, so a sweep that ran on the busy tick too would show up twice.
  calls.length = 0;
  let claims = 0;
  await runWorkerLoop(base({
    claim: () => {
      calls.push("claim");
      return Promise.resolve(++claims === 1
        ? { claimed: true, mission: { queueId: "q1", workspaceId: "w", request: {}, taskId: "t1", lineageId: "t1", attempts: 1, isResume: false, heldUntil: null } }
        : { claimed: false, reason: "no_work" } as never) as never;
    },
    runMission: () => { calls.push("run"); return Promise.resolve({ status: "ok", terminal: true }); },
    sweepCancelled: () => { calls.push("sweep"); return Promise.resolve({ scanned: 0, reconciled: 0 }); },
  }), stopAfter(3));
  assertEquals(calls, ["claim", "run", "claim", "sweep", "claim"], "only the idle tick swept");

  // A throwing sweep is logged and the loop keeps polling.
  calls.length = 0;
  await runWorkerLoop(base({
    sweepCancelled: () => { calls.push("sweep"); throw new Error("db down"); },
  }), stopAfter(2));
  assertEquals(calls, ["claim", "sweep", "claim"], "a throwing sweep does not stop the loop");
});

Deno.test("the worker's sweep query asks only for cancelled missions, recently updated and bounded", () => {
  // The fake store above cannot see the real query, and worker/main.ts calls
  // `Deno.serve`-adjacent bootstrap code that a test cannot import — so the
  // query is asserted from the source, the way this repo pins the SQL.
  const src = Deno.readTextFileSync(new URL("../../../worker/main.ts", import.meta.url));
  const sweep = src.slice(src.indexOf("listCancelled:"), src.indexOf("const reconcileTerminal ="));
  assert(/\.eq\("status", "cancelled"\)/.test(sweep), "only cancelled rows are swept — never failed or complete");
  assert(!/"failed"|"complete"/.test(sweep), "a successful or failed mission is never visited by the sweep");
  assert(/\.gte\("updated_at", since\)/.test(sweep) && /24 \* 60 \* 60 \* 1000/.test(sweep), "bounded to the last day");
  assert(/\.limit\(limit\)/.test(sweep), "bounded in count");
});
