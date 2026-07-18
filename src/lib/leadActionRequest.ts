// Pure request-builder + guards for Workbench lead actions. No supabase / DOM
// imports, so it is unit-testable under Deno like the other src/lib model tests.
// leadActions.ts wraps this with the actual run-agent invoke.

export type LeadActionKind = 'research_company' | 'find_decision_makers' | 'generate_outreach';

// Maps a Workbench panel action → the structured lead_action kind. The three
// lead actions (+ the `enrich` synonym) ALWAYS run on existing selected rows via
// run-agent's lead_action branch — never through chat planning (which would
// start a fresh Scout/Aria sourcing workflow). Other actions (rank / export /
// save_to_signal_feed / enrich_and_draft) return null and keep their own path.
export function workbenchActionToLeadKind(action: string): LeadActionKind | null {
  switch (action) {
    case 'research_company':
    case 'enrich':
      return 'research_company';
    case 'find_contacts':
      return 'find_decision_makers';
    case 'draft_outreach':
      return 'generate_outreach';
    default:
      return null;
  }
}

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
  /**
   * The REAL sourcing plan these rows came from, when there is one. Optional and
   * purely for trace linkage — run-agent no longer requires it for a direct
   * action, and we never invent one to satisfy validation.
   */
  planId?: string | null;
}

/**
 * Canonical direct-action request. Deliberately carries NO step_index, agent_slug
 * or instruction: those are orchestration metadata the Workbench has no basis to
 * invent, and the backend derives the agent + instruction itself so browser-
 * supplied free text can never reach an agent prompt.
 */
export interface LeadActionRequestBody {
  workspace_id: string;
  plan_id?: string;
  tool_input: { lead_action: LeadActionKind; lead_candidate_ids: string[] };
}

export type BuildLeadActionResult =
  | { valid: true; body: LeadActionRequestBody }
  | { valid: false; error: 'no_lead_selected' | 'no_workspace' };

/**
 * Build the run-agent request body from a selection. Sends the real selected lead
 * candidate IDs (deduped) — never company names, never a multi-company query (the
 * backend loops one company at a time). Returns a typed error when the selection
 * or workspace is missing so the caller can show a clear message and do nothing.
 */
export function buildLeadActionRequest(args: BuildLeadActionArgs): BuildLeadActionResult {
  const ids = Array.from(new Set((args.leadCandidateIds ?? []).filter((x) => typeof x === 'string' && x)));
  if (ids.length === 0) return { valid: false, error: 'no_lead_selected' };
  if (!args.workspaceId) return { valid: false, error: 'no_workspace' };

  const body: LeadActionRequestBody = {
    workspace_id: args.workspaceId,
    tool_input: { lead_action: args.leadAction, lead_candidate_ids: ids },
  };
  if (args.planId) body.plan_id = args.planId;
  return { valid: true, body };
}
