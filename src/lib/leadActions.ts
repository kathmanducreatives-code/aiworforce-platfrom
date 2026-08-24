// Direct Workbench lead-action client. Invokes `run-lead-action`s
// `tool_input.lead_action` branch with the SELECTED lead candidate IDs — no
// natural-language chat text, no orchestrator round-trip. Evidence-first,
// approval-gated: the backend never sends anything.
import { supabase } from '@/integrations/supabase/client';
import {
  buildLeadActionRequest,
  type BuildLeadActionArgs,
} from './leadActionRequest';
import {
  ERROR_COPY,
  PRE_EXECUTION_CODES,
  extractFunctionError,
  type DirectActionSummary,
  type LeadOutcomeStatus,
} from './leadActionOutcome';

export type { LeadActionKind } from './leadActionRequest';
export { LEAD_ACTION_LOADING } from './leadActionRequest';

export type RunLeadActionArgs = BuildLeadActionArgs;

export interface LeadActionResult {
  success: boolean;
  status?: string;
  summary?: DirectActionSummary;
  summary_text?: string;
  per_lead?: Array<Record<string, unknown>>;
  /** Sanitized machine-readable code — never a raw provider/database message. */
  error?: string;
  /** Human-facing copy for the row/banner. */
  message?: string;
  /** HTTP status when the failure came back from the edge function. */
  httpStatus?: number;
  /**
   * True when the request was rejected BEFORE any lead was processed. These are
   * request-contract/auth failures, not business outcomes, and must never be
   * rendered as "0 succeeded".
   */
  requestError?: boolean;
}

/**
 * Fire one Workbench lead action for the selected leads. Guards an empty
 * selection / missing workspace before calling the function, and always sends real
 * lead candidate IDs.
 */
export async function runLeadAction(args: RunLeadActionArgs): Promise<LeadActionResult> {
  const req = buildLeadActionRequest(args);
  if (req.valid === false) {
    const code = req.error;
    return { success: false, error: code, message: ERROR_COPY[code] ?? code, requestError: true };
  }

  // ── `run-lead-action`, NOT `run-agent` ────────────────────────────────
  //
  // The lead-action path was extracted into its own edge function: `run-agent`
  // reached 5.33 MB against a 5 MB platform limit and could not deploy at all.
  // The two workloads share no modules — `leadActionExecutor` pulls 24 that the
  // sourcing engine never touches — so they were two entry points sharing one
  // deployment unit for no reason.
  //
  // The request body and the response shape are UNCHANGED; only the URL moved.
  // `run-agent` still recognises a lead action and refuses it explicitly with
  // `lead_action_endpoint_moved`, so a stale client fails loudly rather than
  // falling through to the orchestrated path and reporting a contract error.
  const { data, error } = await supabase.functions.invoke('run-lead-action', { body: req.body });

  if (error) {
    const { code, message, httpStatus } = await extractFunctionError(error);
    return {
      success: false,
      error: code,
      message: message ?? ERROR_COPY[code] ?? 'The action could not be started.',
      httpStatus,
      // A non-2xx with no per-lead detail means execution never began.
      requestError: PRE_EXECUTION_CODES.has(code),
    };
  }

  const d = (data ?? {}) as Record<string, unknown>;
  return {
    success: (d.success as boolean) ?? true,
    status: d.status as string | undefined,
    summary: d.summary as DirectActionSummary | undefined,
    summary_text: d.summary_text as string | undefined,
    per_lead: Array.isArray(d.per_lead) ? (d.per_lead as Array<Record<string, unknown>>) : undefined,
    error: d.error as string | undefined,
  };
}

export type { DirectActionSummary, LeadOutcomeStatus };
