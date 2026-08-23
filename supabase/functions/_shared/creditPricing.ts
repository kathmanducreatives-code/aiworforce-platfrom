// WHAT EACH UNLOCK COSTS. ONE TABLE, AND IT IS THE ONE THAT CHARGES.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
//
// `creditAuthorization` reserved a flat `CREDITS_PER_PROVIDER_CALL = 1` for
// every paid call, and the Workbench showed no price at all — the unlock cell
// deliberately rendered nothing, because an earlier version had advertised a
// `~Nc` badge for a charge that never happened.
//
// Both were honest for what they were. Neither survives a UI that must say
// "Find contact · 2 credits" before spending, because the moment a number
// appears on a button it has to be THE number the reserve uses. A price shown
// by one module and charged by another is the `~Nc` badge again, with more
// steps.
//
// So: this table is the authority, it is what `authorizeProviderCall` is given,
// and `src/lib/credits/pricing.ts` mirrors it for display under a test that
// pins the two equal. Same convention as `companyBrainCompleteness`.
//
// ── WHY THE PRICES DIFFER ───────────────────────────────────────────────────
//
// Not tuning — they are the shape of the work. A people search is one Apify
// actor run against one company. Company research is a Firecrawl crawl, which
// is a page fetch and an extraction. Outreach drafting reaches no paid
// provider at all: it is a model call, and model spend is accounted in dollars
// in the execution ledger, not in credits. Charging credits for it would bill
// a user twice for one cost in two units.
//
// A capability absent from this table is FREE, explicitly. `priceFor` returns
// 0 rather than a default, because a silent default is how an unpriced action
// starts costing money nobody decided on.
//
// Pure — no network, no database.

export const CREDIT_PRICING_VERSION = "credit-pricing-v1" as const;

/** The unlockable capabilities a Workbench row offers. */
export type UnlockCapability =
  | "find_decision_makers"
  | "find_contact_details"
  | "research_company"
  | "generate_outreach"
  // ── SIGNALS ────────────────────────────────────────────────────────────
  // One provider search issued by a radar scan. Priced per SEARCH, not per
  // scan: a scan fans out across sources and stages, so a flat per-scan price
  // would charge once for a scan that made ninety provider calls — which is
  // how an unmetered path stays unmetered while appearing to be metered.
  | "signal_search";

/**
 * Credits per row, per unlock.
 *
 * INTERNAL UNITS, never dollars. The execution ledger holds provider dollars
 * with their own provenance and the two are never converted into each other —
 * a credit is what a workspace is allowed to spend, not what a call cost.
 */
export const UNLOCK_PRICES: Readonly<Record<UnlockCapability, number>> = Object.freeze({
  /**
   * One Apify people-search run against one company.
   *
   * PROVIDER COST, read from the live Store schema on 2026-08-23:
   * `harvestapi/linkedin-company-employees` bills a $0.02 actor start plus
   * $0.003 per short profile, so a bounded five-person search is ~$0.035. It is
   * the most expensive of the three per press, because a SEARCH pays a start
   * fee and returns several rows to be verified and ranked.
   */
  find_decision_makers: 2,
  /**
   * One profile enrichment, with an email lookup, against ONE known person.
   *
   * ── WHY THIS IS CHEAPER THAN FINDING THE PERSON ─────────────────────────
   *
   * `harvestapi/linkedin-profile-scraper` charges $0.010 for the
   * details+email event and has NO actor-start fee — roughly a third of a
   * decision-maker search. By the time it runs the person is already resolved
   * and verified, so it buys one lookup rather than a search, and the price
   * says so.
   *
   * It is not free, and not 1, because the email event genuinely costs 2.5x
   * the plain profile event and bills whether or not an address is found. A
   * user who unlocks this is buying an ATTEMPT with a real hit rate, and the
   * price has to survive the misses.
   */
  find_contact_details: 1,
  /** One Firecrawl crawl plus extraction. */
  research_company: 1,
  /**
   * FREE. Drafting reaches no paid provider — it is a model call, and model
   * spend is recorded in dollars in `lead_execution_calls`. Charging credits
   * here would bill one cost twice, in two units.
   */
  generate_outreach: 0,
  /**
   * One provider search issued by a radar scan.
   *
   * The scan that exposed this path made NINETY searches, so the UNIT matters
   * more than the number. Per-search keeps the cost proportional to the work
   * and makes a runaway fan-out visible in the ledger rather than hidden
   * behind a single per-scan charge.
   */
  signal_search: 1,
});

/**
 * The price of one unlock, or 0 for anything unpriced.
 *
 * EXPLICITLY 0, not a default of 1. An action that reaches this function
 * without an entry is an action nobody has priced, and quietly charging for it
 * is how a bill appears that no one decided on. Free is the safe direction and
 * the visible one — the cell renders nothing for 0.
 */
export function priceFor(capability: string): number {
  return (UNLOCK_PRICES as Record<string, number>)[capability] ?? 0;
}

/** What a bulk run over N rows costs, given how many still need the work. */
export function bulkPrice(capability: string, rowsNeedingWork: number): number {
  return priceFor(capability) * Math.max(0, rowsNeedingWork);
}
