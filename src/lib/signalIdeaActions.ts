// Pure helpers for the Content page's per-signal idea actions. No React/network
// — Deno-testable. Save/Ignore map to persisted signal_review statuses (they must
// NOT depend on the chat), while turn-into-post/comment builds a draft-only Pilot
// command. Nothing here ever instructs auto-posting.

export type SignalIdeaAction = "save" | "ignore";
export type IdeaReviewStatus = "saved" | "ignored";

/** Map a Save/Ignore idea action to the review status it persists. */
export function ideaReviewStatus(action: SignalIdeaAction): IdeaReviewStatus {
  return action === "save" ? "saved" : "ignored";
}

/**
 * WHICH SIGNAL, AS DATA — sent alongside the command, never inside it.
 *
 * The sentence is for the conversation; this is what Pilot acts on. The
 * signal's real id travels in the action metadata so the draft is created with
 * `source_type='signal'` and a real `source_signal_id`, verified by the backend
 * against the workspace. A title in a sentence cannot do that: the model would
 * have to guess which signal it meant.
 */
export function buildTurnIntoMetadata(
  kind: "post" | "comment",
  signal: { id: string },
): Record<string, unknown> {
  return {
    intent: "signal_to_content",
    signal_id: signal.id,
    content_format: kind === "comment" ? "linkedin_comment" : "linkedin_post",
  };
}

/** Draft-only command for turning a signal into a post or comment. */
export function buildTurnIntoCommand(
  kind: "post" | "comment",
  opts: { title: string; sourceUrl?: string | null },
): string {
  const src = opts.sourceUrl ? ` Source: ${opts.sourceUrl}` : "";
  return `Scribe, turn signal "${opts.title}" into a ${kind} — draft only.${src}`;
}
