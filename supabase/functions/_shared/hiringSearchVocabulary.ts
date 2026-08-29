// WHICH TITLES THE JOB SEARCH ASKS FOR.
//
// ── TWO DEFECTS THIS REPLACES ──────────────────────────────────────────────
//
// The search sent a constant:
//
//   export const HIRING_JOB_TITLES: string[] =
//     [...TIER_A_TITLES, ...TIER_B_TITLES].slice(0, 20);
//
// with a comment promising "same titles, same order, same evidence standard".
// TIER_A holds 21 entries, so that slice keeps the first twenty of TIER_A and
// ZERO of TIER_B. Every title the returned data was actually full of —
// `account executive`, `sdr`, `bdr`, `sales development representative`,
// `sales director` — was silently deleted by an off-by-one against a list
// length nobody re-checked when TIER_A grew.
//
// Task 5c461aa3 asked LinkedIn for "deal desk", "gtm engineer" and
// "sales strategy & operations" while looking for companies hiring sales, and
// never once asked for "account executive".
//
// The second defect is that the constant is a constant at all. The mission
// carries the user's own role terms — `required_signal_terms: ["sales roles"]`
// — and `buildQualificationContext` expands them into a real vocabulary that
// the ASSESSMENT uses. The search never saw it. One half of the system knew
// what was being looked for and the other half did not.
//
// ── WHY A ROUND ROBIN AND NOT A CONCATENATION ──────────────────────────────
//
// The list has to stay bounded: this Actor's cost is
// `maxItems x jobTitles.length x locations`, so every title added widens the
// paid-row ceiling. A cap over a concatenation is exactly what deleted TIER_B,
// and it would do it again to whichever source happened to be last.
//
// Interleaving takes from every source until the budget is spent, so the cap
// can shorten a list but can never erase one. With the mission silent this
// yields a balanced ladder; with a mission present its terms lead.
//
// Pure. No network, no database, no model.

import { TIER_A_TITLES, TIER_B_TITLES } from "./commercialSignalPolicy.ts";

export const HIRING_SEARCH_VOCABULARY_VERSION = "hiring-search-vocabulary-v1" as const;

/**
 * How many titles one search may carry.
 *
 * Held at twenty — the number the previous constant happened to produce — so
 * this change alters WHICH titles are asked for and not how much a search may
 * cost. The Actor imposes no limit of its own; the budget does.
 */
export const HIRING_SEARCH_TITLE_LIMIT = 20;

/** The shape `buildQualificationContext` produces. */
export interface RoleVocabularyLike {
  source: string;
  required_titles: readonly string[];
}

const norm = (t: string) => t.trim().toLowerCase();

/**
 * Take from each list in turn until the budget is spent.
 *
 * Order within a list is preserved, so the most specific titles — which every
 * source puts first — survive a tight budget.
 */
function roundRobin(lists: ReadonlyArray<readonly string[]>, limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const depth = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < depth && out.length < limit; i++) {
    for (const list of lists) {
      if (out.length >= limit) break;
      const t = list[i];
      if (t === undefined) continue;
      const k = norm(t);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
  }
  return out;
}

/**
 * The titles to ask the provider for, given what the mission asked about.
 *
 * ── A MISSION THAT SPOKE IS NOT TOPPED UP ──────────────────────────────────
 *
 * When the mission named roles, those titles are the whole list. The first
 * version of this appended the commercial ladder after them, on the reasoning
 * that adjacent openings help a thin verdict clear the bar — and that quietly
 * turned "companies hiring Sales Operations" into a search for Account
 * Executives and SDRs. That is the boundary `roleFamilies.ts` exists to hold,
 * and the assessment already refuses to cross it; the search must not cross it
 * either, or the run pays to look for something nobody asked about.
 *
 * If the evidence that comes back is thin, the honest outcome is
 * `hiring_verification_needed` — a real state, and a better answer than a
 * verdict assembled from roles outside the request.
 *
 * A mission that named nothing gets the ladder, balanced across both tiers
 * rather than truncated to one.
 */
export function hiringSearchTitles(
  vocab: RoleVocabularyLike | null | undefined,
  limit: number = HIRING_SEARCH_TITLE_LIMIT,
): string[] {
  const fromMission = vocab?.source === "mission"
    ? (vocab.required_titles ?? []).filter((t) => norm(t).length > 0)
    : [];
  if (fromMission.length > 0) return roundRobin([fromMission], limit);
  return roundRobin([TIER_A_TITLES, TIER_B_TITLES], limit);
}
