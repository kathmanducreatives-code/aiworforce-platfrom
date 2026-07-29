import { describe, it, expect } from 'vitest';
import {
  deriveWorkflowUiState, isLongRunning, isWorkflowActive,
  isCheckpointedPartial, taskResultIsPartial,
} from './state';

const baseTask = {
  status: 'pending' as const,
  started_at: null,
  finished_at: null,
};

const basePlan = {
  status: 'planning' as const,
  created_at: new Date('2024-01-01T00:00:00Z').toISOString(),
  completed_at: null,
};

describe('deriveWorkflowUiState', () => {
  it('returns not_started without a plan', () => {
    expect(deriveWorkflowUiState({ plan: null, tasks: [], approvals: [] })).toBe('not_started');
  });

  it('marks failed plans failed', () => {
    expect(deriveWorkflowUiState({ plan: { ...basePlan, status: 'failed' }, tasks: [], approvals: [] })).toBe('failed');
  });

  it('returns waiting_confirmation when an approval is pending', () => {
    expect(deriveWorkflowUiState({
      plan: basePlan,
      tasks: [{ ...baseTask, status: 'running' }],
      approvals: [{ status: 'pending' }],
    })).toBe('waiting_confirmation');
  });

  it('returns running while tasks are in flight', () => {
    expect(deriveWorkflowUiState({
      plan: basePlan,
      tasks: [{ ...baseTask, status: 'running' }],
      approvals: [],
      lastActivityAt: new Date().toISOString(),
    })).toBe('running');
  });

  it('returns partial when complete but some tasks failed', () => {
    expect(deriveWorkflowUiState({
      plan: { ...basePlan, status: 'complete' },
      tasks: [
        { ...baseTask, status: 'complete' },
        { ...baseTask, status: 'failed' },
      ],
      approvals: [],
    })).toBe('partial');
  });

  it('returns complete when every task is done', () => {
    expect(deriveWorkflowUiState({
      plan: { ...basePlan, status: 'complete' },
      tasks: [{ ...baseTask, status: 'complete' }],
      approvals: [],
    })).toBe('complete');
  });

  it('flips to stale when running with no activity for over 24h', () => {
    const old = new Date('2024-01-01T00:00:00Z').toISOString();
    const now = new Date('2024-01-03T00:00:00Z').getTime();
    expect(deriveWorkflowUiState({
      plan: basePlan,
      tasks: [{ ...baseTask, status: 'running' }],
      approvals: [],
      lastActivityAt: old,
      now,
    })).toBe('stale');
  });
});

// PRODUCTION RUN 3d54e4fe-b6b6-47a6-9dca-ee032785ea59 (2026-07-29).
//
// The backend finished in 83s: two Apify rounds succeeded, the plan moved to
// `partial`, the task row to `ready`, and the result recorded
// `continuation_required` with a checkpoint. The UI showed "Pilot is preparing
// the workflow" for the next six minutes, because no branch matched and the
// function fell through to `preparing`.
const CHECKPOINTED_RESULT = {
  task_status: 'partial',
  terminal_status: 'continuation_required',
  company_first: {
    status: 'continuation_required',
    quota: { requested_leads: 5, eligible_leads: 0, remaining_leads: 5 },
    continuation: { required: true, next_round: 3, continuation_token: 'task-6ffc14c8' },
  },
};

describe('deriveWorkflowUiState — checkpointed partial runs', () => {
  it('1. a ready task on a partial plan is partial, not preparing', () => {
    expect(deriveWorkflowUiState({
      plan: { ...basePlan, status: 'partial' },
      tasks: [{ ...baseTask, status: 'ready', result: CHECKPOINTED_RESULT }],
      approvals: [],
    })).toBe('partial');
  });

  it('1b. a ready task is partial even while the plan still reads executing', () => {
    // The plan-row update and the task-row update are separate writes; the UI
    // must not depend on observing them in order.
    expect(deriveWorkflowUiState({
      plan: { ...basePlan, status: 'executing' },
      tasks: [{ ...baseTask, status: 'ready', result: CHECKPOINTED_RESULT }],
      approvals: [],
    })).toBe('partial');
  });

  it('2. continuation_required never maps to preparing', () => {
    const state = deriveWorkflowUiState({
      plan: { ...basePlan, status: 'partial' },
      tasks: [{ ...baseTask, status: 'ready', result: CHECKPOINTED_RESULT }],
      approvals: [],
    });
    expect(state).not.toBe('preparing');
    // And it must not read as an active workflow, which is what drives
    // "Executing" and "Pilot is preparing the workflow".
    expect(isWorkflowActive(state)).toBe(false);
  });

  it('2b. a checkpointed run is NOT treated as completed', () => {
    expect(deriveWorkflowUiState({
      plan: { ...basePlan, status: 'partial' },
      tasks: [{ ...baseTask, status: 'ready', result: CHECKPOINTED_RESULT }],
      approvals: [],
    })).not.toBe('complete');
  });

  it('a still-running sibling task keeps the run running', () => {
    // A checkpoint on one task does not settle a plan that is still working.
    expect(deriveWorkflowUiState({
      plan: { ...basePlan, status: 'executing' },
      tasks: [
        { ...baseTask, status: 'ready', result: CHECKPOINTED_RESULT },
        { ...baseTask, status: 'running' },
      ],
      approvals: [],
      lastActivityAt: new Date().toISOString(),
    })).toBe('running');
  });

  it('a pending approval still wins over a checkpoint', () => {
    expect(deriveWorkflowUiState({
      plan: { ...basePlan, status: 'partial' },
      tasks: [{ ...baseTask, status: 'ready', result: CHECKPOINTED_RESULT }],
      approvals: [{ status: 'pending' }],
    })).toBe('waiting_confirmation');
  });

  it('a bare ready row with no result is not claimed as partial', () => {
    // Nothing has proven work happened, so the old behaviour stands.
    expect(deriveWorkflowUiState({
      plan: basePlan,
      tasks: [{ ...baseTask, status: 'ready' }],
      approvals: [],
    })).toBe('preparing');
  });
});

describe('isCheckpointedPartial / taskResultIsPartial', () => {
  it('needs BOTH a lifecycle signal and a partial result', () => {
    const ready = { ...baseTask, status: 'ready' as const, result: CHECKPOINTED_RESULT };
    expect(isCheckpointedPartial({ plan: basePlan, tasks: [ready] })).toBe(true);
    // Lifecycle signal without a partial result.
    expect(isCheckpointedPartial({ plan: basePlan, tasks: [{ ...baseTask, status: 'ready' }] })).toBe(false);
    // Partial result without a lifecycle signal.
    expect(isCheckpointedPartial({
      plan: basePlan, tasks: [{ ...baseTask, status: 'running', result: CHECKPOINTED_RESULT }],
    })).toBe(false);
  });

  it('reads either separated result field', () => {
    expect(taskResultIsPartial({ task_status: 'partial' })).toBe(true);
    expect(taskResultIsPartial({ terminal_status: 'continuation_required' })).toBe(true);
    expect(taskResultIsPartial({ task_status: 'completed', terminal_status: 'completed' })).toBe(false);
    expect(taskResultIsPartial(null)).toBe(false);
    expect(taskResultIsPartial('nonsense')).toBe(false);
  });
});

describe('isLongRunning / isWorkflowActive', () => {
  it('reports active states', () => {
    expect(isWorkflowActive('running')).toBe(true);
    expect(isWorkflowActive('complete')).toBe(false);
    expect(isWorkflowActive('failed')).toBe(false);
  });
  it('long-running needs > 90s of silence', () => {
    const now = Date.now();
    expect(isLongRunning(new Date(now - 30_000).toISOString(), now)).toBe(false);
    expect(isLongRunning(new Date(now - 120_000).toISOString(), now)).toBe(true);
    expect(isLongRunning(null, now)).toBe(false);
  });
});
