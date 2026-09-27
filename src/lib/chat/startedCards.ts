// WHICH WORKFLOW CARDS HAVE ALREADY BEEN STARTED — READ FROM THE CONVERSATION.
//
// `WorkflowConfirmationCard` used to know only what its own `useState` knew:
// press Start, the card shows "Starting…"; remount it (close and reopen the
// chat, reload, switch threads) and the same card offered Start again, with
// nothing between that button and a second paid mission. Conversation
// 38e904cb, 2026-09-27, received one card's Start twice, 8.4 s apart.
//
// The conversation already records the answer: a Start is a user message
// carrying the card's approval. So "started" is derived from the messages, and
// survives every remount because it was never component state.
//
// Pure: no React, no `@/` imports — unit-testable under Deno.

export interface MessageLike {
  id: string;
  role: string;
  metadata?: Record<string, unknown> | null;
}

const isCard = (m: MessageLike) =>
  m.role === 'assistant' && (m.metadata as { type?: unknown } | null)?.type === 'workflow_confirmation';

/**
 * Ids of the workflow cards in `messages` (chronological) that a Start has
 * already approved.
 *
 * A Start names its card by `confirmation_message_id`. A Start sent before
 * that field existed names nothing, so it is attributed to the nearest card
 * above it — the only card it could have come from, since a new card is
 * rendered for every new request. It never reaches past a later card.
 */
export function startedCardIds(messages: readonly MessageLike[]): Set<string> {
  const started = new Set<string>();
  let lastCard: string | null = null;
  for (const m of messages) {
    if (isCard(m)) { lastCard = m.id; continue; }
    if (m.role !== 'user') continue;
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    if (meta.confirmed !== true) continue;
    const named = typeof meta.confirmation_message_id === 'string' ? meta.confirmation_message_id : null;
    if (named) started.add(named);
    else if (lastCard && meta.action_source === 'lead_intake_card') started.add(lastCard);
  }
  return started;
}
