// THE BRIEF SCRIBE IS GIVEN.
//
// The one place Content still produces an English sentence — and the difference
// from what it replaced matters: this is a PROMPT built from typed fields and
// stored on the row, not a chat command dispatched at Pilot and forgotten. A
// regeneration reads exactly this back, so the second draft answers the same
// question as the first.
//
// Company Brain is NOT pasted in here. `run-agent` already loads the workspace
// brain and renders it into Scribe's system prompt, so repeating it would both
// duplicate context and let this file drift from the real one.
//
// PURE. No network, no React.

export type InstructionFormat = "linkedin_post" | "linkedin_comment";
export type InstructionSource = "idea" | "signal";

export interface InstructionInput {
  format: InstructionFormat;
  sourceType: InstructionSource;
  /** The user's own words. Required for an idea, optional angle for a signal. */
  idea: string;
  signalTitle: string | null;
}

const WHAT: Record<InstructionFormat, string> = {
  linkedin_post: "a LinkedIn post",
  linkedin_comment: "a LinkedIn comment",
};

/**
 * DRAFT ONLY, every time. The product is approval-first and nothing here can
 * publish, so the instruction says so rather than leaving it implied.
 */
export function buildContentInstruction(i: InstructionInput): string {
  const what = WHAT[i.format] ?? "a LinkedIn post";
  const angle = i.idea.trim();

  if (i.sourceType === "signal") {
    const about = i.signalTitle?.trim();
    // A signal with no title is still a valid source — the id is on the row —
    // so the brief degrades to the angle rather than inventing a subject.
    const subject = about ? `this signal: "${about}"` : "the selected signal";
    return angle
      ? `Scribe, write ${what} about ${subject}. Angle: ${angle}. Draft only.`
      : `Scribe, write ${what} about ${subject}. Draft only.`;
  }
  return `Scribe, write ${what} about: ${angle}. Draft only.`;
}
