/**
 * The two mission fields this decision reads.
 *
 * Declared structurally rather than imported so the predicate has no module
 * dependencies and can be tested directly. `MissionLike` satisfies it.
 */
export interface MissionRoutingShape {
  target_entity?: string;
  requested_output?: string;
}

// DOES THIS REQUEST ASK FOR PEOPLE, OR FOR COMPANIES THAT ARE HIRING PEOPLE?
//
// ── THE FALSE POSITIVE THIS REPLACES ───────────────────────────────────────
//
// The dev routing guard decided by scanning the user's sentence for person
// nouns:
//
//   /\b(founders?|…|ceos?|…|contacts?|executives?)\b/i
//
// On 2026-08-31 a user asked, and the Pilot answered correctly:
//
//   "Find me 5 B2B SaaS companies in the UK with 20-200 employees that are
//    actively hiring SDRs, BDRs, Account Executives, or other sales roles."
//
//   target_entity     company
//   requested_output  qualified_companies
//   requested_count   5
//
// The regex matched the single word "Executives" — out of "Account Executives",
// a job title the TARGET COMPANIES ARE HIRING — concluded the backend had
// returned the wrong workflow, and disabled Start on a request that was routed
// perfectly.
//
// It is the same trap twice already corrected on the backend: a word that names
// the SIGNAL read as the TARGET. `missionTargetsIntermediaries` deliberately
// ignores the raw query for exactly this reason, because "recruiting" is also
// how a request names the signal it wants.
//
// ── WHAT DECIDES IT NOW ────────────────────────────────────────────────────
//
// The mission. `target_entity` and `requested_output` ARE the compiled reading
// of the user's words, produced by the same Pilot whose routing this guard is
// checking — so when a mission is present the question is structural and no
// sentence-matching is needed or wanted.
//
// The lexical fallback survives only for the case it was written for: no
// mission came back at all, so there is nothing structural to read. Even then
// the hiring clause is removed first, because a job title inside it is never
// the requested entity.

/** Everything from a hiring verb to the end of the clause. */
const HIRING_CLAUSE =
  /\b(?:hiring|recruiting|looking to hire|seeking|advertising for|with open roles? for|posting)\b[^.;]*/gi;

/** Person nouns that, outside a hiring clause, name what the user wants back. */
const PERSON_TARGET =
  /\b(founders?|co-?founders?|owners?|ceos?|presidents?|decision[-\s]?makers?|people to contact|contacts?|executives?)\b/i;

const EXPLICIT_LEAD_LANGUAGE =
  /\b(qualified leads?|contact[-\s]?ready|verified contacts?)\b/i;

const COUNTED_LEADS =
  /\b\d{1,3}\s+(?:qualified|contact[-\s]?ready|verified)?\s*leads?\b/i;

/** Mission outputs that are people rather than companies. */
const PERSON_OUTPUTS = new Set(['contact_ready_leads']);

/**
 * Would a correctly-routed backend have returned a qualified-lead contract?
 *
 * Structural when a mission is present; lexical only when one is not.
 */
export function requestImpliesQualifiedLead(i: {
  mission: MissionRoutingShape | null | undefined;
  originalRequest: string;
}): boolean {
  const mission = i.mission;
  if (mission && (mission.target_entity || mission.requested_output)) {
    // THE MISSION IS THE ANSWER. A company mission is a company mission however
    // many job titles the sentence lists.
    return mission.target_entity === 'person'
      || PERSON_OUTPUTS.has(String(mission.requested_output ?? ''));
  }

  // No mission to read — fall back to the sentence, with the hiring clause
  // removed so a role the target is hiring cannot be read as the target.
  const withoutHiringClause = String(i.originalRequest ?? '').replace(HIRING_CLAUSE, ' ');
  return PERSON_TARGET.test(withoutHiringClause)
    || EXPLICIT_LEAD_LANGUAGE.test(withoutHiringClause)
    || COUNTED_LEADS.test(withoutHiringClause);
}
