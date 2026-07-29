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
import { decidePlanRefetch } from './planRefetch';

const plan = {
  status: 'executing' as const,
  created_at: new Date('2026-07-29T00:09:10Z').toISOString(),
  completed_at: null,
};

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
    const d = decidePlanRefetch({ plan, tasks: [], approvals: [] });
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
    const d = decidePlanRefetch({ plan, tasks: [], approvals: [], regainedFocus: true });
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

  it('an approval-blocked plan keeps reading, so an approval elsewhere lands', () => {
    const d = decidePlanRefetch({
      plan, tasks: [task], approvals: [{ status: 'pending' }],
    });
    expect(d).toEqual({ should: true, reason: 'workflow_active' });
  });
});
