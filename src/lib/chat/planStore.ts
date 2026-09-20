// ONE READER PER PLAN, HOWEVER MANY COMPONENTS WATCH IT.
//
// `usePlanDetail` used to own its reads: each mount created its own 4-second
// heartbeat, its own realtime subscription and its own five-query fan-out.
// Four components call it for the SAME plan — ConversationView,
// ExecutionPlanCard, PlanDetailView and the Workbench — so one open workflow
// ran four independent polling loops, all fetching the same rows.
//
// And the heartbeat never asked whether anyone was looking: a hidden tab on an
// active plan kept reading every four seconds for as long as it was left open.
// With `tasks.result` at 150-500 kB a row, that is measured in gigabytes a day.
//
// This module holds ONE store per plan id, reference-counted:
//
//   realtime  → the primary path; every change pushes, and the store reloads
//   heartbeat → a safety net for a dropped socket, and ONLY while the tab is
//               visible and the workflow is still moving (`decidePlanRefetch`)
//   focus     → one read when a hidden tab comes back, closing the socket gap
//
// The last consumer to leave tears all three down. Every effect is injected, so
// the loop is exercised in tests without React, a browser or a network.

import { coalesceLoads } from './coalescedLoad';
import { decidePlanRefetch } from './planRefetch';
import type { DBActivity, DBApproval, DBPlan, DBTask, DBToolCall } from '@/lib/orchestration';

/** How often the safety net may fire. Realtime is what actually keeps state fresh. */
export const PLAN_HEARTBEAT_MS = 4000;

export interface PlanSnapshot {
  plan: DBPlan | null;
  tasks: DBTask[];
  activity: DBActivity[];
  approvals: DBApproval[];
  toolCalls: DBToolCall[];
  loading: boolean;
  lastActivityAt: string | null;
  /** When the newest activity timestamp last changed — "still working" labels read it. */
  lastChangeAt: number;
}

export interface PlanRead {
  plan: DBPlan | null;
  tasks: DBTask[];
  activity: DBActivity[];
  approvals: DBApproval[];
  toolCalls: DBToolCall[];
}

export interface PlanStoreIo {
  read: (planId: string) => Promise<PlanRead>;
  subscribe: (planId: string, onChange: () => void) => () => void;
  /** The tab is not being looked at: the heartbeat stays quiet. */
  isHidden: () => boolean;
  onFocus: (handler: () => void) => () => void;
  setInterval: (fn: () => void, ms: number) => number;
  clearInterval: (id: number) => void;
  now: () => number;
}

export interface PlanStore {
  snapshot: () => PlanSnapshot;
  subscribe: (listener: () => void) => () => void;
  /** Read now, whatever the heartbeat thinks. */
  refresh: () => void;
}

const EMPTY: PlanSnapshot = {
  plan: null, tasks: [], activity: [], approvals: [], toolCalls: [],
  loading: true, lastActivityAt: null, lastChangeAt: 0,
};

export function latestActivityTs(r: PlanRead): string | null {
  const candidates: Array<string | null> = [
    r.plan?.completed_at ?? null,
    r.plan?.created_at ?? null,
    ...r.tasks.map((t) => t.finished_at ?? t.started_at ?? t.created_at ?? null),
    ...r.activity.map((a) => a.created_at ?? null),
    ...r.toolCalls.map((c) => c.completed_at ?? c.started_at ?? c.created_at ?? null),
  ];
  let best = -Infinity;
  let bestStr: string | null = null;
  for (const c of candidates) {
    if (!c) continue;
    const t = Date.parse(c);
    if (Number.isFinite(t) && t > best) { best = t; bestStr = c; }
  }
  return bestStr;
}

interface Entry {
  store: PlanStore;
  refs: number;
  stop: () => void;
}

export interface PlanStoreRegistry {
  acquire: (planId: string) => PlanStore;
  release: (planId: string) => void;
  /** Live stores — a test asserts that four consumers of one plan make one. */
  size: () => number;
}

export function createPlanStoreRegistry(io: PlanStoreIo): PlanStoreRegistry {
  const entries = new Map<string, Entry>();

  const create = (planId: string): Entry => {
    let snapshot: PlanSnapshot = { ...EMPTY, lastChangeAt: io.now() };
    const listeners = new Set<() => void>();
    let stopped = false;
    const emit = () => { for (const l of [...listeners]) l(); };
    const set = (patch: Partial<PlanSnapshot>) => {
      snapshot = { ...snapshot, ...patch };
      emit();
    };

    const read = async () => {
      set({ loading: true });
      const r = await io.read(planId);
      if (stopped) return;
      const latest = latestActivityTs(r);
      const changed = latest !== snapshot.lastActivityAt;
      set({
        ...r, loading: false, lastActivityAt: latest,
        lastChangeAt: changed ? io.now() : snapshot.lastChangeAt,
      });
    };

    // ONE OUTSTANDING READ, HOWEVER MANY THINGS ASK FOR ONE (`coalesceLoads`).
    const load = coalesceLoads(read, {
      isCancelled: () => stopped,
      onError: () => { if (!stopped) set({ loading: false }); },
    });
    load();

    const unsub = io.subscribe(planId, load);

    const tick = () => {
      // NOBODY IS LOOKING. Realtime still holds the socket; when the tab comes
      // back, `onFocus` closes whatever gap it left.
      if (io.isHidden()) return;
      const decision = decidePlanRefetch({
        plan: snapshot.plan, tasks: snapshot.tasks, approvals: snapshot.approvals,
        lastActivityAt: snapshot.lastActivityAt,
      });
      if (decision.should) load();
      // Re-render consumers so "still working" labels re-evaluate. No network.
      else emit();
    };
    const interval = io.setInterval(tick, PLAN_HEARTBEAT_MS);

    const offFocus = io.onFocus(() => {
      if (io.isHidden()) return;
      const decision = decidePlanRefetch({
        plan: snapshot.plan, tasks: snapshot.tasks, approvals: snapshot.approvals,
        lastActivityAt: snapshot.lastActivityAt, regainedFocus: true,
      });
      if (decision.should) load();
    });

    return {
      refs: 0,
      stop: () => {
        stopped = true;
        unsub();
        io.clearInterval(interval);
        offFocus();
        listeners.clear();
      },
      store: {
        snapshot: () => snapshot,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => { listeners.delete(listener); };
        },
        refresh: () => { load(); },
      },
    };
  };

  return {
    acquire: (planId) => {
      const existing = entries.get(planId);
      if (existing) { existing.refs++; return existing.store; }
      const entry = create(planId);
      entry.refs = 1;
      entries.set(planId, entry);
      return entry.store;
    },
    release: (planId) => {
      const entry = entries.get(planId);
      if (!entry) return;
      entry.refs--;
      if (entry.refs > 0) return;
      entry.stop();
      entries.delete(planId);
    },
    size: () => entries.size,
  };
}
