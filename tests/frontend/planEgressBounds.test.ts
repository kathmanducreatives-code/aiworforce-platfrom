// EGRESS — A PLAN VIEW NEVER POLLS WITHOUT A BOUND, AND REALTIME NEVER SHIPS A WHOLE TASK ROW.
//
// 2026-09-25: production's Free-plan egress was exhausted. The audit measured
// a lead task's list read (`TASK_LIST_COLUMNS`) at 25 kB on average and up to
// 91 kB, and its full row — which realtime pushes on every UPDATE — at 128 kB
// on average and up to 572 kB, rewritten ~18 times a run. Three fixes:
//
//   1. `decidePlanRefetch` bounds every polling state: a pending approval does
//      not poll at all, a run gone quiet reads once a minute, and a plan that
//      never got a task stops asking after ten minutes.
//   2. `PLAN_HEARTBEAT_MS` is 15s, not 4s.
//   3. `subscribePlan` listens to `tasks` INSERTs only — no full-row UPDATE push.
//
// Pure. No browser, socket or network; the clock is injected.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ACTIVE_QUIET_AFTER_MS, decidePlanRefetch, EMPTY_PLAN_WAIT_MS, QUIET_REFETCH_EVERY_MS,
} from "../../src/lib/chat/planRefetch.ts";
import {
  createPlanStoreRegistry, PLAN_HEARTBEAT_MS, type PlanRead, type PlanStoreIo,
} from "../../src/lib/chat/planStore.ts";

const T0 = Date.parse("2026-09-25T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const plan = (status = "executing", created = T0) =>
  ({ id: "p1", status, created_at: iso(created), completed_at: null }) as never;
const running = (at: number) => ({ id: "t1", status: "running", created_at: iso(at), started_at: iso(at), finished_at: null }) as never;

// ══════════════════════════ 1. the decision is bounded ══════════════════════════

Deno.test("1a. a pending approval never polls; focus still reads once", () => {
  const base = { plan: plan(), tasks: [running(T0)], approvals: [{ status: "pending" }] as never, now: T0 + 60_000 };
  assertEquals(decidePlanRefetch(base), { should: false, reason: "awaiting_approval" });
  assertEquals(decidePlanRefetch({ ...base, now: T0 + 3 * 24 * 3600_000 }), { should: false, reason: "awaiting_approval" },
    "three days later, still no polling");
  assertEquals(decidePlanRefetch({ ...base, regainedFocus: true }), { should: true, reason: "regained_focus" });
});

Deno.test("1b. a running workflow reads every heartbeat while active, once a minute once quiet", () => {
  const now = T0 + 3600_000;
  const recent = { plan: plan(), tasks: [running(T0)], approvals: [], now, lastReadAt: now - 1_000 };
  assertEquals(decidePlanRefetch({ ...recent, lastActivityAt: iso(now - 30_000) }), { should: true, reason: "workflow_active" });
  const quiet = { ...recent, lastActivityAt: iso(now - ACTIVE_QUIET_AFTER_MS - 1) };
  assertEquals(decidePlanRefetch(quiet), { should: false, reason: "workflow_quiet" });
  assertEquals(decidePlanRefetch({ ...quiet, lastReadAt: now - QUIET_REFETCH_EVERY_MS }), { should: true, reason: "workflow_quiet" });
});

Deno.test("1c. an empty plan asks for its first task for ten minutes, and only while it is open", () => {
  const empty = { tasks: [], approvals: [] };
  assertEquals(decidePlanRefetch({ ...empty, plan: plan(), now: T0 + 2_000 }).reason, "plan_without_tasks");
  assertEquals(decidePlanRefetch({ ...empty, plan: plan(), now: T0 + EMPTY_PLAN_WAIT_MS + 1 }), { should: false, reason: "settled" });
  assertEquals(decidePlanRefetch({ ...empty, plan: plan("blocked"), now: T0 + 2_000 }), { should: false, reason: "settled" });
});

// ═══════════════════ 1+2. the store applies it, at the 15s heartbeat ═══════════════════

/** A store whose reads, heartbeat and clock are all driven by the test. */
function harness(read: PlanRead, start: number) {
  let clock = start;
  let reads = 0;
  let every = 0;
  let tick: (() => void) | null = null;
  const io: PlanStoreIo = {
    read: () => { reads++; return Promise.resolve(read); },
    subscribe: () => () => {},
    isHidden: () => false,
    onFocus: () => () => {},
    setInterval: (fn, ms) => { tick = fn; every = ms; return 1; },
    clearInterval: () => {},
    now: () => clock,
  };
  const registry = createPlanStoreRegistry(io);
  return {
    registry, reads: () => reads, every: () => every,
    /** Advance the clock one heartbeat and fire it. */
    beat: async () => { clock += PLAN_HEARTBEAT_MS; tick?.(); await new Promise((r) => setTimeout(r, 0)); },
  };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

Deno.test("2. the store's heartbeat is 15s", async () => {
  const h = harness({ plan: plan(), tasks: [running(T0)], activity: [], approvals: [], toolCalls: [] }, T0);
  h.registry.acquire("p1");
  await settle();
  assertEquals([PLAN_HEARTBEAT_MS, h.every()], [15_000, 15_000]);
});

Deno.test("1d. STORE: a plan waiting on an approval reads once at mount, then never on the heartbeat", async () => {
  const h = harness({ plan: plan(), tasks: [running(T0)], activity: [], approvals: [{ status: "pending" }] as never, toolCalls: [] }, T0 + 60_000);
  h.registry.acquire("p1");
  await settle();
  for (let i = 0; i < 240; i++) await h.beat(); // one hour of heartbeats
  assertEquals(h.reads(), 1, "an hour of waiting on a person costs one read");
});

Deno.test("1e. STORE: a stuck run reads once a minute, not every heartbeat", async () => {
  // The task has been 'running' with no activity for an hour — the stuck case.
  const stuck: PlanRead = { plan: plan("executing", T0), tasks: [running(T0)], activity: [], approvals: [], toolCalls: [] };
  const h = harness(stuck, T0 + 3600_000);
  h.registry.acquire("p1");
  await settle();
  for (let i = 0; i < 240; i++) await h.beat(); // one hour at 15s
  // Mount read + one per QUIET_REFETCH_EVERY_MS: 60 reads an hour, against 900 at the old 4s cadence.
  assertEquals(h.reads(), 1 + 60);
});

Deno.test("1f. STORE: a live run still reads on every heartbeat", async () => {
  let clockBase = 0;
  const live = (): PlanRead => ({ plan: plan("executing", T0), tasks: [running(T0)], activity: [
    { id: "a", created_at: iso(clockBase) } as never,
  ], approvals: [], toolCalls: [] });
  clockBase = T0 + 60_000;
  const h = harness(live(), T0 + 60_000);
  h.registry.acquire("p1");
  await settle();
  for (let i = 0; i < 4; i++) await h.beat(); // one minute, activity 1 minute old at most
  assertEquals(h.reads(), 1 + 4);
});

// ══════════════════ 3. realtime never ships a whole task row ══════════════════

Deno.test("3. subscribePlan listens to tasks INSERTs only — no UPDATE push of a 128-572 kB row", async () => {
  const src = await Deno.readTextFile(new URL("../../src/lib/orchestration.ts", import.meta.url));
  const start = src.indexOf("export const subscribePlan = ");
  assert(start >= 0, "subscribePlan not found");
  const body = src.slice(start, src.indexOf("};", start));
  const taskLines = body.split("\n").filter((l) => /table:\s*'tasks'/.test(l));
  assertEquals(taskLines.length, 1, body);
  assert(/event:\s*'INSERT'/.test(taskLines[0]), taskLines[0]);
  // The other tables still push, so a run's progress still arrives by realtime.
  for (const t of ["task_plans", "activity_feed", "approvals"]) {
    assert(new RegExp(`table:\\s*'${t}'`).test(body), `${t} must stay subscribed`);
  }
});
