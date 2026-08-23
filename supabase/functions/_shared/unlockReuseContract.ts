// NEVER PURCHASE WHAT AGENTORY ALREADY HAS.
//
// ── THE RULE, AND WHY IT NEEDS A MODULE ─────────────────────────────────────
//
// Every premium action in the Workbench is a button a user can press twice. The
// second press is almost never a request to buy the same thing again — it is a
// mis-click, a page reload, a bulk action that overlaps a single one, or a user
// checking whether anything changed. Charging for it is indefensible, and
// "the UI hides the button once it succeeds" is not a guard: the UI is one
// caller, and the ledger is where money moves.
//
// The idempotency key in `toolRegistry` already stops a REPLAYED call — same
// task, same input — from reserving twice. This is the other half: a NEW call,
// in a new task, for evidence that is already on the row. The ledger cannot see
// that, because as far as it knows this is a first request.
//
// ── HELD MEANS ANSWERED, NOT SUCCESSFUL ─────────────────────────────────────
//
// The subtle case is a paid attempt that produced nothing. An email lookup that
// ran and found no address ANSWERED the question — running it again buys the
// same nothing at the same price — so it counts as held. A provider ERROR did
// not answer anything, so it does not.
//
// Getting that backwards in either direction is a real cost:
//   treating not_found as unheld  → the user is charged repeatedly for a miss
//   treating an error as held     → a transient failure is permanent, and the
//                                   user can never buy the thing they wanted
//
// PURE. No network, database, provider or model access.

export const UNLOCK_REUSE_VERSION = "unlock-reuse-contract-v1" as const;

/** The four actions a Workbench row offers. */
export type UnlockAction =
  | "find_decision_makers"
  | "find_contact_details"
  | "research_company"
  | "generate_outreach";

/**
 * What is already persisted for one lead, as the executor reads it.
 *
 * Deliberately shaped as "what exists", not "what succeeded" — the distinction
 * between an answered miss and an unanswered failure is made by this module,
 * once, rather than by each caller's idea of truthiness.
 */
export interface HeldEvidence {
  /** A resolved, verified decision maker. */
  decision_maker?: { linkedin_url?: string | null; full_name?: string | null } | null;
  /** The outcome of a previous contact enrichment, whatever it was. */
  contact?: { status?: string | null } | null;
  /** A previous Firecrawl research result. */
  research?: { summary?: string | null; evidence_urls?: unknown } | null;
  /** A previous outreach draft. */
  outreach?: { draft?: string | null } | null;
}

export type ReuseVerdict =
  /** Already held. Return it; spend nothing. */
  | "reuse"
  /** Not held. The action may run and may charge. */
  | "purchase"
  /** Held, but the user explicitly asked for a fresh result. */
  | "refresh";

export interface ReuseDecision {
  verdict: ReuseVerdict;
  action: UnlockAction;
  /** Shown to the user and written to the audit trail. */
  reason: string;
  /** True when this decision prevented a charge. Counted in telemetry. */
  spend_avoided: boolean;
}

/** Statuses that mean the contact question has been ANSWERED for this person. */
const CONTACT_ANSWERED: readonly string[] = ["email_found", "not_found"];

function nonEmpty(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/**
 * Is the evidence this action produces already on the row?
 *
 * Each answer names the field it looked at, because "already have it" with no
 * subject is the kind of message that makes a user press the button again.
 */
export function heldFor(action: UnlockAction, held: HeldEvidence): boolean {
  switch (action) {
    case "find_decision_makers":
      // A person is held once they have an identity to act on. A name with no
      // profile is not something contact enrichment can use.
      return nonEmpty(held.decision_maker?.linkedin_url) ||
        nonEmpty(held.decision_maker?.full_name);
    case "find_contact_details":
      return CONTACT_ANSWERED.includes(String(held.contact?.status ?? ""));
    case "research_company":
      return nonEmpty(held.research?.summary) && nonEmpty(held.research?.evidence_urls);
    case "generate_outreach":
      // A DRAFT IS NOT A PURCHASE. Outreach reaches no paid provider, so
      // re-drafting costs no credits and a user asking again usually wants a
      // different message. Never withheld.
      return false;
  }
}

/**
 * Decide whether to spend.
 *
 * `forceRefresh` is the user saying "do it again anyway" — an explicit,
 * per-press choice, never a default and never inferred from a retry.
 */
export function decideReuse(
  action: UnlockAction, held: HeldEvidence, opts: { forceRefresh?: boolean } = {},
): ReuseDecision {
  const has = heldFor(action, held);

  if (has && opts.forceRefresh === true) {
    return {
      verdict: "refresh", action, spend_avoided: false,
      reason: "already held, and a refresh was explicitly requested — this will " +
        "charge again",
    };
  }
  if (has) {
    return {
      verdict: "reuse", action, spend_avoided: true,
      reason: reuseReason(action, held),
    };
  }
  return {
    verdict: "purchase", action, spend_avoided: false,
    reason: "not held for this lead; the action will run and may charge",
  };
}

function reuseReason(action: UnlockAction, held: HeldEvidence): string {
  switch (action) {
    case "find_decision_makers":
      return `a decision maker is already resolved for this lead` +
        (held.decision_maker?.full_name ? ` (${held.decision_maker.full_name})` : "") +
        `; nothing was purchased again`;
    case "find_contact_details": {
      const st = String(held.contact?.status ?? "");
      return st === "not_found"
        // THE CASE MOST LIKELY TO BE MISREAD. Say plainly that the miss was
        // bought and re-buying changes nothing, or the user will press again.
        ? "a contact lookup has already run for this person and returned no " +
          "address. Re-running buys the same nothing at the same price."
        : "a business email is already held for this person; nothing was " +
          "purchased again";
    }
    case "research_company":
      return "company research is already held for this lead; nothing was " +
        "purchased again";
    case "generate_outreach":
      return "drafting reaches no paid provider and is never withheld";
  }
}

/**
 * The evidence available to outreach, and how deep a message it supports.
 *
 * ── FIRECRAWL IMPROVES OUTREACH; IT DOES NOT GATE IT ───────────────────────
 *
 * `openerBackend` blocked on `blocked_missing_company_research`, so a lead with
 * a verified buyer, a dated hiring signal and full firmographics could not be
 * written to until a crawl had been bought. That made a premium enrichment a
 * prerequisite for the product's core action.
 *
 * The honest rule is that outreach needs SOMETHING GROUNDED to say, and deep
 * research is one source of that rather than the only one. So depth is graded:
 * a message written from a dated signal is genuinely more specific than one
 * written from firmographics, and one written from a site crawl more specific
 * still. What must never happen is a message written from nothing.
 */
export type OutreachDepth =
  /** Nothing grounded. Do not draft. */
  | "insufficient"
  /** Firmographics only — who they are, not what changed. */
  | "company_level"
  /** A dated signal: hiring, funding, a post. A real why-now. */
  | "signal_specific"
  /** Deep site research as well. The richest personalization available. */
  | "research_deep";

export interface OutreachEvidence {
  /** Industry, size, geography — established at qualification. */
  has_company_evidence: boolean;
  /** A dated hiring / funding / social signal. */
  has_dated_signal: boolean;
  /** A verified person to address. */
  has_verified_person: boolean;
  /** Firecrawl research, if it was unlocked. */
  has_deep_research: boolean;
}

export function outreachDepthFor(e: OutreachEvidence): OutreachDepth {
  // A PERSON IS STILL REQUIRED. Personalization is addressed to somebody, and
  // a draft with no verified recipient is a template.
  if (!e.has_verified_person) return "insufficient";
  if (!e.has_company_evidence && !e.has_dated_signal) return "insufficient";
  if (e.has_deep_research) return "research_deep";
  if (e.has_dated_signal) return "signal_specific";
  return "company_level";
}

/** Ordered best-first, so a caller can say what would improve a draft. */
export const OUTREACH_DEPTH_ORDER: readonly OutreachDepth[] = Object.freeze([
  "research_deep", "signal_specific", "company_level", "insufficient",
]);

/**
 * What the user could unlock to write a better message.
 *
 * A recommendation, never an action: GPT may say this and may not spend it.
 */
export function depthUpgradeFor(e: OutreachEvidence): UnlockAction | null {
  if (!e.has_verified_person) return "find_decision_makers";
  if (!e.has_deep_research) return "research_company";
  return null;
}
