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
  /** The tab regained focus after being hidden. */
  | 'regained_focus'
  /** Settled state, focused, nothing to chase. */
  | 'settled';

export interface RefetchDecision {
  should: boolean;
  reason: RefetchReason;
}

export interface RefetchInput extends Pick<DeriveWorkflowInput, 'plan' | 'tasks' | 'approvals' | 'lastActivityAt' | 'now'> {
  /** True when this evaluation was triggered by the tab regaining focus. */
  regainedFocus?: boolean;
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
 * and stays quiet.
 */
export function decidePlanRefetch(input: RefetchInput): RefetchDecision {
  if (!input.plan) return { should: false, reason: 'no_plan' };

  if (input.tasks.length === 0) return { should: true, reason: 'plan_without_tasks' };

  const uiState = deriveWorkflowUiState({
    plan: input.plan,
    tasks: input.tasks,
    approvals: input.approvals,
    lastActivityAt: input.lastActivityAt,
    now: input.now,
  });
  if (isWorkflowActive(uiState)) return { should: true, reason: 'workflow_active' };

  if (input.regainedFocus) return { should: true, reason: 'regained_focus' };

  return { should: false, reason: 'settled' };
}
