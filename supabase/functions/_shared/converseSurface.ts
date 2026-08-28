// PILOT ANSWERING A QUESTION, GROUNDED IN THIS WORKSPACE.
//
// ── WHAT THIS REPLACES ─────────────────────────────────────────────────────
//
// Five branches, each keyed on a classifier category, each answering a slice of
// "the user is talking to me rather than asking for work":
//
//   simple_chat        a hardcoded greeting. No model call, no context. The
//                      message was not read at all — "what should I focus on
//                      first?" and "hello" got the same sentence.
//   capabilities       a model call, grounded in the Company Brain.
//   agent_management   a model call, grounded in the Company Brain.
//   signal_sourcing +  a model call recommending a lead strategy.
//     needs_clarification
//   unclear            a canned clarification menu.
//
// The machinery for a grounded answer existed in three of those five. The one
// that most needed it — ordinary conversation — was the one wired to a
// constant, which is why Pilot read as a form with six categories rather than
// something that knows the workspace.
//
// ── WHAT IT MUST NOT DO ────────────────────────────────────────────────────
//
// Invent facts. The whole point of the objective split is that `converse`
// answers from judgement and from context it was GIVEN, and never claims to
// have looked something up. So the prompt states the grounding rules and the
// caller supplies the facts; nothing here queries anything.
//
// It also never decides work. A conversational answer cannot start a run, pick
// a provider or spend — `converse` carries no mission and reaches no invoker,
// which is a property of the route rather than a rule this file enforces.
//
// Pure prompt construction. The model call is the caller's.

import { type GroundedFact, renderFacts } from "./groundedFacts.ts";

export const CONVERSE_SURFACE_VERSION = "converse-surface-v1" as const;

export interface ConverseContext {
  /** The rendered Company Brain block, or null when onboarding is incomplete. */
  workspaceContext: string | null;
  /**
   * What this answer may state, each fact carrying the scope it is true in.
   *
   * Strings were not enough. Three conversation-scoped counters under a
   * heading reading `workspace_facts` produced "I don't have any leads or
   * prospects in the workspace yet" one turn after 32 were named — the numbers
   * were right and the scope was invented. `GroundedFact` makes the scope part
   * of the fact, so a surface cannot hand one over without it.
   */
  facts?: readonly GroundedFact[];
}

/**
 * The system prompt for a grounded conversational answer.
 *
 * ── THE GROUNDING RULES ARE THE PROMPT'S REAL CONTENT ──────────────────────
 *
 * Everything below the persona exists to stop one failure: a fluent paragraph
 * about signals, leads or competitors that the workspace does not have. The
 * model may reason, advise and explain; it may not report state it was not
 * given, and it may not imply that anything was fetched to answer.
 */
export function converseSystemPrompt(ctx: ConverseContext): string {
  const parts: string[] = [
    "You are Pilot, the coordinator of a small AI workforce for a B2B sales and recruiting team. You are talking with the person who owns this workspace.",
    "",
    "Answer conversationally and concisely — usually two to five sentences, never more than about 150 words. No preamble, no bullet lists unless they genuinely help, no emojis.",
    "",
    "GROUNDING — the rules that matter most:",
    "- Use ONLY the workspace facts given below. They are the entire truth you have.",
    "- Never state a number, a name, a count or a status that is not in those facts.",
    "- If you do not have something, say so plainly and say what would get it. Do not guess and do not hedge with vague filler.",
    "- Never imply you just looked something up, ran anything, or checked live data. Nothing was fetched to answer this.",
    "- The facts below are NOT an inventory of the workspace, and they carry the scope each one is true in. Respect it: a count of what this conversation produced says nothing about what the workspace holds.",
    "- If you were not told a count, you do not know it; say you would have to look. Never turn a fact you were not given into an absence.",
    "- If an earlier turn in this conversation reported something, that report stands. Do not contradict it, and do not restate it as though you had checked.",
    "- You may reason, compare, recommend and explain your thinking. That is what this conversation is for.",
    "",
    "WHAT YOU CAN OFFER, if it is relevant: sourcing companies or people, researching a named company or a link, watching a company for signals, reading back what the workspace already holds, and drafting outreach — which is always approval-gated and never sent without the user saying so.",
    "Do not promise anything else, and do not describe work as done when you are only offering it.",
  ];

  if (ctx.workspaceContext) {
    parts.push("", "<workspace_profile>", ctx.workspaceContext, "</workspace_profile>");
  } else {
    parts.push(
      "",
      "The Company Brain is not set up yet, so you do not know this business. Say that honestly if the answer depends on it, and suggest completing onboarding — do not invent an ICP, a product or a market.",
    );
  }

  // ALWAYS RENDERED, EVEN WHEN EMPTY. "No facts" is itself something the model
  // must be told, because the alternative reading — silence means nothing is
  // there — is the exact error this block exists to prevent.
  parts.push("", renderFacts(ctx.facts ?? []));

  return parts.join("\n");
}

/**
 * Said when the model is unavailable.
 *
 * NOT A GREETING. The old `simple_chat` branch answered every conversational
 * message with "Hi — I'm Pilot for your workspace. What would you like to work
 * on?", which is a reasonable thing to say once and a wrong answer to every
 * question after that. A failure should say that it failed.
 */
export const CONVERSE_UNAVAILABLE =
  "I couldn't put an answer together just now — that's my end, not yours. Ask me again, or tell me what you'd like to do and I'll get on with it.";
