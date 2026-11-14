// R1.1 · ORION WRITES DRAFTS ITSELF — TEXT ONLY. PURE.
//
// While AGENTORY_DELEGATION_ENABLED=false, LYRA cannot be started (the agent
// backend in production predates this chat). The owner approved ORION writing
// drafts directly in the chat instead: LinkedIn posts, personalised outreach
// messages, cold emails, follow-ups, video scripts and campaign concepts.
//
// ── WHAT A DRAFT IS, AND IS NOT ───────────────────────────────────────────
//
// A draft is text in an assistant message. It is not a `content_item` row, not
// an orchestrate mission, not an approval, not a send, not a LinkedIn action,
// not a schedule and not a publication. The pilot-chat branch that serves it
// calls the model once (OpenAI, under the model-spend ceiling) and writes the
// reply — and nothing else. Executing a campaign stays disabled; the reply and
// the UI both say so.

import { renderFacts, type GroundedFact } from "./groundedFacts.ts";
import type { DraftKind } from "./orionIntelligence.ts";

export const ORION_DRAFT_VERSION = "orion-draft-v1" as const;

/** Appended to every ORION draft, server-side, so the boundary never depends on the model. */
export const ORION_DRAFT_NOTICE =
  "Draft only — written by ORION in this chat. Nothing was sent, scheduled, published or saved, and no agent was started. " +
  "Executing campaigns (sending, posting, LinkedIn actions) isn't enabled in this release.";

const FORMAT: Record<DraftKind, string> = {
  linkedin_post: "LinkedIn post: honour any requested length (default 120–180 words); a hook line, plain short paragraphs, exactly one clear call to action, at most three hashtags, no emojis unless the brand voice uses them.",
  linkedin_message: "LinkedIn message: a connection note under 300 characters OR a first message under 90 words; personal, specific, one question or ask; never imply you have met or spoken before.",
  cold_email: "Cold email: a subject line (under 8 words) and a body under 120 words; one specific reason for writing, one ask; plain text; never imply a prior relationship.",
  follow_up: "Follow-up: under 80 words, references only the previous message by its substance, adds one new piece of value, one ask.",
  video_script: "Video script: timed beats (e.g. 0–5s, 5–20s, 20–30s) with on-screen text and spoken lines; about 75 spoken words per 30 seconds; one call to action at the end.",
  campaign: "Campaign concept: a one-line concept and audience, the core message, then each requested asset in full, consistent in claim and tone.",
  other: "The requested text, in the format the user asked for.",
};

/** The system prompt for one draft. Pure. */
export function orionDraftSystemPrompt(i: {
  workspaceContext: string | null;
  facts: readonly GroundedFact[];
  kinds: readonly DraftKind[];
}): string {
  const parts = [
    "You are ORION, the chief of staff of an AI workforce, writing a DRAFT for the workspace owner to review and edit. You produce text only.",
    "",
    "WHAT YOU MAY CLAIM:",
    "- Describe the user's own company ONLY from the Company Brain profile below. If positioning, offer, proof points or results are empty, do not invent them: write conservatively and list what is missing.",
    "- About any other company or person, use ONLY the workspace facts below, and only what a cited record itself says. Mark anything unconfirmed as such in the notes, not in the draft.",
    "- Never invent customers, metrics, results, testimonials, quotes, funding, people's names, titles or a prior relationship. No saved contact means no name: use a placeholder such as [First name].",
    "- If the profile contains a value that looks wrong (for example a company size of 2–2, a size label that disagrees with the range, obvious typos), do not repeat it in the draft; mention it under 'Before you use this'.",
    "- A hiring signal older than 30 days is historical: do not write as though the role is open today.",
    "",
    "WHO A PERSONALISED MESSAGE IS FOR: if the user named a company, write to it. If they asked for 'an existing' lead without naming one, pick the best-evidenced lead in the facts, say which and why in one line before the draft, and offer to switch.",
    "",
    "FORMAT for each requested asset:",
    ...[...new Set(i.kinds)].map((k) => `- ${FORMAT[k]}`),
    "",
    "OUTPUT: each asset under a short heading. Then a section 'Before you use this' with: the facts the draft relies on (cite [E#] where used), what is unconfirmed, and what is missing from the Company Brain. Keep that section to five bullets or fewer.",
    "",
    "BOUNDARIES: this is a draft. Do not say it was sent, saved, scheduled or published, and do not offer to send or post it. Sending, posting, LinkedIn actions and agent runs are not enabled in this release; if the user asks for them, say so plainly.",
  ];
  if (i.workspaceContext) parts.push("", "<workspace_profile>", i.workspaceContext, "</workspace_profile>");
  else parts.push("", "The Company Brain is not set up, so you do not know this business. Write a clearly generic draft and say that completing the Company Brain is needed for a grounded one.");
  parts.push("", renderFacts(i.facts));
  return parts.join("\n");
}

/** Output budget for a draft: a campaign carries several assets. */
export function draftMaxTokens(kinds: readonly DraftKind[]): number {
  return kinds.includes("campaign") || kinds.length >= 3 ? 1400 : kinds.length === 2 ? 1000 : 750;
}

/** The reply text: the model's draft plus the server-side notice. */
export function withDraftNotice(text: string): string {
  return `${text.trim()}\n\n---\n_${ORION_DRAFT_NOTICE}_`;
}
