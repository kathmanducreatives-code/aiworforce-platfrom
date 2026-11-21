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

// ── R1.2.1 · WHAT HAPPENED AFTER START — ALSO READ FROM THE CONVERSATION ──────
//
// The card said "Started Find 20 companies in saas" although the backend had
// answered the Start with `delegation_disabled` ("…isn't switched on in this
// release yet… Nothing was started and nothing was charged."), production smoke
// test 2026-11-21. A Start is not a start: the reply to it decides.

export type StartOutcome = 'pending' | 'started' | 'refused';

const REFUSAL_TYPES = new Set(['delegation_disabled']);

/**
 * For every started card: the outcome of its Start, from the first assistant
 * reply after the Start message. `refused` when that reply is a refusal
 * (delegation disabled); `pending` while no reply has arrived yet; otherwise
 * `started`.
 */
export function cardStartOutcomes(messages: readonly MessageLike[]): Map<string, StartOutcome> {
  const out = new Map<string, StartOutcome>();
  let lastCard: string | null = null;
  let awaiting: string | null = null; // card whose Start has not been answered yet
  for (const m of messages) {
    if (isCard(m)) { lastCard = m.id; continue; }
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    if (m.role === 'user' && meta.confirmed === true) {
      const named = typeof meta.confirmation_message_id === 'string' ? meta.confirmation_message_id : null;
      const card = named ?? (lastCard && meta.action_source === 'lead_intake_card' ? lastCard : null);
      if (card) { out.set(card, 'pending'); awaiting = card; }
      continue;
    }
    if (m.role === 'assistant' && awaiting) {
      out.set(awaiting, REFUSAL_TYPES.has(String(meta.type ?? '')) ? 'refused' : 'started');
      awaiting = null;
    }
  }
  return out;
}

/** The card's status line after Start. Never "Started" for a refused Start. */
export function startLabel(workflowName: string, outcome: StartOutcome | undefined, submitted: boolean): string {
  if (outcome === 'refused') return startNotStartedLabel(workflowName);
  if (outcome === 'started') return `Started ${workflowName}`;
  // No reply yet (just pressed, or the reply is still on its way).
  if (submitted || outcome === 'pending') return `Starting ${workflowName}…`;
  return `Started ${workflowName}`;
}

/** Shown when the backend refused to run the workflow (agent execution disabled). */
export function startNotStartedLabel(workflowName: string): string {
  return `Not started: ${workflowName}. Agent work isn't switched on in this release. Nothing was run or charged.`;
}
