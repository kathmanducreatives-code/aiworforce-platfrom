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
  | "research_company"
  | "generate_outreach";

/**
 * Credits per row, per unlock.
 *
 * INTERNAL UNITS, never dollars. The execution ledger holds provider dollars
 * with their own provenance and the two are never converted into each other —
 * a credit is what a workspace is allowed to spend, not what a call cost.
 */
export const UNLOCK_PRICES: Readonly<Record<UnlockCapability, number>> = Object.freeze({
  /** One Apify people-search actor run against one company. */
  find_decision_makers: 2,
  /** One Firecrawl crawl plus extraction. */
  research_company: 1,
  /**
   * FREE. Drafting reaches no paid provider — it is a model call, and model
   * spend is recorded in dollars in `lead_execution_calls`. Charging credits
   * here would bill one cost twice, in two units.
   */
  generate_outreach: 0,
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
