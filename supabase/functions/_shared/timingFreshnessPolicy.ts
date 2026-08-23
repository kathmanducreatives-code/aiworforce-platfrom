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
/**
 * The shared decay vocabulary. Both funding and hiring decay through these bands;
 * only the day thresholds differ.
 *
 *   strong           independently satisfies a current-timing requirement
 *   medium           independently satisfies, with reduced strength
 *   weak_supporting  supports another CURRENT signal; never establishes "hot" alone
 *   stale            cannot satisfy a current timing requirement
 */
export type TimingFreshnessBand = "strong" | "medium" | "weak_supporting" | "stale";

/** Kept as the published name for funding; identical to TimingFreshnessBand. */
export type FundingFreshnessBand = TimingFreshnessBand;
/** Hiring uses the same vocabulary with its own thresholds. */
export type JobFreshnessBand = TimingFreshnessBand;

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

// -------------------------------------------------------- hiring bands --------

/**
 * Hiring freshness bands, measured from `occurred_at` (when the role was posted).
 *
 *   0–7d     strong           "hiring this week" / clearly current
 *   8–30d    medium           "currently hiring" — current, reduced strength
 *   31–60d   weak_supporting  supports another CURRENT signal; never hot alone.
 *                             May satisfy an EXPLICIT "last 60 days" request.
 *   >60d     stale            cannot satisfy a current timing requirement
 *
 * Hiring decays faster than funding: a role posted four months ago says little about
 * whether the team is still being built, whereas budget raised four months ago is
 * still budget.
 */
export const JOB_BAND_MAX_AGE_DAYS: Readonly<Record<Exclude<JobFreshnessBand, "stale">, number>> = {
  strong: 7,
  medium: 30,
  weak_supporting: 60,
};

/**
 * RETENTION — the outer limit a hiring signal may ever be used, including as
 * supporting evidence or in an explicit "last 60 days" request.
 */
export const JOB_MAX_AGE_DAYS = JOB_BAND_MAX_AGE_DAYS.weak_supporting;

/**
 * The DEFAULT standalone requirement window. Distinct from retention: a plain
 * "currently hiring" request means the last 30 days, but the user may explicitly
 * widen to the 60-day retention ceiling. Funding does not need this distinction
 * because its default window and retention ceiling are both 180 days.
 */
export const JOB_DEFAULT_REQUIREMENT_DAYS = JOB_BAND_MAX_AGE_DAYS.medium;

/** Classify a hiring event by the age of the EVENT in days. */
export function jobBandForAgeDays(ageDays: number): JobFreshnessBand {
  if (!isFinite(ageDays) || ageDays < 0) return "stale";
  if (ageDays <= JOB_BAND_MAX_AGE_DAYS.strong) return "strong";
  if (ageDays <= JOB_BAND_MAX_AGE_DAYS.medium) return "medium";
  if (ageDays <= JOB_BAND_MAX_AGE_DAYS.weak_supporting) return "weak_supporting";
  return "stale";
}

/** True when the band can satisfy a hiring requirement on its own merit. */
export function jobBandSatisfiesAlone(b: JobFreshnessBand): boolean {
  return b === "strong" || b === "medium";
}

// ------------------------------------------------------ listing status --------

/**
 * Normalized, provider-independent status of a job listing.
 *
 * `unknown` is the honest default: absence of a closing date is NOT evidence that a
 * listing is still open, so active status must be positively source-backed.
 */
export type ListingStatus = "active" | "closed" | "expired" | "unknown";

/** Closed/expired listings are stale immediately — age never overrides this. */
export function listingStatusIsDead(s: ListingStatus | null | undefined): boolean {
  return s === "closed" || s === "expired";
}

// ------------------------------------------------ canonical category windows --

/**
 * The DEFAULT standalone requirement window (hours) per timing EvidenceCategory —
 * what a plain "currently hiring" / "recently funded" request means when the user
 * states no window of their own.
 *
 * Changed from the original table:
 *   funding_signal  168h → 180d  (decay bands govern strength inside the window)
 *   job_signal       72h → 30d   (a role posted 10 days ago is plainly still current;
 *                                 72h treated it as stale)
 * launch/expansion/founder_activity/gtm keep their shipped behaviour exactly.
 */
export const CANONICAL_TIMING_WINDOW_HOURS: Readonly<Record<string, number>> = {
  job_signal: DAYS(JOB_DEFAULT_REQUIREMENT_DAYS),   // was 72h
  funding_signal: DAYS(FUNDING_MAX_AGE_DAYS),       // was 168h
  launch_signal: 168,                  // unchanged
  expansion_signal: 168,               // unchanged
  founder_activity_signal: 168,        // unchanged
  gtm_signal: 168,                     // unchanged
  // Social activity is only meaningful while it is recent — a post from six
  // months ago is not evidence that a company is moving now. One week, matching
  // the scenario matrix's own `within_week` requirement for founder activity.
  company_activity_signal: 168,
  engagement_signal: 168,
  // A technology stack is firmographic: it changes rarely and a month-old
  // reading is still true.
  technology_signal: DAYS(30),
  // Headcount is a delta between observations, so the window is the span the
  // comparison may cover rather than the age of one reading.
  headcount_signal: DAYS(90),
};

/**
 * RETENTION ceiling (hours) per category — the absolute maximum age at which a
 * signal may be used AT ALL, including as supporting evidence or under an explicit
 * user window.
 *
 * Only job_signal separates the two: its default requirement is 30 days but a user
 * may explicitly ask for the last 60 days. Every other category's retention equals
 * its default window, so this table falls back to CANONICAL_TIMING_WINDOW_HOURS.
 */
export const CANONICAL_TIMING_RETENTION_HOURS: Readonly<Record<string, number>> = {
  job_signal: DAYS(JOB_MAX_AGE_DAYS),   // 60d — wider than the 30d default requirement
};

export function canonicalWindowHoursFor(c: EvidenceCategory): number | undefined {
  return CANONICAL_TIMING_WINDOW_HOURS[c];
}

/** The widest age a category's evidence may ever reach. */
export function retentionHoursFor(c: EvidenceCategory): number | undefined {
  return CANONICAL_TIMING_RETENTION_HOURS[c] ?? CANONICAL_TIMING_WINDOW_HOURS[c];
}

// --------------------------------------------- explicit user intent windows ---

/**
 * A window the USER stated explicitly. Typed — compiled from the instruction by
 * leadEntityIntent, never guessed downstream from loose keywords.
 */
export type ExplicitTimingWindow =
  | "this_week" | "this_month" | "recently" | "last_60_days" | "last_6_months";

export const EXPLICIT_WINDOW_DAYS: Readonly<Record<ExplicitTimingWindow, number>> = {
  this_week: 7,
  this_month: 30,
  recently: 90,
  last_60_days: 60,
  last_6_months: 180,
};

/**
 * Per-category meaning of a vague window word.
 *
 * "Recently" is relative to how fast the signal decays: "recently funded" means the
 * last quarter, but "recently hiring" means the last month — a four-month-old role
 * is not "recent hiring". Resolving this per category is what keeps the vague word
 * honest instead of applying funding's 90 days to a job post.
 */
const CATEGORY_EXPLICIT_WINDOW_DAYS: Readonly<
  Partial<Record<EvidenceCategory, Partial<Record<ExplicitTimingWindow, number>>>>
> = {
  job_signal: { recently: JOB_DEFAULT_REQUIREMENT_DAYS },   // "recently hiring" ⇒ 30d
};

export function explicitWindowHours(w: ExplicitTimingWindow, category?: EvidenceCategory): number {
  const override = category ? CATEGORY_EXPLICIT_WINDOW_DAYS[category]?.[w] : undefined;
  return DAYS(override ?? EXPLICIT_WINDOW_DAYS[w]);
}

/**
 * Resolve the window that actually applies to a category.
 *
 * Precedence:
 *  - no explicit window        ⇒ the category's DEFAULT requirement window
 *  - an explicit user window   ⇒ that window, capped by the category's RETENTION
 *
 * The explicit constraint wins when stricter ("funded this week" is never widened to
 * 90 days), and may widen up to — but never beyond — retention ("hiring in the last
 * 60 days" reaches 60d even though the default requirement is 30d; "in the last 6
 * months" applied to hiring is still capped at 60d because nothing older is usable).
 */
export function resolveWindowHours(args: {
  category: EvidenceCategory;
  explicitWindow?: ExplicitTimingWindow | null;
}): number | undefined {
  const general = canonicalWindowHoursFor(args.category);
  if (!args.explicitWindow) return general;
  const explicit = explicitWindowHours(args.explicitWindow, args.category);
  const retention = retentionHoursFor(args.category);
  if (retention == null) return explicit;
  return Math.min(retention, explicit);
}
