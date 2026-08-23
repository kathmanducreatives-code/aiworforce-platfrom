// WHAT THE USER ASKED TO RECEIVE, AND WHAT THEY ACTUALLY GET.
//
// ── THE SUBSTITUTION THIS PREVENTS ──────────────────────────────────────────
//
// "Find founders posting about outbound problems" compiles to
// `target_entity: person`, and the run returns COMPANIES. Person work is
// deliberately never scheduled — founder discovery is unlock-gated so the
// pipeline cannot spend on people without a user pressing a priced button — so
// the plan carries `offer_founder_unlock` and the result carries accounts.
//
// The gating is right. The SILENCE is not. A user who asked for founders was
// handed companies with no statement that a substitution had happened, which
// reads as "these are your founders" and is the one thing this architecture
// keeps refusing to do elsewhere: it reported a different answer to the
// question rather than reporting that the question was not answered.
//
// ── WHAT THIS MODULE DOES ───────────────────────────────────────────────────
//
// It makes the substitution EXPLICIT and typed. A result states the entity that
// was requested, the entity being returned, and — when they differ — exactly
// what would close the gap and what it costs. People are returned when people
// exist; companies are returned as PENDING when they do not, never as the
// answer.
//
// PURE. No network, provider, model or database access.

export const MISSION_OUTPUT_VERSION = "mission-output-contract-v1" as const;

/** What the mission asked to receive. */
export type RequestedEntity = "company" | "person" | "job";

/**
 * Why the returned entity differs from the requested one.
 *
 * Every value names something a user can ACT on. There is deliberately no
 * generic `unavailable`: a reason nobody can do anything about is a reason that
 * should not have been surfaced as one.
 */
export type SubstitutionReason =
  /** People need an unlock nobody has purchased for these accounts yet. */
  | "awaiting_people_unlock"
  /** The accounts themselves are not qualified yet, so people are premature. */
  | "no_qualified_accounts";

export interface PersonRow {
  company_key: string;
  full_name: string | null;
  title: string | null;
  linkedin_url: string | null;
  /** Present only when a contact unlock ran for this person. */
  business_email?: string | null;
  verification_status?: string | null;
}

export interface CompanyRow {
  company_key: string;
  company_name: string | null;
  qualified: boolean;
}

export interface MissionOutputInput {
  requested_entity: RequestedEntity;
  companies: readonly CompanyRow[];
  /** People already unlocked for these accounts. Empty on an un-unlocked run. */
  people: readonly PersonRow[];
  /** The unlock that would produce people, and its price in credits. */
  people_unlock?: { capability: string; credits: number } | null;
}

export interface MissionOutput {
  version: typeof MISSION_OUTPUT_VERSION;
  requested_entity: RequestedEntity;
  /** What is actually in `rows`. Equals `requested_entity` or says why not. */
  returned_entity: RequestedEntity;
  rows_are_the_answer: boolean;
  companies: readonly CompanyRow[];
  people: readonly PersonRow[];
  substitution: {
    occurred: boolean;
    reason: SubstitutionReason | null;
    /** Shown to the user. Names the action and the price. */
    message: string | null;
    /** The capability that would close the gap. */
    unlock_capability: string | null;
    unlock_credits: number | null;
    /** How many accounts are waiting on it. */
    accounts_pending: number;
  };
}

/**
 * Resolve what this run returns.
 *
 * ── PEOPLE WIN WHENEVER THEY EXIST ──────────────────────────────────────────
 *
 * A person-entity mission with unlocked people returns PEOPLE — that is the
 * requested answer and there is nothing to explain. The substitution branch is
 * reached only when there are none, and it never claims the companies are the
 * answer: `rows_are_the_answer` is false, which is the flag a renderer reads to
 * avoid captioning accounts as founders.
 */
export function resolveMissionOutput(i: MissionOutputInput): MissionOutput {
  const qualified = i.companies.filter((c) => c.qualified);

  const base = {
    version: MISSION_OUTPUT_VERSION,
    requested_entity: i.requested_entity,
    companies: i.companies,
    people: i.people,
  } as const;

  const none = {
    occurred: false, reason: null, message: null,
    unlock_capability: null, unlock_credits: null, accounts_pending: 0,
  } as const;

  // COMPANIES OR JOBS WERE ASKED FOR. Nothing to reconcile.
  if (i.requested_entity !== "person") {
    return {
      ...base,
      returned_entity: i.requested_entity,
      rows_are_the_answer: true,
      substitution: { ...none },
    };
  }

  // PEOPLE WERE ASKED FOR AND PEOPLE EXIST.
  if (i.people.length > 0) {
    return {
      ...base,
      returned_entity: "person",
      rows_are_the_answer: true,
      substitution: { ...none },
    };
  }

  // PEOPLE WERE ASKED FOR AND NONE EXIST YET.
  const reason: SubstitutionReason = qualified.length === 0
    ? "no_qualified_accounts"
    : "awaiting_people_unlock";

  const cap = i.people_unlock?.capability ?? null;
  const credits = i.people_unlock?.credits ?? null;

  const message = reason === "no_qualified_accounts"
    ? "You asked for people. No account has qualified yet, so there is nobody " +
      "to look up — these are the companies found so far, not the answer."
    : `You asked for people. ${qualified.length} account` +
      `${qualified.length === 1 ? " has" : "s have"} qualified and nobody has been ` +
      `looked up yet: finding a decision maker is a separate, priced action` +
      (cap && credits != null ? ` (${cap}, ${credits} credit${credits === 1 ? "" : "s"} per account)` : "") +
      ". These are the accounts, not the people.";

  return {
    ...base,
    // THE TRUTH, NOT THE REQUEST. Saying `person` here while returning company
    // rows is exactly the silent substitution this module exists to end.
    returned_entity: "company",
    rows_are_the_answer: false,
    substitution: {
      occurred: true,
      reason,
      message,
      unlock_capability: cap,
      unlock_credits: credits,
      accounts_pending: qualified.length,
    },
  };
}

/**
 * Ways a result could still misrepresent itself.
 *
 * Read by tests and by the persistence layer. Returns violations rather than
 * throwing — a caller deciding what to do about a bad shape is better served by
 * the list than by a stack trace.
 */
export function outputContractViolations(o: MissionOutput): string[] {
  const out: string[] = [];

  if (o.returned_entity === "person" && o.people.length === 0) {
    out.push("claims to return people while carrying none");
  }
  if (o.requested_entity === "person" && o.returned_entity !== "person" &&
      !o.substitution.occurred) {
    out.push("returned companies for a person request without recording a substitution");
  }
  if (o.substitution.occurred && !o.substitution.message) {
    out.push("a substitution with no message is a silent substitution");
  }
  if (o.substitution.occurred && o.rows_are_the_answer) {
    out.push("a substituted result must not claim its rows are the answer");
  }
  // An unlock message that names no action is an apology, not an offer.
  if (o.substitution.reason === "awaiting_people_unlock" &&
      !o.substitution.unlock_capability) {
    out.push("awaiting an unlock but naming no capability to unlock");
  }
  return out;
}
