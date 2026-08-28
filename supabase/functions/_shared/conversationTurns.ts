// THE PRIOR TURNS, AS CHAT BRAIN AND THE CONVERSE SURFACE SEE THEM.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
//
// `ChatBrainContext.conversation` was declared, documented and rendered into
// the prompt — and no production caller ever passed it. So every message
// reached the model as if it were the first one in the conversation, and the
// prompt's own rule ("a message with no earlier turn to point back to cannot
// contain a prior_result") made a back-reference literally unrepresentable.
//
// That silently disabled the whole of Phase E. The referents were persisted
// correctly, the lookup worked, the resolver was tested — but the gate in front
// of all of it is `requestHasBackReference`, which asks whether Chat Brain
// emitted a `prior_result` reference. It never could. Live, on 2026-08-28:
// "What leads do I currently have?" answered with 32 named leads, and "Which of
// those look strongest?" one turn later logged `bound_referents: 0`, routed to
// `converse`, and said the workspace was empty.
//
// ── WHAT IT MAY AND MAY NOT CARRY ──────────────────────────────────────────
//
// Text only, and only the two roles a person would see. Metadata stays out on
// purpose: the bindings are resolved from `presented_referents` by
// `resolveReferents`, deterministically, against rows this system wrote. The
// model is told THAT a list was shown so it can say the request points back at
// one; it is never the thing that decides WHICH row that is.

/** Turns are truncated so one long preview cannot crowd out the rest. */
export const TURN_MAX_CHARS = 1200;

/** How many prior messages are read. Chat Brain itself keeps the last six. */
export const TURN_LOOKBACK = 8;

export interface ConversationTurnRow {
  role?: string | null;
  content?: string | null;
}

export interface BrainTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Newest-first database rows into oldest-first turns.
 *
 * The order matters more than it looks: "the second company" is resolved by
 * position against the most recent result message, and a reversed transcript
 * would put the oldest list last and make "those" point at the wrong turn.
 */
export function toBrainTurns(
  rows: ConversationTurnRow[] | null | undefined,
  opts: { maxChars?: number } = {},
): BrainTurn[] {
  const maxChars = opts.maxChars ?? TURN_MAX_CHARS;
  const out: BrainTurn[] = [];
  for (const row of rows ?? []) {
    const role = row?.role;
    if (role !== "user" && role !== "assistant") continue;
    const content = typeof row?.content === "string" ? row.content.trim() : "";
    if (!content) continue;
    out.push({
      role,
      content: content.length > maxChars
        ? `${content.slice(0, maxChars)}…`
        : content,
    });
  }
  return out.reverse();
}
