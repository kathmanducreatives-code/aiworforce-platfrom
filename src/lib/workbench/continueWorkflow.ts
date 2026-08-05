// "CONTINUE VERIFICATION" — as the signed-in user, with no secrets in the browser.
//
// The Workbench for TEST task 41342269 was empty because the run stopped after
// discovery. Its paid dataset — 50 companies, 177 embedded roles — is still
// there. Continuing costs nothing to re-discover, and the browser needs no
// privileged key to ask for it: `supabase.functions.invoke` attaches the user's
// own session token, and the backend checks workspace membership exactly as
// every other path does.
//
// PURE decision logic here; the network call is one thin wrapper at the bottom.

import { supabase } from '@/integrations/supabase/client';
import { describeContinuationError, readErrorBody } from './continuationErrors';

export const CONTINUATION_REASON = 'resume_from_existing_company_dataset' as const;

export interface ContinuationEligibilityInput {
  /** Derived workflow state, e.g. from `deriveWorkflowUiState`. */
  workflowState: string | null;
  /** Does the original run have a stored company dataset to reuse? */
  hasStoredCompanyRun: boolean;
  /** Is a continuation already created or running for this workflow? */
  continuationActive: boolean;
  /** Is the viewer a member of the workspace? */
  hasWorkspaceAccess: boolean;
  taskId: string | null;
  planId: string | null;
  conversationId: string | null;
}

/** States where continuing is meaningful: the run stopped, owing results. */
const CONTINUABLE_STATES: ReadonlySet<string> = new Set(['partial', 'failed', 'stale']);

/**
 * Should "Continue verification" be offered?
 *
 * Deliberately conservative. Offering it on a still-running workflow invites a
 * second set of paid identity searches against a dataset already being
 * processed, and offering it with no stored run would just re-run discovery —
 * the exact double-charge this feature exists to avoid.
 */
export function canContinueWorkflow(i: ContinuationEligibilityInput): boolean {
  if (!i.hasWorkspaceAccess) return false;
  if (!i.taskId || !i.planId || !i.conversationId) return false;
  if (!i.hasStoredCompanyRun) return false;
  if (i.continuationActive) return false;
  return CONTINUABLE_STATES.has(String(i.workflowState ?? ''));
}

/** Does this task's stored result describe a reusable company dataset? */
export function hasStoredCompanyRun(taskResult: unknown): boolean {
  if (!taskResult || typeof taskResult !== 'object') return false;
  const r = taskResult as Record<string, unknown>;
  const state = r.capability_execution_state as
    { provider_attempts?: Array<{ provider?: string; outcome?: string; rows?: number }> } | undefined;
  const attempts = state?.provider_attempts ?? [];
  return attempts.some((a) =>
    typeof a?.provider === 'string' &&
    a.provider.startsWith('apify_yc_companies_') &&
    a.outcome === 'ok' &&
    Number(a.rows ?? 0) > 0);
}

export interface ContinuationResult {
  ok: boolean;
  created?: boolean;
  plan_id?: string | null;
  task_id?: string | null;
  conversation_id?: string | null;
  error?: string;
  message?: string;
  status?: number | null;
  request_id?: string | null;
}

/**
 * Ask the backend to continue this workflow.
 *
 * `functions.invoke` attaches the CURRENT USER'S access token. No service key is
 * present in the bundle, and the endpoint refuses one on principle. The request
 * carries three ids and a reason — never a workspace, run, dataset or capability
 * state, all of which the backend derives from records the caller owns.
 */
export async function continueWorkflow(input: {
  originalTaskId: string;
  originalPlanId: string;
  conversationId: string;
}): Promise<ContinuationResult> {
  const { data, error } = await supabase.functions.invoke('continue-workflow', {
    body: {
      original_task_id: input.originalTaskId,
      original_plan_id: input.originalPlanId,
      conversation_id: input.conversationId,
      continuation_reason: CONTINUATION_REASON,
    },
  });
  if (error) {
    // `invoke` sets `data` to null and never reads the body on a non-2xx, so the
    // real reason has to be recovered from the Response it attaches.
    const detail = await readErrorBody(error);
    return {
      ok: false,
      status: detail.status,
      error: detail.code ?? 'continuation_failed',
      message: describeContinuationError(detail.status, detail.code, detail.message),
      request_id: detail.requestId,
    };
  }
  const d = (data ?? {}) as ContinuationResult;
  return { ...d, ok: d.ok !== false };
}
