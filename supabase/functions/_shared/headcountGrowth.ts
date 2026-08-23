// HEADCOUNT GROWTH IS A DELTA, AND A DELTA NEEDS TWO OBSERVATIONS.
//
// ── WHY THIS IS NOT AN ACTOR ────────────────────────────────────────────────
//
// Every other signal in this system is answered by asking a provider. Growth
// cannot be: no registered source returns "this company grew". `harvestapi/
// linkedin-company` returns an authoritative employee COUNT — one number, as of
// now — and the scenario matrix has said since Phase 0 that a single snapshot
// shows hiring, not growth, and that "nothing registered stores history".
//
// So the capability is a TIME SERIES over readings this system already takes,
// and the honest consequence is that a first-ever run cannot answer it. That is
// not a failure to report; it is the actual state of the evidence, and the
// alternative — inferring growth from one number, or from a company's own
// "we're growing!" language — is precisely the fabricated positive that the
// evidence discipline exists to refuse.
//
// ── WHAT THIS MODULE DOES AND DOES NOT DO ──────────────────────────────────
//
// It computes a verdict from snapshots it is GIVEN. It does not read or write
// storage, because persisting snapshots is a schema change that has not been
// made — see `HEADCOUNT_SNAPSHOT_STORAGE_NOTE`. Until it is, callers pass
// whatever history they hold and the verdict is `insufficient_evidence`
// whenever that is fewer than two usable readings, which today is always.
//
// PURE. No network, provider, model or database access.

export const HEADCOUNT_GROWTH_VERSION = "headcount-growth-v1" as const;

/**
 * The storage this capability is waiting on, stated so it cannot be forgotten.
 *
 * Two dated employee counts per company, written whenever `company_enrichment`
 * produces an authoritative `employee_count`. Nothing in the current schema
 * keeps them, so `evaluateHeadcountGrowth` returns `insufficient_evidence` for
 * every company today — truthfully, and by construction rather than by accident.
 */
export const HEADCOUNT_SNAPSHOT_STORAGE_NOTE =
  "Headcount growth needs dated employee-count snapshots per company. No table " +
  "stores them yet, so this capability reports insufficient_evidence until one " +
  "exists. The reading itself is already produced by company_enrichment.";

/** One dated observation of a company's headcount. */
export interface HeadcountSnapshot {
  /** ISO date the count was OBSERVED, not the date the company published it. */
  observed_at: string;
  /**
   * Exact headcount. Must come from enrichment.
   *
   * A provider's band ("11-50") is explicitly not accepted: the catalog marks
   * every band advisory, and differencing two bands produces a number that
   * looks precise and is not.
   */
  employee_count: number;
  /** Which actor produced the reading, for provenance on the verdict. */
  source: string;
}

export type GrowthVerdict =
  /** Two usable readings, and the later one is higher by the required margin. */
  | "growth_confirmed"
  /** Two usable readings, and it did not grow by the required margin. */
  | "no_growth"
  /** Fewer than two usable readings, or they are too close together in time. */
  | "insufficient_evidence";

export interface HeadcountGrowthResult {
  verdict: GrowthVerdict;
  /** The two readings actually compared. Null when there was nothing to compare. */
  from: HeadcountSnapshot | null;
  to: HeadcountSnapshot | null;
  absolute_change: number | null;
  percent_change: number | null;
  days_between: number | null;
  /** A sentence a user can act on. Always populated. */
  reason: string;
}

export interface GrowthRequirement {
  /** Minimum percent increase to count as growth. Default 10%. */
  min_percent?: number;
  /** Minimum days between the two readings. Default 30. */
  min_days_between?: number;
  /** How old the LATEST reading may be. Default 90 days. */
  max_age_days?: number;
}

const DAY_MS = 86_400_000;

function usable(s: HeadcountSnapshot): boolean {
  return Number.isFinite(s?.employee_count) && s.employee_count > 0 &&
    !Number.isNaN(new Date(s?.observed_at ?? "").getTime());
}

/**
 * Decide whether the snapshots show growth.
 *
 * ── EVERY BRANCH THAT RETURNS `insufficient_evidence` ──────────────────────
 *
 * Fewer than two usable readings; two readings taken too close together to
 * distinguish growth from noise; or a latest reading too old to describe the
 * company now. Each is a case where a confident answer would be invented, and
 * each says which one it was so the user knows whether waiting would help.
 */
export function evaluateHeadcountGrowth(
  snapshots: readonly HeadcountSnapshot[],
  req: GrowthRequirement = {},
  now: Date = new Date(),
): HeadcountGrowthResult {
  const minPercent = req.min_percent ?? 10;
  const minDays = req.min_days_between ?? 30;
  const maxAge = req.max_age_days ?? 90;

  const empty: HeadcountGrowthResult = {
    verdict: "insufficient_evidence",
    from: null, to: null,
    absolute_change: null, percent_change: null, days_between: null,
    reason: "",
  };

  const ordered = (snapshots ?? []).filter(usable)
    .slice()
    .sort((a, b) => new Date(a.observed_at).getTime() - new Date(b.observed_at).getTime());

  if (ordered.length < 2) {
    return {
      ...empty,
      to: ordered[0] ?? null,
      reason: ordered.length === 0
        ? "no headcount reading is on record for this company, so growth cannot " +
          "be computed. " + HEADCOUNT_SNAPSHOT_STORAGE_NOTE
        : "only ONE headcount reading is on record. Growth is a difference " +
          "between two dated readings; a single snapshot shows size, never " +
          "change. A second reading at least " + minDays + " days later would " +
          "answer this.",
    };
  }

  const from = ordered[0];
  const to = ordered[ordered.length - 1];
  const days_between = Math.round(
    (new Date(to.observed_at).getTime() - new Date(from.observed_at).getTime()) / DAY_MS);
  const absolute_change = to.employee_count - from.employee_count;
  const percent_change = Number(((absolute_change / from.employee_count) * 100).toFixed(2));

  const base = { from, to, absolute_change, percent_change, days_between };

  if (days_between < minDays) {
    return {
      ...base, verdict: "insufficient_evidence",
      reason: `the two readings are only ${days_between} days apart, below the ` +
        `${minDays}-day minimum. Headcount fluctuates, and a difference over ` +
        `days is noise rather than growth.`,
    };
  }

  const latestAgeDays = Math.round((now.getTime() - new Date(to.observed_at).getTime()) / DAY_MS);
  if (latestAgeDays > maxAge) {
    return {
      ...base, verdict: "insufficient_evidence",
      reason: `the most recent reading is ${latestAgeDays} days old, beyond the ` +
        `${maxAge}-day window. It may describe a company that no longer exists ` +
        `in that shape.`,
    };
  }

  if (percent_change >= minPercent) {
    return {
      ...base, verdict: "growth_confirmed",
      reason: `headcount rose from ${from.employee_count} to ${to.employee_count} ` +
        `(${percent_change}%) over ${days_between} days, from readings dated ` +
        `${from.observed_at.slice(0, 10)} and ${to.observed_at.slice(0, 10)}.`,
    };
  }

  return {
    ...base, verdict: "no_growth",
    reason: `headcount moved from ${from.employee_count} to ${to.employee_count} ` +
      `(${percent_change}%) over ${days_between} days, below the ${minPercent}% ` +
      `threshold. This is a measured NON-result, not a missing one.`,
  };
}

// ── GTM GROWTH ───────────────────────────────────────────────────────────────

/**
 * GTM growth is narrower than headcount growth, and must stay narrower.
 *
 * "The company grew" and "the company grew its commercial team" are different
 * claims, and a lead-gen user asking the second does not want the first: a
 * company that doubled its engineering team is not building a sales motion.
 *
 * So it requires BOTH, and says which half is missing when it fails:
 *   * evidence the company is growing overall — the headcount time series, and
 *   * evidence the growth is COMMERCIAL — an open role in a GTM role family,
 *     which is the hiring signal this system already proves.
 *
 * Nothing here reads a provider. It combines two verdicts this system already
 * produces, which is why GTM growth needs no actor of its own.
 */
export interface GtmGrowthInput {
  headcount: HeadcountGrowthResult;
  /** Role families proven hiring, from verified job evidence. */
  hiring_role_families: readonly string[];
  /** Families that count as commercial. Defaults to the GTM sales family. */
  commercial_families?: readonly string[];
}

export interface GtmGrowthResult {
  verdict: "gtm_growth_confirmed" | "no_gtm_growth" | "insufficient_evidence";
  /** Which halves held, so a partial answer is legible. */
  headcount_growing: boolean;
  commercial_hiring: boolean;
  matched_families: string[];
  reason: string;
}

export const DEFAULT_COMMERCIAL_FAMILIES: readonly string[] =
  Object.freeze(["gtm_sales", "sales_operations", "marketing_growth", "customer_success"]);

export function evaluateGtmGrowth(i: GtmGrowthInput): GtmGrowthResult {
  const commercial = i.commercial_families ?? DEFAULT_COMMERCIAL_FAMILIES;
  const matched_families = (i.hiring_role_families ?? [])
    .filter((f) => commercial.includes(f));
  const commercial_hiring = matched_families.length > 0;
  const headcount_growing = i.headcount.verdict === "growth_confirmed";

  if (i.headcount.verdict === "insufficient_evidence") {
    return {
      verdict: "insufficient_evidence",
      headcount_growing: false, commercial_hiring, matched_families,
      reason: `the growth half is unproven: ${i.headcount.reason}` +
        (commercial_hiring
          ? ` Commercial hiring IS proven (${matched_families.join(", ")}), so only ` +
            `the headcount series is missing.`
          : ` Commercial hiring is also unproven.`),
    };
  }

  if (headcount_growing && commercial_hiring) {
    return {
      verdict: "gtm_growth_confirmed",
      headcount_growing: true, commercial_hiring: true, matched_families,
      reason: `both halves hold: ${i.headcount.reason} And the company is hiring ` +
        `into ${matched_families.join(", ")}, which makes the growth commercial ` +
        `rather than merely numerical.`,
    };
  }

  return {
    verdict: "no_gtm_growth",
    headcount_growing, commercial_hiring, matched_families,
    reason: headcount_growing
      ? "headcount is growing, but no open role is in a commercial family — this " +
        "is company growth, not GTM growth, and the two must not be conflated."
      : commercial_hiring
      ? `there are commercial openings (${matched_families.join(", ")}), but the ` +
        `headcount series does not show growth: ${i.headcount.reason}`
      : "neither headcount growth nor commercial hiring is evidenced.",
  };
}
