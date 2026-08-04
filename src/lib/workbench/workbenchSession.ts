// ONE WORKBENCH PER CONVERSATION — ownership, not coincidence.
//
// THE DEFECT. `ChatWorkspaceContext` held `selectedOutput` in a single piece of
// provider state and never cleared it when the user changed chat. Open a
// workflow, switch to a new conversation, and the Workbench still rendered the
// PREVIOUS chat's `plan_id` — so a brand-new conversation that had sourced
// nothing displayed a completed run's leads as if they were its own.
//
// `useLeadResults` was not the bug: it queries `.eq('plan_id', planId)` and is
// correctly scoped. It was handed the wrong plan id.
//
// THE MODEL. A Workbench is owned by a chain, and every link must match:
//
//     workspace_id → conversation_id → task_id → plan_id
//
// Selections are kept PER CONVERSATION rather than globally, which is what makes
// "switch back to the older chat and see its own results" fall out for free
// instead of needing a second mechanism.
//
// PURE. No React, no network, no database — so the rules can be tested without
// mounting anything.

/** The full ownership chain for one Workbench view. */
export interface WorkbenchOwnership {
  workspaceId: string | null;
  conversationId: string | null;
  taskId: string | null;
  planId: string | null;
}

/** Shown when the ACTIVE workflow genuinely has no rows yet. */
export const EMPTY_WORKBENCH_MESSAGE = 'No results for this workflow yet.';

/** The bucket for a selection that arrived with no conversation at all. */
export const UNSCOPED_CONVERSATION = '__unscoped__';

/**
 * The cache key for one Workbench's rows.
 *
 * Every link in the chain is present. A key of just `planId` looks sufficient —
 * a plan belongs to one conversation, after all — but it cannot distinguish
 * "this conversation has no plan yet" from "reuse whatever was cached", which is
 * precisely the state the stale Workbench appeared in.
 */
export function workbenchQueryKey(o: WorkbenchOwnership): readonly string[] {
  return [
    'workbench',
    o.workspaceId ?? 'no-workspace',
    o.conversationId ?? 'no-conversation',
    o.taskId ?? 'no-task',
    o.planId ?? 'no-plan',
  ];
}

/** Two ownership chains address the same Workbench. */
export function sameWorkbench(a: WorkbenchOwnership, b: WorkbenchOwnership): boolean {
  const ka = workbenchQueryKey(a); const kb = workbenchQueryKey(b);
  return ka.length === kb.length && ka.every((v, i) => v === kb[i]);
}

/** The conversation bucket a selection belongs to. */
export function conversationBucket(
  selectionConversationId: string | null | undefined,
  activeConversationId: string | null | undefined,
): string {
  return selectionConversationId ?? activeConversationId ?? UNSCOPED_CONVERSATION;
}

/**
 * Does this selection belong to the conversation the user is looking at?
 *
 * A selection with no conversation is NOT assumed to belong to the active one.
 * Assuming it did is the permissive reading that produced the bug; an
 * unattributable Workbench is shown only in the unscoped bucket, where it cannot
 * be mistaken for a real chat's results.
 */
export function ownsSelection(
  selection: { conversationId?: string | null } | null | undefined,
  activeConversationId: string | null | undefined,
): boolean {
  if (!selection) return false;
  return conversationBucket(selection.conversationId, undefined)
    === conversationBucket(activeConversationId, undefined);
}

/**
 * Should this realtime event be applied to the Workbench on screen?
 *
 * A run that is still finishing keeps emitting updates for its plan after the
 * user has moved on. Applying one would repopulate a Workbench the user is no
 * longer looking at — the stale view, arriving a second time by a different
 * route.
 */
export function acceptRealtimeEvent(
  event: { plan_id?: string | null; task_id?: string | null } | null | undefined,
  owner: WorkbenchOwnership,
): boolean {
  if (!event) return false;
  if (!owner.planId) return false;
  if (event.plan_id != null && event.plan_id !== owner.planId) return false;
  // A task-scoped event for another task of the SAME plan is still this
  // Workbench's business; only a mismatched task id on a mismatched plan is not.
  if (event.plan_id == null && event.task_id != null && event.task_id !== owner.taskId) {
    return false;
  }
  return true;
}

/**
 * What the Workbench should render right now.
 *
 * `loading` is deliberately distinct from `empty`: showing the empty message
 * while the first query is still in flight reads as "this run found nothing",
 * which is a claim about the run rather than about the request.
 */
export type WorkbenchViewState = 'no_selection' | 'loading' | 'empty' | 'rows';

export function workbenchViewState(input: {
  hasSelection: boolean;
  loading: boolean;
  rowCount: number;
}): WorkbenchViewState {
  if (!input.hasSelection) return 'no_selection';
  if (input.rowCount > 0) return 'rows';
  return input.loading ? 'loading' : 'empty';
}
