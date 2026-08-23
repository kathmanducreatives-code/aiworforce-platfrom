// Structured dispatcher for in-chat card actions.
//
// Every card action (Lead Source Selector, Lead Search Brief, Post-Lead Actions,
// Clarification, ui_actions buttons, error/retry cards…) MUST go through
// `dispatchChatAction` so the originating conversation_id travels with the
// action. ChatComposerPro listens for `chat:send` events and uses the
// supplied conversation_id verbatim — never falling back to the active view
// — so card actions can never spawn a new conversation.

export type ChatActionSource =
  | 'lead_source_card'
  | 'lead_intake_card'
  | 'lead_source_brief'
  | 'post_lead_actions_card'
  | 'lead_results_panel'
  | 'lead_table_action'
  | 'lead_sourcing_error_card'
  | 'clarification_card'
  | 'ui_actions_button'
  | 'signal_feed_action'
  | 'scout_results_action'
  | 'no_results_card'
  | 'recommended_move'
  | 'broaden_search'
  | 'workforce_brief'
  | 'first_run_helper'
  | 'workflow_center'
  | 'onboarding_first_run';

export type LeadResultPanelAction =
  | 'enrich'
  | 'draft_outreach'
  | 'enrich_and_draft'
  | 'rank'
  | 'export_csv'
  | 'save_to_signal_feed'
  | 'find_contacts'
  /**
   * Buy a business email for a person `find_contacts` already resolved.
   *
   * Deliberately a SEPARATE action, not a mode of `find_contacts`. Finding
   * somebody and buying a way to reach them are different Actors at different
   * prices, and running an email lookup as a side effect of a search would
   * spend on everyone returned rather than on the one person a user chose.
   */
  | 'find_contact_details'
  | 'research_company';

export interface ChatActionDetail {
  text: string;
  /** Conversation that rendered the card. null only for explicit "new chat" entry points. */
  conversation_id: string | null;
  action_source?: ChatActionSource;
  metadata?: Record<string, unknown>;
}

export function dispatchChatAction(detail: ChatActionDetail) {
  if (detail.action_source && !detail.conversation_id) {
    // eslint-disable-next-line no-console
    console.warn('[chat-action] missing conversation_id for card action', detail);
  }
  window.dispatchEvent(new CustomEvent<ChatActionDetail>('chat:send', { detail }));
}

/** Plain freeform send from empty-state suggestions / dashboard widgets. */
export function dispatchFreeformSend(text: string) {
  window.dispatchEvent(
    new CustomEvent<ChatActionDetail>('chat:send', {
      detail: { text, conversation_id: null },
    }),
  );
}

const ACTION_COMMAND: Record<LeadResultPanelAction, (n: number) => string> = {
  enrich: (n) => `Enrich the top ${n} leads.`,
  draft_outreach: (n) => `Draft outreach to the top ${n}.`,
  enrich_and_draft: (n) => `Enrich the top ${n} leads and then draft outreach to them.`,
  rank: () => `Rank these leads by fit.`,
  export_csv: () => `Export these leads as CSV.`,
  save_to_signal_feed: () => `Save these leads to the Signal Feed for later review.`,
  find_contacts: (n) => `Find decision-makers for the selected ${n} ${n === 1 ? 'account' : 'accounts'}.`,
  research_company: (n) => `Research company context for the selected ${n} ${n === 1 ? 'account' : 'accounts'} using Hawk + Firecrawl.`,
};

export interface ResultActionDetail {
  conversationId: string | null;
  planId: string;
  leadCandidateIds: string[];
  action: LeadResultPanelAction;
  estimatedCredits?: number;
  savedOutputId?: string | null;
  confirmed?: boolean;
}

export function dispatchResultAction(detail: ResultActionDetail) {
  const n = Math.max(1, detail.leadCandidateIds.length || 5);
  const text = ACTION_COMMAND[detail.action](n);
  dispatchChatAction({
    text,
    conversation_id: detail.conversationId,
    action_source: 'lead_table_action',
    metadata: {
      intent: 'lead_table_action',
      action: detail.action,
      lead_candidate_ids: detail.leadCandidateIds,
      plan_id: detail.planId,
      saved_output_id: detail.savedOutputId ?? null,
      estimated_credits: detail.estimatedCredits ?? 0,
      confirmed: detail.confirmed ?? false,
    },
  });
}

// ---- Next-action pills (complete / partial / failed) ----
// Backend emits metadata.next_actions (action ids) + metadata.source_brief.
export type NextActionId =
  | 'broaden_search' | 'use_results' | 'edit_criteria' | 'change_source'
  | 'view_details' | 'done' | LeadResultPanelAction;

export const NEXT_ACTION_LABEL: Record<NextActionId, string> = {
  broaden_search: 'Broaden search',
  use_results: 'Use these results',
  edit_criteria: 'Edit criteria',
  change_source: 'Change source',
  view_details: 'View details',
  done: 'Done',
  enrich: 'Enrich',
  draft_outreach: 'Draft outreach',
  enrich_and_draft: 'Enrich + draft',
  rank: 'Rank',
  export_csv: 'Export CSV',
  save_to_signal_feed: 'Save to Signal Feed',
  find_contacts: 'Find decision-makers',
  research_company: 'Research company',
};

// Actions that send a chat command. view_details/use_results/done are UI-local
// (open Workbench / dismiss) and handled by the rendering component.
const NEXT_ACTION_COMMAND: Partial<Record<NextActionId, (brief: string) => string>> = {
  broaden_search: (brief) => brief
    ? `Broaden the search and try again to fill the remaining results: ${brief}`
    : 'Broaden the search and try again.',
  edit_criteria: () => 'Find me leads.',      // re-opens the Lead Source Selector
  change_source: () => 'Find me leads.',      // re-opens the Lead Source Selector
  rank: () => 'Rank these leads by fit.',
  export_csv: () => 'Export these leads as CSV.',
  find_contacts: () => 'Find decision-makers for these accounts.',
  draft_outreach: () => 'Draft outreach to the top 5.',
};

/** True when the action sends a chat command (vs. a UI-local action). */
export function isSendNextAction(action: NextActionId): boolean {
  return action in NEXT_ACTION_COMMAND;
}

/** Dispatch a next-action pill. Returns false for UI-local actions the caller must handle. */
export function dispatchNextAction(
  action: NextActionId,
  ctx: { conversationId: string | null; sourceBrief?: string | null; planId?: string | null },
): boolean {
  const cmd = NEXT_ACTION_COMMAND[action];
  if (!cmd) return false; // view_details / use_results / done → handled locally
  dispatchChatAction({
    text: cmd(ctx.sourceBrief ?? ''),
    conversation_id: ctx.conversationId,
    action_source: action === 'broaden_search' ? 'broaden_search' : 'recommended_move',
    metadata: { intent: action, plan_id: ctx.planId ?? null, source_brief: ctx.sourceBrief ?? null },
  });
  return true;
}

/** Command map from nextStepEngine action_ids to chat commands. */
const NEXT_STEP_COMMANDS: Record<string, string> = {
  find_hiring_signal_accounts: 'Find hiring-signal accounts.',
  find_decision_makers: 'Find decision-makers for these accounts.',
  enrich_companies: 'Enrich companies.',
  draft_outreach: 'Draft outreach to the top accounts.',
  export_csv: 'Export these leads as CSV.',
  linkedin_post_from_signals: 'Create a LinkedIn post from recent signals.',
  website_audit: 'Audit a target website.',
  competitor_snapshot: 'Snapshot a competitor.',
  broaden_search: 'Broaden the search.',
};

/** Dispatch a recommended next-step from the SummaryView card. */
export function dispatchNextStepAction(args: {
  action_id: string;
  label: string;
  conversation_id: string | null;
}): void {
  const cmd = NEXT_STEP_COMMANDS[args.action_id] ?? `Run: ${args.label}`;
  dispatchChatAction({
    text: cmd,
    conversation_id: args.conversation_id,
    action_source: args.action_id === 'broaden_search' ? 'broaden_search' : 'recommended_move',
    metadata: {
      confirmed: true,
      intent: args.action_id,
    },
  });
}
