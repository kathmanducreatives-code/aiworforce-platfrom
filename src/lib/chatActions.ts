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
  | 'post_lead_actions_card'
  | 'lead_results_panel'
  | 'lead_sourcing_error_card'
  | 'clarification_card'
  | 'ui_actions_button'
  | 'signal_feed_action'
  | 'scout_results_action'
  | 'no_results_card'
  | 'recommended_move'
  | 'workforce_brief';

export type LeadResultPanelAction =
  | 'enrich'
  | 'draft_outreach'
  | 'enrich_and_draft'
  | 'rank'
  | 'export_csv'
  | 'save_to_signal_feed'
  | 'find_contacts'
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
    // This indicates a wiring bug — a card was rendered without a conversation_id.
    // The composer will surface a user-facing error and refuse to send.
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
  find_contacts: () => `Find decision-makers at these companies.`,
  research_company: () => `Research these companies (analyze their websites for context).`,
};

export interface ResultActionDetail {
  conversationId: string | null;
  planId: string;
  leadCandidateIds: string[];
  action: LeadResultPanelAction;
  estimatedCredits?: number;
  savedOutputId?: string | null;
}

export function dispatchResultAction(detail: ResultActionDetail) {
  const n = Math.max(1, detail.leadCandidateIds.length || 5);
  const text = ACTION_COMMAND[detail.action](n);
  dispatchChatAction({
    text,
    conversation_id: detail.conversationId,
    action_source: 'lead_results_panel',
    metadata: {
      intent: 'lead_result_action',
      action: detail.action,
      lead_candidate_ids: detail.leadCandidateIds,
      plan_id: detail.planId,
      saved_output_id: detail.savedOutputId ?? null,
      estimated_credits: detail.estimatedCredits ?? 0,
    },
  });
}
