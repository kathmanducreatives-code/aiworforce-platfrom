import { describe, it, expect } from 'vitest';
import { deriveWorkflowUiState, isLongRunning, isWorkflowActive } from './state';

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
