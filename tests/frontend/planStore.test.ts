// EGRESS — ONE READER PER PLAN, AND NONE AT ALL WHILE NOBODY IS LOOKING.
//
// The 5.5 GB/day incident had three frontend components: four independent
// polling loops for one plan, a heartbeat that ran while the tab was hidden,
// and a task read that carried the engine's whole resume state. This file pins
// the first two; `taskListProjection` pins the third.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createPlanStoreRegistry, PLAN_HEARTBEAT_MS, type PlanRead, type PlanStoreIo,
} from "../../src/lib/chat/planStore.ts";

/** A plan that is still moving, so `decidePlanRefetch` wants to read. */
const ACTIVE: PlanRead = {
  plan: { id: "p1", status: "executing", created_at: "2026-09-20T10:00:00.000Z" } as never,
  tasks: [{ id: "t1", status: "running", created_at: "2026-09-20T10:00:00.000Z" } as never],
  activity: [], approvals: [], toolCalls: [],
};

function harness(over: Partial<PlanStoreIo> = {}) {
  const calls = { reads: 0, subscribes: 0, unsubscribes: 0, intervals: 0, clears: 0, focusOn: 0, focusOff: 0 };
  let hidden = false;
  let tick: (() => void) | null = null;
  let push: (() => void) | null = null;
  const io: PlanStoreIo = {
    read: () => { calls.reads++; return Promise.resolve(ACTIVE); },
    subscribe: (_id, onChange) => { calls.subscribes++; push = onChange; return () => { calls.unsubscribes++; }; },
    isHidden: () => hidden,
    onFocus: () => { calls.focusOn++; return () => { calls.focusOff++; }; },
    setInterval: (fn) => { calls.intervals++; tick = fn; return calls.intervals; },
    clearInterval: () => { calls.clears++; },
    now: () => 1_000,
    ...over,
  };
  return {
    calls, io,
    registry: createPlanStoreRegistry(io),
    beat: () => tick?.(),
    realtime: () => push?.(),
    hide: (v: boolean) => { hidden = v; },
  };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

Deno.test("HIDDEN TAB: the heartbeat reads nothing while nobody is looking", async () => {
  const h = harness();
  h.registry.acquire("p1");
  await settle();
  assertEquals(h.calls.reads, 1, "the mount read still happens");

  h.hide(true);
  for (let i = 0; i < 10; i++) h.beat();
  await settle();
  assertEquals(h.calls.reads, 1, "ten heartbeats against a hidden tab read nothing");

  // Visible again: the safety net resumes for a plan that is still moving.
  h.hide(false);
  h.beat();
  await settle();
  assertEquals(h.calls.reads, 2);
});

Deno.test("REALTIME stays the primary path, hidden or not", async () => {
  const h = harness();
  h.registry.acquire("p1");
  await settle();
  h.hide(true);
  h.realtime();
  await settle();
  assertEquals(h.calls.reads, 2, "a pushed change is still read — realtime is not polling");
});

Deno.test("ONE PLAN, ONE LOOP: four consumers share a store, a subscription and a heartbeat", async () => {
  const h = harness();
  const a = h.registry.acquire("p1");   // ConversationView
  const b = h.registry.acquire("p1");   // ExecutionPlanCard
  const c = h.registry.acquire("p1");   // PlanDetailView
  const d = h.registry.acquire("p1");   // Workbench
  await settle();
  assertEquals([h.calls.intervals, h.calls.subscribes, h.calls.reads], [1, 1, 1],
    "one interval, one subscription, one read for four consumers");
  assertEquals(h.registry.size(), 1);
  assert(a === b && b === c && c === d, "the same store object");

  // Each consumer sees every update.
  let notified = 0;
  for (const s of [a, b, c, d]) s.subscribe(() => { notified++; });
  h.realtime();
  await settle();
  assert(notified >= 4, `every consumer is notified (got ${notified})`);

  // The loop is torn down only when the LAST consumer leaves.
  h.registry.release("p1"); h.registry.release("p1"); h.registry.release("p1");
  assertEquals([h.calls.clears, h.calls.unsubscribes], [0, 0], "three left, one still watching");
  h.registry.release("p1");
  assertEquals([h.calls.clears, h.calls.unsubscribes, h.registry.size()], [1, 1, 0]);
});

Deno.test("a second plan gets its own store; releasing one does not stop the other", async () => {
  const h = harness();
  h.registry.acquire("p1");
  h.registry.acquire("p2");
  await settle();
  assertEquals([h.registry.size(), h.calls.intervals], [2, 2]);
  h.registry.release("p1");
  assertEquals([h.registry.size(), h.calls.clears], [1, 1]);
});

Deno.test("a settled plan does not read on the heartbeat, visible or not", async () => {
  const done: PlanRead = {
    plan: { id: "p1", status: "complete", created_at: "2026-09-20T10:00:00.000Z", completed_at: "2026-09-20T10:05:00.000Z" } as never,
    tasks: [{ id: "t1", status: "complete", created_at: "2026-09-20T10:00:00.000Z", finished_at: "2026-09-20T10:05:00.000Z" } as never],
    activity: [], approvals: [], toolCalls: [],
  };
  const h = harness({ read: () => Promise.resolve(done) });
  h.registry.acquire("p1");
  await settle();
  const after = h.calls.reads;
  for (let i = 0; i < 5; i++) h.beat();
  await settle();
  assertEquals(h.calls.reads, after, "a finished plan is not polled");
});

Deno.test("the heartbeat interval is the 4s safety net, not a data path", () => {
  assertEquals(PLAN_HEARTBEAT_MS, 4000);
});
