// WHAT A SURFACE MAY STATE, AND WHERE EACH PIECE OF IT CAME FROM.
//
// ── THE FAILURE THIS EXISTS TO END ─────────────────────────────────────────
//
// The conversational surface was handed three counters — leads, drafts,
// onboarding — under a heading that read `workspace_facts`. Two of the three
// counted what THIS CONVERSATION had produced. One turn after the read surface
// truthfully reported 32 saved leads, converse said:
//
//   "I don't have any leads or prospects in the workspace yet. We're starting
//    from zero."
//
// Every number in that block was correct. The scope was invented, because
// nothing in the block carried a scope for the model to respect. The fix is
// not a better sentence in the prompt — it is that a fact travels with the
// question it answers, so a conversation count can never be read as a census.
//
// ── WHY THIS IS SHARED AND NOT PER-SURFACE ─────────────────────────────────
//
// Every surface was assembling its own context from whatever it happened to
// have in scope, which is why the same class of error kept reappearing in a
// different place: the read surface counted a page as a total, the renderer
// promised an expansion it could not perform, converse reported a conversation
// as a workspace. One shape, with provenance, is the smallest thing that stops
// all three from recurring — and it is deliberately not a context ENGINE. It
// holds facts a caller already has; it queries nothing and decides nothing.

/** Where a fact is true. The distinction the failure above turned on. */
export type FactScope =
  /** Durable, workspace-wide. The user's actual data. */
  | "workspace"
  /** Produced by this conversation. Says nothing about the workspace. */
  | "conversation"
  /** Established by this turn, from this request. */
  | "request";

export interface GroundedFact {
  scope: FactScope;
  /** The statement, in the user's terms. */
  text: string;
  /**
   * WHAT ESTABLISHED IT — a table, a surface, a count.
   *
   * Never rendered to the user. It exists so that a fact in a prompt can be
   * traced to the thing that produced it when an answer turns out wrong, which
   * is the only way to tell a bad sentence from a bad fact.
   */
  source: string;
}

export const workspaceFact = (text: string, source: string): GroundedFact =>
  ({ scope: "workspace", text, source });
export const conversationFact = (text: string, source: string): GroundedFact =>
  ({ scope: "conversation", text, source });
export const requestFact = (text: string, source: string): GroundedFact =>
  ({ scope: "request", text, source });

const HEADINGS: Readonly<Record<FactScope, string>> = Object.freeze({
  workspace: "TRUE OF THE WORKSPACE",
  conversation: "TRUE OF THIS CONVERSATION ONLY — says nothing about the workspace as a whole",
  request: "ESTABLISHED BY THIS REQUEST",
});

/**
 * Render facts for a prompt, grouped by scope, each group under its scope.
 *
 * ── THE ABSENCE RULE IS PART OF THE BLOCK, NOT THE PERSONA ────────────────
 *
 * A model given "leads in this conversation: 0" and no instruction will fill
 * the gap, because filling gaps is what it is for. The rule that closes it has
 * to travel with the facts — a surface that forgets to repeat it in its own
 * persona prompt would reopen the failure silently.
 */
export function renderFacts(facts: readonly GroundedFact[]): string {
  const out: string[] = ["<facts>"];
  if (facts.length === 0) {
    // THE EMPTY CASE IS THE DANGEROUS ONE, so it states the ignorance
    // explicitly rather than leaving a blank the model will fill.
    out.push(
      "You were given no facts about this workspace. You therefore do not know what it holds — not that it is empty.");
  }
  for (const scope of ["workspace", "conversation", "request"] as const) {
    const group = facts.filter((f) => f.scope === scope);
    if (group.length === 0) continue;
    out.push(`${HEADINGS[scope]}:`);
    for (const f of group) out.push(`- ${f.text}`);
  }
  // ── THE SAME RULE ON BOTH BRANCHES ────────────────────────────────────
  //
  // It was on the populated branch only, which put it exactly where it was
  // least needed: a model given three real counts has something to answer
  // from, and a model given none has nothing but the gap to fill.
  out.push(
    "",
    "These facts are the whole of what you were told. They are not an inventory:",
    "a number you were not given is a number you do not know, NOT a zero. Never",
    "report the workspace as empty, as having no leads, signals or companies, or",
    "as \"starting from zero\" on the strength of a fact that is not here.",
    "</facts>",
  );
  return out.join("\n");
}
