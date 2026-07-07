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

/** Draft-only command for turning a signal into a post or comment. */
export function buildTurnIntoCommand(
  kind: "post" | "comment",
  opts: { title: string; sourceUrl?: string | null },
): string {
  const src = opts.sourceUrl ? ` Source: ${opts.sourceUrl}` : "";
  return `Scribe, turn signal "${opts.title}" into a ${kind} — draft only.${src}`;
}
