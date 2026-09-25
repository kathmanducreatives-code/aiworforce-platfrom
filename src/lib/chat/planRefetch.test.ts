// THE HEARTBEAT THAT NEVER FIRED.
//
// `usePlanDetail` already polled every 4s, guarded by
// `isWorkflowActive(deriveWorkflowUiState(...))`. The guard read `plan`, `tasks`
// and `approvals` captured when the effect ran — `null` and `[]` — because the
// effect's deps are `[planId, refreshTick]` and never re-run. A null plan
// derives `not_started`, which is not active, so the guard rejected every tick
// forever.
//
// These tests pin the decision against CURRENT state, which is what the hook now
// passes via refs.

import { describe, it, expect } from 'vitest';
import {
  ACTIVE_QUIET_AFTER_MS, decidePlanRefetch, EMPTY_PLAN_WAIT_MS, QUIET_REFETCH_EVERY_MS,
} from './planRefetch';

const plan = {
  status: 'executing' as const,
  created_at: new Date('2026-07-29T00:09:10Z').toISOString(),
  completed_at: null,
};

const CREATED = Date.parse(plan.created_at);

const task = { status: 'running' as const, started_at: null, finished_at: null };

const CHECKPOINTED = {
  status: 'ready' as const,
  started_at: null,
  finished_at: null,
  result: { task_status: 'partial', terminal_status: 'continuation_required' },
};

describe('decidePlanRefetch', () => {
  it('6. a plan holding zero tasks refetches — the mount-time race', () => {
    // Production: plan inserted 00:09:10.451, task inserted 00:09:13.080. The
    // first fetch legitimately saw zero tasks; without this the view stays on
    // "Plan is being created…" until the user reloads.
    const d = decidePlanRefetch({ plan, tasks: [], approvals: [], now: CREATED + 3_000 });
    expect(d).toEqual({ should: true, reason: 'plan_without_tasks' });
  });

  it('6b. the mount-time closure bug: a null plan must not be read as active', () => {
    // The old guard evaluated this exact input every 4s and concluded "not
    // active", so it never called load(). There is nothing to fetch for a null
    // plan — but the hook must not be *relying* on this path.
    expect(decidePlanRefetch({ plan: null, tasks: [], approvals: [] }))
      .toEqual({ should: false, reason: 'no_plan' });
  });

  it('6c. once the task arrives, an active workflow keeps refetching', () => {
    const d = decidePlanRefetch({
      plan, tasks: [task], approvals: [], lastActivityAt: new Date().toISOString(),
    });
    expect(d).toEqual({ should: true, reason: 'workflow_active' });
  });

  it('7. a settled checkpointed run stops the heartbeat — this is not polling', () => {
    const d = decidePlanRefetch({
      plan: { ...plan, status: 'partial' }, tasks: [CHECKPOINTED], approvals: [],
    });
    expect(d).toEqual({ should: false, reason: 'settled' });
  });

  it('7b. regaining focus refetches a settled plan exactly once', () => {
    // Realtime does not replay events missed while the tab was hidden.
    const d = decidePlanRefetch({
      plan: { ...plan, status: 'partial' }, tasks: [CHECKPOINTED], approvals: [],
      regainedFocus: true,
    });
    expect(d).toEqual({ should: true, reason: 'regained_focus' });
  });

  it('7c. focus on a plan with no tasks still reports the stronger reason', () => {
    const d = decidePlanRefetch({ plan, tasks: [], approvals: [], regainedFocus: true, now: CREATED + 3_000 });
    expect(d.should).toBe(true);
    expect(d.reason).toBe('plan_without_tasks');
  });

  it('a completed plan is quiet even on focus-less ticks', () => {
    const d = decidePlanRefetch({
      plan: { ...plan, status: 'complete' },
      tasks: [{ status: 'complete' as const, started_at: null, finished_at: null }],
      approvals: [],
    });
    expect(d.should).toBe(false);
  });

  // ── EGRESS BOUNDS (2026-09-25 audit) ──────────────────────────────────────
  //
  // This used to read "an approval-blocked plan keeps reading, so an approval
  // elsewhere lands" and expected `workflow_active` on every tick — with no
  // time bound, one open tab on a plan waiting for a person reloaded 25-91 kB
  // task rows every heartbeat for as long as it stayed open. The approval lands
  // through realtime (`subscribePlan` watches `approvals`) and on focus.
  it('an approval-blocked plan does NOT poll — the approval arrives by realtime and focus', () => {
    const d = decidePlanRefetch({
      plan, tasks: [task], approvals: [{ status: 'pending' }], now: CREATED + 60_000,
    });
    expect(d).toEqual({ should: false, reason: 'awaiting_approval' });
  });

  it('an approval-blocked plan still reads once when the tab regains focus', () => {
    const d = decidePlanRefetch({
      plan, tasks: [task], approvals: [{ status: 'pending' }], regainedFocus: true, now: CREATED + 60_000,
    });
    expect(d).toEqual({ should: true, reason: 'regained_focus' });
  });

  it('a running workflow with recent activity reads on every heartbeat', () => {
    const now = CREATED + 60 * 60_000;
    const d = decidePlanRefetch({
      plan, tasks: [task], approvals: [], now,
      lastActivityAt: new Date(now - ACTIVE_QUIET_AFTER_MS + 1_000).toISOString(), lastReadAt: now - 1_000,
    });
    expect(d).toEqual({ should: true, reason: 'workflow_active' });
  });

  it('a running workflow gone quiet reads at most once a minute', () => {
    const now = CREATED + 60 * 60_000;
    const quiet = { plan, tasks: [task], approvals: [], now,
      lastActivityAt: new Date(now - ACTIVE_QUIET_AFTER_MS - 1_000).toISOString() };
    expect(decidePlanRefetch({ ...quiet, lastReadAt: now - 15_000 }))
      .toEqual({ should: false, reason: 'workflow_quiet' });
    expect(decidePlanRefetch({ ...quiet, lastReadAt: now - QUIET_REFETCH_EVERY_MS }))
      .toEqual({ should: true, reason: 'workflow_quiet' });
    expect(decidePlanRefetch({ ...quiet, lastReadAt: null }))
      .toEqual({ should: true, reason: 'workflow_quiet' }, 'nothing read yet is always due');
    expect(decidePlanRefetch({ ...quiet, lastReadAt: now - 1_000, regainedFocus: true }))
      .toEqual({ should: true, reason: 'regained_focus' });
  });

  it('a plan that never got a task stops asking after EMPTY_PLAN_WAIT_MS', () => {
    expect(decidePlanRefetch({ plan, tasks: [], approvals: [], now: CREATED + EMPTY_PLAN_WAIT_MS }))
      .toEqual({ should: true, reason: 'plan_without_tasks' });
    expect(decidePlanRefetch({ plan, tasks: [], approvals: [], now: CREATED + EMPTY_PLAN_WAIT_MS + 1 }))
      .toEqual({ should: false, reason: 'settled' });
  });

  it('a finished or blocked plan with no tasks is settled at once', () => {
    for (const status of ['blocked', 'failed', 'complete'] as const) {
      expect(decidePlanRefetch({ plan: { ...plan, status }, tasks: [], approvals: [], now: CREATED + 3_000 }))
        .toEqual({ should: false, reason: 'settled' });
    }
  });
});
