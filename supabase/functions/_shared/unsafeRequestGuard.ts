// THE ONE REGEX OVER A USER'S SENTENCE THAT SURVIVES, AND WHY.
//
// ── WHAT IT IS NOT ─────────────────────────────────────────────────────────
//
// This is not routing. Every other pattern that read a message to decide what
// the user MEANT has been deleted: the workflow categories, the intent router,
// the tool planner, the daily-brief phrase table, the people-vs-companies menu.
// Deciding meaning is Chat Brain's job and it has it exclusively.
//
// This asks a different question, and only ever answers yes or no: does the
// message ask for something the product will not do?
//
// ── WHY IT STAYS ANYWAY, STATED PLAINLY ────────────────────────────────────
//
// It is DEFENCE IN DEPTH, not the enforcement. Nothing here is what stops an
// unapproved send: Penn writes drafts, `approvals` gates them, and no path in
// the system can dispatch without an approval row. Delete this guard entirely
// and the product is still safe — the user simply gets a queue of drafts
// instead of being told why the thing they asked for will not happen.
//
// That difference is worth one regex. "DM everyone on this list automatically"
// deserves an answer that says no and explains the alternatives, not a silent
// pile of drafts that technically complies.
//
// So it runs BEFORE routing, refuses, and explains. It never selects a surface,
// never picks an actor, and never decides which of six objectives a request is.
// If it ever starts doing any of those, it has become the thing it replaced.
//
// Pure. No network, no database, no model.

export const UNSAFE_GUARD_VERSION = "unsafe-request-guard-v1" as const;

/** Asking for delivery. Harmless alone — it is the pairing below that matters. */
const SEND_RE = /\b(send|deliver|fire off|blast)\s+(?:emails?|messages?|outreach)\b/i;

/** Asking for it to happen without a person in the loop, or for private data. */
const UNSAFE_RE =
  /\b(personal phone numbers?|home address|scrape private|private personal data|harvest emails for spam|send (?:emails?|messages?) automatically|automatic(?:ally)? send|without approval|start calling them automatically|cold call(?:ing)? (?:automated|automatic)|automatic(?:ally)?\s+(?:comment|post|publish|share|dm|message|email|reply|engage|connect|like)|auto[- ]?(?:comment|post|publish|share|dm|message|email|reply|like|engage|connect)|(?:post|publish|share)\s+(?:this|that|it|these|them)?[^.!?]*\bautomatic(?:ally)?|(?:email|message|dm|text|contact|reach out to)\b[^.!?]{0,30}\bautomatic(?:ally)?|send\s+(?:messages?|dms?|emails?|outreach)\s+to\s+(?:all|every|everyone|each))\b/i;

/** Unattended delivery, expressed as urgency rather than as "automatically". */
const UNATTENDED_RE =
  /\bautomatic|without approval|right now|right away|immediately|\bnow\b\.?$/i;

/**
 * Does this message ask for something the product refuses to do?
 *
 * Deliberately narrow. It answers a yes/no about PERMISSION, and a false
 * negative costs nothing — the approval gates downstream are what actually
 * hold — while a false positive would refuse legitimate work, so the patterns
 * require an explicit unattended or private-data phrasing rather than inferring
 * intent from a verb.
 */
export function asksForUnsafeAction(message: string): boolean {
  const m = String(message ?? "").trim();
  if (!m) return false;
  return UNSAFE_RE.test(m) || (SEND_RE.test(m) && UNATTENDED_RE.test(m));
}

/**
 * What to say. Names what is refused AND what is available, because a refusal
 * that offers nothing leaves the user with no next move.
 */
export const UNSAFE_REQUEST_REPLY =
  "I can't run that as described — it would involve unsafe or unsupported actions (e.g. scraping private personal data or sending without your approval). I can help with: public business contact research, approval-gated email outreach, LinkedIn outreach drafts, or call scripts. Which of those would you like?";
