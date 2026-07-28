// CONTINUATION + TERMINAL STATUS, RENDERED HONESTLY.
//
// The runtime distinguishes `continuation_required` (a checkpoint was written;
// the SAME task can resume) from six genuinely terminal statuses. The UI used to
// collapse every non-error HTTP 200 into "completed", which is how a run that
// delivered 0 of 5 leads reported success.
//
// `continuation_required` is NOT terminal. Continuing must resume the same task
// from its checkpoint — never create a new task, never restart round 1.
//
// Pure — no React, no network.

export type TerminalStatus =
  | 'completed'
  | 'quota_not_met'
  | 'search_exhausted'
  | 'budget_exhausted'
  | 'round_limit_reached'
  | 'provider_failure'
  | 'invalid_request'
  | 'source_transition_failed'
  | 'continuation_required';

/** Statuses after which no further sourcing may be offered. */
export const TRUE_TERMINAL_STATUSES: readonly TerminalStatus[] = [
  'completed', 'search_exhausted', 'budget_exhausted',
  'round_limit_reached', 'provider_failure', 'invalid_request',
  // The round's outcome could not be folded into source state. No Continue button:
  // the runtime cannot say what the next action is, so it must not offer one.
  'source_transition_failed',
];

/** Row states from which a checkpoint may still be continued. */
export const RESUMABLE_ROW_STATUSES: readonly string[] = ['ready', 'partial', 'running', 'complete'];
/** Row states that end the lifecycle; a Continue button must never appear. */
export const TERMINAL_ROW_STATUSES: readonly string[] = ['failed', 'skipped'];

export interface CompanyFirstResponse {
  terminal_status?: string | null;
  task_status?: string | null;
  /** `tasks.status` — the database lifecycle state. */
  row_status?: string | null;
  task_id?: string | null;
  continuation_token?: string | null;
  requested_leads?: number | null;
  eligible_leads?: number | null;
  remaining_leads?: number | null;
  rounds_completed?: number | null;
  next_round?: number | null;
  checkpoint_at?: string | null;
}

export interface ContinuationView {
  status: TerminalStatus;
  /** True only for `continuation_required` with a usable token. */
  canContinue: boolean;
  continuationToken: string | null;
  nextRound: number | null;
  checkpointAt: string | null;
  /** Headline + supporting lines, already ordered for display. */
  lines: string[];
  /** Button label; null when no continuation is offered. */
  actionLabel: string | null;
}

function n(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

const STATUS_HEADLINE: Record<TerminalStatus, string> = {
  completed: 'Completed',
  quota_not_met: 'Quota not met',
  search_exhausted: 'Search exhausted',
  budget_exhausted: 'Budget limit reached',
  round_limit_reached: 'Round limit reached',
  provider_failure: 'Sourcing failed',
  invalid_request: 'Request could not be executed',
  continuation_required: 'Round complete',
  source_transition_failed: 'Source transition failed',
};

export function isTerminal(status: string | null | undefined): boolean {
  return TRUE_TERMINAL_STATUSES.includes(status as TerminalStatus);
}

/**
 * Map a company-first response to what the user is told.
 *
 * Every non-completed status states the delivered count AND the remaining quota,
 * so a partial run can never read as a satisfied one.
 */
export function buildContinuationView(res: CompanyFirstResponse | null | undefined): ContinuationView {
  const status = (res?.terminal_status as TerminalStatus) ?? 'invalid_request';
  const requested = n(res?.requested_leads);
  const eligible = n(res?.eligible_leads);
  const remaining = n(res?.remaining_leads, Math.max(0, requested - eligible));
  const rounds = n(res?.rounds_completed);
  const token = res?.continuation_token ?? null;

  const progressLine = `${eligible} of ${requested} CONTACT-ready ${requested === 1 ? 'lead' : 'leads'}`;
  const remainingLine = `${remaining} remaining`;

  if (status === 'continuation_required') {
    // "Completed / 0 of 5" must never occur; this is the branch that used to
    // produce it, because a 200 with a checkpoint looked like a finished run.
    //
    // Continue is offered ONLY when all three hold: the outcome is
    // continuation_required, a token exists, and the ROW still advertises itself
    // as resumable. A row that has been failed or skipped is not continuable
    // however the outcome reads.
    const rowResumable = res?.row_status == null || !TERMINAL_ROW_STATUSES.includes(String(res.row_status));
    const canContinue = !!token && rowResumable;
    return {
      status,
      canContinue,
      continuationToken: token,
      nextRound: res?.next_round ?? null,
      checkpointAt: res?.checkpoint_at ?? null,
      lines: [
        rounds > 0 ? `Round ${rounds} complete` : STATUS_HEADLINE[status],
        progressLine,
        remainingLine,
        'More sourcing is required',
      ],
      actionLabel: canContinue ? 'Continue sourcing' : null,
    };
  }

  const lines = status === 'completed'
    ? [STATUS_HEADLINE.completed, progressLine]
    : [STATUS_HEADLINE[status] ?? 'Stopped', progressLine, remainingLine];

  return {
    status,
    canContinue: false,
    continuationToken: null,
    nextRound: null,
    checkpointAt: res?.checkpoint_at ?? null,
    lines,
    actionLabel: null,
  };
}

// ------------------------------------------------------- continuation state --

export type ContinuationPhase = 'idle' | 'running' | 'error';

export interface ContinuationState {
  phase: ContinuationPhase;
  /** The task being continued. ALWAYS the original task id. */
  taskId: string | null;
  token: string | null;
  error: string | null;
  /** The last successful checkpoint. Survives a failed continuation. */
  lastCheckpointAt: string | null;
  attempts: number;
}

export function initialContinuationState(view: ContinuationView, taskId: string | null): ContinuationState {
  return {
    phase: 'idle',
    taskId,
    token: view.continuationToken,
    error: null,
    lastCheckpointAt: view.checkpointAt,
    attempts: 0,
  };
}

export type ContinuationEvent =
  | { type: 'continue_clicked' }
  | { type: 'succeeded'; view: ContinuationView }
  | { type: 'failed'; error: string };

/**
 * Guards double-clicks and concurrent continuations: a `continue_clicked` while
 * `running` is a no-op, so the same checkpoint can never be paid for twice.
 */
export function continuationReducer(state: ContinuationState, ev: ContinuationEvent): ContinuationState {
  switch (ev.type) {
    case 'continue_clicked':
      if (state.phase === 'running') return state;         // double-click / concurrent
      if (!state.token) return { ...state, phase: 'error', error: 'No continuation token available.' };
      return { ...state, phase: 'running', error: null, attempts: state.attempts + 1 };
    case 'succeeded':
      return {
        phase: 'idle',
        // The task id NEVER changes across a continuation.
        taskId: state.taskId,
        token: ev.view.continuationToken,
        error: null,
        lastCheckpointAt: ev.view.checkpointAt ?? state.lastCheckpointAt,
        attempts: state.attempts,
      };
    case 'failed':
      // Recoverable: the prior checkpoint and token are deliberately preserved.
      return { ...state, phase: 'error', error: ev.error };
    default:
      return state;
  }
}

/** True only when a click should actually dispatch a continuation request. */
export function canDispatchContinue(state: ContinuationState, view: ContinuationView): boolean {
  return view.canContinue && state.phase !== 'running' && !!state.token;
}

export interface ContinuationRequest {
  task_id: string;
  continuation_token: string;
  resume: true;
  /** Explicitly NOT a new task, and explicitly not round 1. */
  create_new_task: false;
}

/** The request body for Continue sourcing. Reuses the original task id. */
export function buildContinuationRequest(state: ContinuationState): ContinuationRequest | null {
  if (!state.taskId || !state.token) return null;
  return {
    task_id: state.taskId,
    continuation_token: state.token,
    resume: true,
    create_new_task: false,
  };
}
