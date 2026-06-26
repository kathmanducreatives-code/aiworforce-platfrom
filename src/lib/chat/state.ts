/**
 * Centralized state model for the Conversations experience.
 *
 * Every chat consumer (history sidebar, ConversationView, ChatView,
 * ExecutionPlanCard) derives its visible UI from these types so that
 * no backend state ever fails silently.
 */

import type { DBPlan, DBTask, DBApproval } from '@/lib/orchestration';

export type ConversationLoadState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'empty'
  | 'error';

export type MessageSendState =
  | 'idle'
  | 'sending'
  | 'sent'
  | 'failed';

export type WorkflowRunUiState =
  | 'not_started'
  | 'preparing'
  | 'waiting_confirmation'
  | 'running'
  | 'streaming_progress'
  | 'partial'
  | 'complete'
  | 'failed'
  | 'stale';

export interface DeriveWorkflowInput {
  plan: Pick<DBPlan, 'status' | 'created_at' | 'completed_at'> | null;
  tasks: Pick<DBTask, 'status' | 'started_at' | 'finished_at'>[];
  approvals: Pick<DBApproval, 'status'>[];
  /** Most recent backend event timestamp (activity, tool call, task transition). */
  lastActivityAt?: string | null;
  /** Wall-clock now, injectable for tests. Defaults to Date.now(). */
  now?: number;
}

const STALE_MS = 24 * 60 * 60 * 1000; // 24h
const LONG_RUNNING_MS = 90 * 1000;    // 90s

export function deriveWorkflowUiState(input: DeriveWorkflowInput): WorkflowRunUiState {
  const { plan, tasks, approvals } = input;
  const now = input.now ?? Date.now();

  if (!plan) return 'not_started';
  if (plan.status === 'failed') return 'failed';

  const anyPendingApproval = approvals.some((a) => a.status === 'pending');
  if (anyPendingApproval) return 'waiting_confirmation';

  const anyFailed = tasks.some((t) => t.status === 'failed');
  const anyRunning = tasks.some((t) => t.status === 'running' || t.status === 'pending');
  const allDone = tasks.length > 0 && tasks.every((t) => t.status === 'complete' || t.status === 'skipped');

  if (allDone && anyFailed) return 'partial';
  if (allDone) return 'complete';
  if (plan.status === 'complete') return 'complete';

  if (anyRunning) {
    // Stale guard: a running plan with no activity for 24h is shown as stale,
    // not auto-marked failed.
    const lastTs = input.lastActivityAt ? Date.parse(input.lastActivityAt) : Date.parse(plan.created_at);
    if (Number.isFinite(lastTs) && now - lastTs > STALE_MS) return 'stale';
    return 'running';
  }

  if (plan.status === 'planning') return 'preparing';
  return 'preparing';
}

export function isWorkflowActive(state: WorkflowRunUiState): boolean {
  return state === 'preparing' || state === 'running' || state === 'streaming_progress' || state === 'waiting_confirmation';
}

export function isLongRunning(lastActivityAt: string | null | undefined, now = Date.now()): boolean {
  if (!lastActivityAt) return false;
  const ts = Date.parse(lastActivityAt);
  if (!Number.isFinite(ts)) return false;
  return now - ts > LONG_RUNNING_MS;
}

export const WORKFLOW_UI_LABEL: Record<WorkflowRunUiState, string> = {
  not_started: 'Not started',
  preparing: 'Preparing',
  waiting_confirmation: 'Needs approval',
  running: 'Running',
  streaming_progress: 'Running',
  partial: 'Partial',
  complete: 'Complete',
  failed: 'Failed',
  stale: 'Stale',
};
