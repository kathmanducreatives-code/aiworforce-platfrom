// Pure request-builder + guards for Workbench lead actions. No supabase / DOM
// imports, so it is unit-testable under Deno like the other src/lib model tests.
// leadActions.ts wraps this with the actual run-agent invoke.

export type LeadActionKind = 'research_company' | 'find_decision_makers' | 'generate_outreach';

// research/decision-maker → Hawk; outreach drafting → Penn. The lead_action
// branch runs regardless of agent; we pick the semantically-correct one so the
// task/activity rows read correctly.
export const AGENT_FOR: Record<LeadActionKind, string> = {
  research_company: 'hawk',
  find_decision_makers: 'hawk',
  generate_outreach: 'penn',
};

export const INSTRUCTION_FOR: Record<LeadActionKind, string> = {
  research_company: 'Research company context for the selected lead(s).',
  find_decision_makers: 'Find decision-makers for the selected lead(s).',
  generate_outreach: 'Prepare an approval-ready outreach draft for the selected lead(s).',
};

/** Human loading label per action (Part C copy). */
export const LEAD_ACTION_LOADING: Record<LeadActionKind, string> = {
  research_company: 'Researching company…',
  find_decision_makers: 'Finding decision-makers…',
  generate_outreach: 'Preparing draft…',
};

export interface BuildLeadActionArgs {
  leadAction: LeadActionKind;
  leadCandidateIds: string[];
  workspaceId: string | null;
  planId: string;
  stepIndex?: number;
}

export interface LeadActionRequestBody {
  plan_id: string;
  step_index: number;
  agent_slug: string;
  workspace_id: string;
  instruction: string;
  tool_input: { lead_action: LeadActionKind; lead_candidate_ids: string[] };
}

export type BuildLeadActionResult =
  | { valid: true; body: LeadActionRequestBody }
  | { valid: false; error: 'no_lead_selected' | 'no_workspace' | 'no_plan' };

/**
 * Build the run-agent request body from a selection. Sends the real selected lead
 * candidate IDs (deduped) — never company names, never a multi-company query (the
 * backend loops one company at a time). Returns a typed error when the selection,
 * workspace, or plan is missing so the caller can show a clear message and do
 * nothing.
 */
export function buildLeadActionRequest(args: BuildLeadActionArgs): BuildLeadActionResult {
  const ids = Array.from(new Set((args.leadCandidateIds ?? []).filter((x) => typeof x === 'string' && x)));
  if (ids.length === 0) return { valid: false, error: 'no_lead_selected' };
  if (!args.workspaceId) return { valid: false, error: 'no_workspace' };
  if (!args.planId) return { valid: false, error: 'no_plan' };
  return {
    valid: true,
    body: {
      plan_id: args.planId,
      step_index: args.stepIndex ?? 0,
      agent_slug: AGENT_FOR[args.leadAction],
      workspace_id: args.workspaceId,
      instruction: INSTRUCTION_FOR[args.leadAction],
      tool_input: { lead_action: args.leadAction, lead_candidate_ids: ids },
    },
  };
}
