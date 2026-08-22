// Frontend view of the direct-action outcome vocabulary. Pure — no React, no
// `@/` imports — so it is unit-testable alongside the other src/lib models.
//
// Classification happens ONCE on the backend (_shared/leadActionOutcome.ts) and
// arrives on each per_lead row. This module only maps those canonical statuses to
// copy and counts; it deliberately does NOT re-derive status from provider-shaped
// fields, which is how the UI previously reported a pre-execution rejection as
// "0/4 succeeded".

export type LeadOutcomeStatus =
  | 'succeeded'
  | 'no_match'
  | 'unavailable'
  | 'missing_company_identity'
  | 'needs_manual_review'
  | 'timed_out'
  | 'blocked'
  | 'failed';

/** `request_error` is frontend-only: the request never reached execution. */
export type RowDisplayStatus = LeadOutcomeStatus | 'request_error' | 'running';

export type DirectActionSummary = Record<LeadOutcomeStatus | 'requested', number>;

export const LEAD_OUTCOME_STATUSES: readonly LeadOutcomeStatus[] = [
  'succeeded',
  'no_match',
  'unavailable',
  'missing_company_identity',
  'needs_manual_review',
  'timed_out',
  'blocked',
  'failed',
] as const;

/**
 * Row copy. Every state reads as a distinct, truthful outcome — "no verified
 * founder found" is a real answer, not a crash, and must not look like one.
 */
export const ROW_STATUS_COPY: Record<RowDisplayStatus, string> = {
  running: 'Running…',
  request_error: 'Action request was rejected before execution',
  succeeded: 'Verified decision-makers found',
  no_match: 'No verified founder or GTM leader found',
  unavailable: 'People search is disabled in this environment',
  missing_company_identity: 'Verify the company domain or LinkedIn page first',
  needs_manual_review: 'Profiles were found but current employment could not be verified',
  timed_out: 'Decision-maker search timed out',
  blocked: 'Complete the required previous step first',
  failed: 'Provider or persistence failed',
};

/** Short labels for the batch banner. */
export const SUMMARY_LABEL: Record<LeadOutcomeStatus | 'request_error', string> = {
  succeeded: 'succeeded',
  no_match: 'no match',
  unavailable: 'unavailable',
  missing_company_identity: 'missing identity',
  needs_manual_review: 'manual review',
  timed_out: 'timed out',
  blocked: 'blocked',
  failed: 'failed',
  request_error: 'request errors',
};

/** Only these are worth a one-click retry; the rest need a human or a setting. */
const RETRYABLE: ReadonlySet<RowDisplayStatus> = new Set<RowDisplayStatus>([
  'timed_out',
  'failed',
  'request_error',
]);

export function isRetryableStatus(status: RowDisplayStatus): boolean {
  return RETRYABLE.has(status);
}

export function emptyDirectActionSummary(requested = 0): DirectActionSummary {
  return {
    requested,
    succeeded: 0,
    no_match: 0,
    unavailable: 0,
    missing_company_identity: 0,
    needs_manual_review: 0,
    timed_out: 0,
    blocked: 0,
    failed: 0,
  };
}

export interface BatchTally extends DirectActionSummary {
  request_error: number;
}

export function emptyBatchTally(requested = 0): BatchTally {
  return { ...emptyDirectActionSummary(requested), request_error: 0 };
}

/**
 * Render the batch banner as CATEGORY COUNTS rather than a single
 * "N/M succeeded". A batch of four pre-execution rejections must read
 * "4 request errors" — reporting it as "0/4 succeeded" implies four leads were
 * examined and found wanting, which is false.
 */
export const ERROR_COPY: Record<string, string> = {
  no_lead_selected: 'Select at least one lead first.',
  no_workspace: 'No active workspace — reload and try again.',
  unsupported_lead_action: "That action isn't supported.",
  invalid_workspace_id: 'No active workspace — reload and try again.',
  lead_action_requires_lead_candidate_ids: 'Select one or more Workbench rows first.',
  invalid_lead_candidate_id: 'One or more selected rows are invalid — refresh the Workbench.',
  lead_not_in_workspace: "Those rows aren't in this workspace.",
  unidentified_user: 'Sign in again to run this action.',
  task_insert_failed: "Couldn't start the action — try again.",
  lead_ownership_check_failed: 'Could not verify the selected rows.',
  lead_action_failed: 'The action failed partway through — retry the affected rows.',
  run_agent_failed: 'The action could not be started.',
  // ── REFUSED BEFORE ANYTHING RAN ──────────────────────────────────────────
  //
  // The reserve declined, so no provider was called and nothing was charged.
  // Said in those words on purpose: a user who sees a failed action needs to
  // know whether it cost them anything, and this one did not.
  credit_authorization_refused:
    'Not enough credits for that. Nothing was run and nothing was charged.',
};

/** The refusal that leaves a cell locked. Mirrors CREDIT_REFUSED_ERROR. */
export const CREDIT_REFUSED_ERROR = 'credit_authorization_refused' as const;

/**
 * True when the action was refused before any provider ran.
 *
 * The cell must go back to its offer state, NOT to "failed" — nothing was
 * attempted, so "Try again" would be wrong about what happened and would hide
 * the one fact the user can act on: the balance.
 */
export function isCreditRefusal(code: string | null | undefined): boolean {
  return code === CREDIT_REFUSED_ERROR;
}

/** Codes that mean nothing was executed, so the batch reports a request error. */
export const PRE_EXECUTION_CODES: ReadonlySet<string> = new Set([
  'unsupported_lead_action',
  'invalid_workspace_id',
  'lead_action_requires_lead_candidate_ids',
  'invalid_lead_candidate_id',
  'lead_not_in_workspace',
  'unidentified_user',
  'task_insert_failed',
  'lead_ownership_check_failed',
  'missing_required_fields',
  'unauthorized',
  'forbidden',
  'run_agent_failed',
]);

/**
 * Pull a SANITIZED error out of a supabase FunctionsHttpError. The SDK's
 * `error.message` is the useless "Edge Function returned a non-2xx status code"
 * that hid a real 500 in production, so read the response body for the structured
 * `error`/`message` the function actually returned.
 *
 * Deliberately reads ONLY those two fields: never headers, never a stack, never
 * `details` (which carries raw database/provider text).
 */
export async function extractFunctionError(
  error: unknown,
): Promise<{ code: string; message?: string; httpStatus?: number }> {
  const ctx = (error as { context?: unknown } | null)?.context;
  const res = ctx instanceof Response ? ctx : undefined;
  const httpStatus = res?.status;

  if (res) {
    try {
      // clone() so a caller that also reads the body isn't left with a used stream.
      const body = await res.clone().json();
      const code = typeof body?.error === 'string' ? body.error : undefined;
      const message = typeof body?.message === 'string' ? body.message : undefined;
      if (code) return { code, message: message ?? ERROR_COPY[code], httpStatus };
    } catch {
      // Non-JSON body — fall through to a generic code rather than leaking text.
    }
  }

  return { code: 'run_agent_failed', message: ERROR_COPY.run_agent_failed, httpStatus };
}

export function formatBatchSummary(tally: BatchTally): string {
  const parts: string[] = [];
  const order: Array<LeadOutcomeStatus | 'request_error'> = [
    'succeeded',
    'no_match',
    'unavailable',
    'missing_company_identity',
    'needs_manual_review',
    'timed_out',
    'blocked',
    'request_error',
    'failed',
  ];
  for (const key of order) {
    const n = tally[key];
    if (n > 0) parts.push(`${n} ${SUMMARY_LABEL[key]}`);
  }
  if (parts.length === 0) return 'No rows processed.';
  return `${parts.join(' · ')} — see each row. Nothing sent.`;
}
