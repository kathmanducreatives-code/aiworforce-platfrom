// THE VISUAL BRIEF — one place that turns a draft into an image prompt.
//
// Shared so the Content page, Pilot and any future caller produce the SAME
// prompt for the same draft. A second copy of this logic is how two entrypoints
// start generating visibly different images from identical content.
//
// PURE. No network, no provider, no keys.

export interface VisualBriefInput {
  format: string;
  title: string | null;
  body: string;
  /** Scribe's own visual brief, when the strategy produced one. */
  visualBrief: string | null;
}

/** How much of the draft to show the image model. */
export const MAX_BODY_CHARS = 900;

/**
 * NO PEOPLE, NO LOGOS, NO TEXT IN THE IMAGE.
 *
 * Three constraints that are about correctness, not taste:
 *   · rendered text in generated images is still usually malformed, and a
 *     LinkedIn post illustrated with garbled words looks broken
 *   · invented logos and brand marks are somebody else's trademark
 *   · synthetic faces presented beside real company claims read as deceptive
 */
const GUARDRAILS = [
  "Do not render any text, words, letters or numbers in the image.",
  "Do not depict real people, recognisable faces, logos or brand marks.",
  "Editorial, abstract or conceptual illustration suitable for a business audience.",
].join(" ");

export function buildVisualPrompt(i: VisualBriefInput): string {
  // Scribe's brief wins when it exists: it was written with the Company Brain
  // in context, which this function does not have.
  const subject = i.visualBrief?.trim()
    || [i.title?.trim(), i.body.trim().slice(0, MAX_BODY_CHARS)].filter(Boolean).join(" — ");

  const kind = i.format === "linkedin_comment"
    ? "a short social comment"
    : "a LinkedIn post";

  return `Create a single editorial illustration to accompany ${kind}. ` +
    `Subject: ${subject}. ${GUARDRAILS}`;
}
