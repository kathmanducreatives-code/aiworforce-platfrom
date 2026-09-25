// WHEN MUST THE PLAN VIEW RE-READ THE BACKEND?
//
// Realtime is the primary path and stays that way. This module answers the
// narrower question the heartbeat and the focus handler need: given what we
// currently hold, is another read warranted?
//
// WHY IT EXISTS. `usePlanDetail` already had a 4s heartbeat guarded by
// `isWorkflowActive(uiState)`, and it never fired once. The interval callback
// closed over `plan`, `tasks` and `approvals` from the render that created it,
// and the effect's dependency list is `[planId, refreshTick]` — so it never
// re-ran, and the closure held the MOUNT-time values forever: `plan === null`,
// `tasks === []`. `deriveWorkflowUiState` returns `not_started` for a null plan,
// `isWorkflowActive('not_started')` is false, and so the guard rejected every
// tick for the lifetime of the component.
//
// That is why production run 3d54e4fe froze even though a polling fallback was
// already in the code. Both the realtime publication AND this guard had to be
// wrong at once; fixing only one leaves the UI stranded on a dropped socket.
//
// The decision is pure so it can be tested without React, a socket or a clock.

import { deriveWorkflowUiState, isWorkflowActive, type DeriveWorkflowInput } from './state';

export type RefetchReason =
  /** Nothing to read. */
  | 'no_plan'
  /** A plan exists but we hold no tasks — the classic "Plan is being created…". */
  | 'plan_without_tasks'
  /** The workflow is still moving; keep reading. */
  | 'workflow_active'
  /**
   * Still "running" but nothing has changed for `ACTIVE_QUIET_AFTER_MS`: read
   * at most once per `QUIET_REFETCH_EVERY_MS` (`should` says whether this tick
   * is the one). A stuck task no longer reads on every heartbeat for 24 hours.
   */
  | 'workflow_quiet'
  /**
   * Waiting on a person. Nothing moves until someone approves, and that
   * approval arrives as a realtime event (and on focus) — never by polling.
   */
  | 'awaiting_approval'
  /** The tab regained focus after being hidden. */
  | 'regained_focus'
  /** Settled state, focused, nothing to chase. */
  | 'settled';

// ── EGRESS BOUNDS (2026-09-25 audit) ─────────────────────────────────────────
//
// Production's Free-plan egress was exhausted. Every heartbeat read reloads the
// plan's tasks through `TASK_LIST_COLUMNS` — 25 kB a lead task on average, up
// to 91 kB — and two states kept that read firing on every tick indefinitely:
// a pending approval (no time bound at all) and a task left `running`/`pending`
// (bounded only by the 24-hour stale guard). One open tab on either was
// roughly 0.6-2 GB a day. Both are now bounded:
//
//   awaiting approval → no polling; realtime and focus deliver the approval
//   running, recent   → every heartbeat, as before
//   running, quiet    → one read a minute, until the stale guard ends it
//   no tasks yet      → every heartbeat, but only while the plan is open and
//                       younger than EMPTY_PLAN_WAIT_MS — the insert race is
//                       seconds long, not forever

/** A running workflow with no new activity for this long is "quiet". */
export const ACTIVE_QUIET_AFTER_MS = 10 * 60 * 1000;
/** A quiet workflow is read at most this often. */
export const QUIET_REFETCH_EVERY_MS = 60 * 1000;
/** How long a plan may wait for its first task before the view stops asking. */
export const EMPTY_PLAN_WAIT_MS = 10 * 60 * 1000;

export interface RefetchDecision {
  should: boolean;
  reason: RefetchReason;
}

export interface RefetchInput extends Pick<DeriveWorkflowInput, 'plan' | 'tasks' | 'approvals' | 'lastActivityAt' | 'now'> {
  /** True when this evaluation was triggered by the tab regaining focus. */
  regainedFocus?: boolean;
  /** When the store last completed a read (ms), for the quiet-workflow throttle. */
  lastReadAt?: number | null;
}

/**
 * Should the plan view read again?
 *
 * Three reasons, in priority order:
 *
 *   1. A PLAN WITH NO TASKS. orchestrate inserts the plan and run-agent inserts
 *      the task ~2s later, so the first fetch legitimately races and returns
 *      zero. Without this the view shows "Plan is being created…" until the user
 *      reloads — which is exactly what production did.
 *   2. AN ACTIVE WORKFLOW. Unchanged in spirit from the original heartbeat, but
 *      now evaluated against CURRENT state rather than a mount-time closure.
 *   3. REGAINED FOCUS. Realtime does not replay what was missed while the tab
 *      was hidden, and a socket dropped in the background reconnects with a gap.
 *
 * A settled, focused plan reads nothing. This is deliberately not polling: once
 * the workflow reaches a terminal or checkpointed state the heartbeat goes quiet
 * and stays quiet. A plan waiting on an approval, a quiet run and a plan that
 * never got a task are bounded too — see EGRESS BOUNDS above.
 */
export function decidePlanRefetch(input: RefetchInput): RefetchDecision {
  if (!input.plan) return { should: false, reason: 'no_plan' };
  const now = input.now ?? Date.now();

  if (input.tasks.length === 0) {
    const open = input.plan.status === 'planning' || input.plan.status === 'executing';
    const age = now - Date.parse(input.plan.created_at);
    if (open && !(age > EMPTY_PLAN_WAIT_MS)) return { should: true, reason: 'plan_without_tasks' };
    // A plan that never got a task (or ended without one) is settled.
    return input.regainedFocus
      ? { should: true, reason: 'regained_focus' }
      : { should: false, reason: 'settled' };
  }

  const uiState = deriveWorkflowUiState({
    plan: input.plan,
    tasks: input.tasks,
    approvals: input.approvals,
    lastActivityAt: input.lastActivityAt,
    now,
  });

  if (uiState === 'waiting_confirmation') {
    return input.regainedFocus
      ? { should: true, reason: 'regained_focus' }
      : { should: false, reason: 'awaiting_approval' };
  }

  if (isWorkflowActive(uiState)) {
    const last = Date.parse(input.lastActivityAt ?? input.plan.created_at);
    const quiet = Number.isFinite(last) && now - last > ACTIVE_QUIET_AFTER_MS;
    if (!quiet) return { should: true, reason: 'workflow_active' };
    if (input.regainedFocus) return { should: true, reason: 'regained_focus' };
    const due = input.lastReadAt == null || now - input.lastReadAt >= QUIET_REFETCH_EVERY_MS;
    return { should: due, reason: 'workflow_quiet' };
  }

  if (input.regainedFocus) return { should: true, reason: 'regained_focus' };

  return { should: false, reason: 'settled' };
}
