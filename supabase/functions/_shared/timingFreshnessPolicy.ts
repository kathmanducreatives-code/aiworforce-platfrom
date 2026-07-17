// THE canonical timing-freshness authority — pure, deterministic, dependency-light.
//
// WHY THIS EXISTS
// The timing foundation shipped with TWO silently conflicting tables:
//   evidenceContract.SIGNAL_WINDOW_HOURS.funding_signal = 168h  (7 days)
//   signalFreshness.SIGNAL_FRESHNESS_POLICY.recent_funding = 180 days
// The contract won, so "find recently funded B2B SaaS founders" only matched
// companies funded in the last SEVEN DAYS — far too restrictive to be useful.
//
// This module is now the single source of truth for timing windows. Both tables
// import from here, so they cannot drift apart again.
//
// FUNDING DECAYS, IT DOES NOT CLIFF-EDGE
// Funding relevance fades gradually: a round closed last week is a strong reason to
// reach out; one closed four months ago is real context but not, by itself, a reason
// to call someone "hot right now". So funding carries DECAY BANDS rather than one
// boolean window. Every other category keeps its existing behaviour unchanged.
//
// PRECEDENCE (strictest wins):
//   an explicit user window ("funded this week")  >  the general funding policy
// A user who says "this week" means this week, even though the general policy would
// admit 90 days.

import type { EvidenceCategory } from "./evidenceContract.ts";

export const HOURS_PER_DAY = 24;
export const DAYS = (d: number) => d * HOURS_PER_DAY;

// ------------------------------------------------------- funding bands --------

/**
 * Funding freshness bands, measured from `occurred_at` (when the round happened),
 * never from `observed_at` (when we noticed it).
 *
 *   0–30d    strong           standalone recent-funding evidence
 *   31–90d   medium           still "recently funded", reduced strength
 *   91–180d  weak_supporting  may support another FRESH signal; never hot alone
 *   >180d    stale            cannot satisfy a current timing requirement
 */
export type FundingFreshnessBand = "strong" | "medium" | "weak_supporting" | "stale";

export const FUNDING_BAND_MAX_AGE_DAYS: Readonly<Record<Exclude<FundingFreshnessBand, "stale">, number>> = {
  strong: 30,
  medium: 90,
  weak_supporting: 180,
};

/** The outer limit: past this, a funding event is stale regardless of band. */
export const FUNDING_MAX_AGE_DAYS = FUNDING_BAND_MAX_AGE_DAYS.weak_supporting;

/** Classify a funding event by the age of the EVENT in days. */
export function fundingBandForAgeDays(ageDays: number): FundingFreshnessBand {
  if (!isFinite(ageDays) || ageDays < 0) return "stale";
  if (ageDays <= FUNDING_BAND_MAX_AGE_DAYS.strong) return "strong";
  if (ageDays <= FUNDING_BAND_MAX_AGE_DAYS.medium) return "medium";
  if (ageDays <= FUNDING_BAND_MAX_AGE_DAYS.weak_supporting) return "weak_supporting";
  return "stale";
}

/** True when the band can satisfy a funding requirement on its own merit. */
export function fundingBandSatisfiesAlone(b: FundingFreshnessBand): boolean {
  return b === "strong" || b === "medium";
}

// ------------------------------------------------ canonical category windows --

/**
 * The canonical max age (hours) per timing EvidenceCategory.
 *
 * Only `funding_signal` changes from the original table: 168h → 180d, so the decay
 * bands above govern strength inside that window instead of a 7-day cliff. Every
 * other category keeps its previously shipped behaviour exactly.
 */
export const CANONICAL_TIMING_WINDOW_HOURS: Readonly<Record<string, number>> = {
  job_signal: 72,                      // unchanged — a role posted 3d ago is current
  funding_signal: DAYS(FUNDING_MAX_AGE_DAYS),  // was 168h; decay bands apply within
  launch_signal: 168,                  // unchanged
  expansion_signal: 168,               // unchanged
  founder_activity_signal: 168,        // unchanged
  gtm_signal: 168,                     // unchanged
};

export function canonicalWindowHoursFor(c: EvidenceCategory): number | undefined {
  return CANONICAL_TIMING_WINDOW_HOURS[c];
}

// --------------------------------------------- explicit user intent windows ---

/**
 * A window the USER stated explicitly. Typed — compiled from the instruction by
 * leadEntityIntent, never guessed downstream from loose keywords.
 */
export type ExplicitTimingWindow = "this_week" | "this_month" | "recently" | "last_6_months";

export const EXPLICIT_WINDOW_DAYS: Readonly<Record<ExplicitTimingWindow, number>> = {
  this_week: 7,
  this_month: 30,
  recently: 90,
  last_6_months: 180,
};

export function explicitWindowHours(w: ExplicitTimingWindow): number {
  return DAYS(EXPLICIT_WINDOW_DAYS[w]);
}

/**
 * Resolve the window that actually applies to a category.
 *
 * The explicit user constraint wins whenever it is STRICTER than the general policy
 * — "funded this week" must not be widened to 90 days. A looser explicit window
 * ("in the last 6 months") is honoured up to the category's own ceiling.
 */
export function resolveWindowHours(args: {
  category: EvidenceCategory;
  explicitWindow?: ExplicitTimingWindow | null;
}): number | undefined {
  const general = canonicalWindowHoursFor(args.category);
  if (!args.explicitWindow) return general;
  const explicit = explicitWindowHours(args.explicitWindow);
  if (general == null) return explicit;
  return Math.min(general, explicit);
}
