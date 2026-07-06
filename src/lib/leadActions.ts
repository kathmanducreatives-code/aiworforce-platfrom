// Direct Workbench lead-action client. Invokes run-agent's additive
// `tool_input.lead_action` branch with the SELECTED lead candidate IDs — no
// natural-language chat text, no orchestrator round-trip. Evidence-first,
// approval-gated: the backend never sends anything.
import { supabase } from '@/integrations/supabase/client';
import {
  buildLeadActionRequest,
  type BuildLeadActionArgs,
} from './leadActionRequest';

export type { LeadActionKind } from './leadActionRequest';
export { LEAD_ACTION_LOADING } from './leadActionRequest';

export type RunLeadActionArgs = BuildLeadActionArgs;

export interface LeadActionResult {
  success: boolean;
  status?: string;
  summary?: string;
  per_lead?: Array<Record<string, unknown>>;
  error?: string;
}

const ERROR_COPY: Record<string, string> = {
  no_lead_selected: 'Select at least one lead first.',
  no_workspace: 'No active workspace — reload and try again.',
  no_plan: 'This result set has no plan to attach the action to.',
};

/**
 * Fire one Workbench lead action for the selected leads. Guards an empty
 * selection / missing workspace before calling run-agent, and always sends real
 * lead candidate IDs.
 */
export async function runLeadAction(args: RunLeadActionArgs): Promise<LeadActionResult> {
  const req = buildLeadActionRequest(args);
  if (!req.valid) {
    const code = (req as { error: string }).error;
    return { success: false, error: ERROR_COPY[code] ?? code };
  }

  const { data, error } = await supabase.functions.invoke('run-agent', { body: req.body });
  if (error) return { success: false, error: error.message ?? 'run_agent_failed' };

  const d = (data ?? {}) as Record<string, unknown>;
  return {
    success: (d.success as boolean) ?? true,
    status: d.status as string | undefined,
    summary: d.summary as string | undefined,
    per_lead: Array.isArray(d.per_lead) ? d.per_lead as Array<Record<string, unknown>> : undefined,
    error: d.error as string | undefined,
  };
}
