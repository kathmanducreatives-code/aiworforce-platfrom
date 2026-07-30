// HOW MANY RAW ROWS TO FETCH FOR A DISCOVERY ROUND.
//
// Production plan 43fb7313 asked for 5 CONTACT-ready leads and sent
// `max_results: 25` / `maxItems: 27` — a constant, unrelated to what remained to
// be delivered. Raw volume legitimately exceeds the lead count (most jobs fail
// the title family, most companies fail the Brain, most companies yield no
// verified decision-maker), but it has to be DERIVED, bounded, and it has to
// shrink as the quota fills.
//
// This is arithmetic over the existing quota, budget and capability limits. It is
// not a second quota authority: it never decides whether a round runs, only how
// wide the round is once the controller has already approved it.
//
// PURE. No network, model, database or environment access.

/** Why the raw figure differs from the ideal. Recorded, never inferred. */
export type BatchClampReason =
  /** The derived figure was used as-is. */
  | "unclamped"
  /** Below the floor a round needs to be worth paying for. */
  | "raised_to_floor"
  /** The capability's own verified ceiling. */
  | "capped_by_source_limit"
  /** What the remaining budget can pay for. */
  | "capped_by_budget"
  /** Quota already satisfied — nothing should be fetched at all. */
  | "quota_met";

export interface DiscoveryBatchInput {
  /** What the user asked for, in CONTACT-ready people. */
  requestedLeads: number;
  /** Still owed, from the CONTACT-only quota authority. */
  remainingLeads: number;
  /** The capability's `maximumResultsPerCall`. */
  sourceMaximum: number;
  /** Budget still available for this run, in USD. */
  remainingBudgetUsd: number;
  /** Cost of one discovery call, in USD. */
  costPerCallUsd: number;
  /**
   * Raw rows per CONTACT-ready lead observed so far on THIS run, when a previous
   * source produced any. Absent on the first round, where the default applies.
   */
  observedRowsPerLead?: number | null;
  /** How many discovery sources have already finished. */
  completedSources?: number;
}

export interface DiscoveryBatchDecision {
  /** Rows to request from the provider. */
  count: number;
  reason: BatchClampReason;
  /** The pre-clamp figure, for the audit trail. */
  derived: number;
  /** Rows-per-lead actually used. */
  multiplier: number;
  /** Echoed so one record explains the whole decision. */
  requestedLeads: number;
  remainingLeads: number;
  sourceMaximum: number;
}

/**
 * Rows needed per CONTACT-ready lead, absent evidence.
 *
 * Deliberately conservative rather than optimistic: an under-sized first round
 * costs one extra bounded round, an over-sized one costs money now and every run
 * after it. Production's own numbers are the calibration — 25 raw rows produced
 * 1 title-family match and 0 verified companies.
 */
export const DEFAULT_ROWS_PER_LEAD = 5;

/** Never pay for a round so small it cannot clear the funnel at all. */
export const MINIMUM_DISCOVERY_BATCH = 10;

/**
 * The widening applied once a source has already come up empty.
 *
 * A second source searching the same titles over a different corpus is worth a
 * wider look, but only once — this is capped, not compounding.
 */
export const LATER_SOURCE_WIDENING = 1.5;

export function decideDiscoveryBatchSize(input: DiscoveryBatchInput): DiscoveryBatchDecision {
  const requestedLeads = Math.max(0, Math.trunc(input.requestedLeads));
  const remainingLeads = Math.max(0, Math.trunc(input.remainingLeads));
  const sourceMaximum = Math.max(1, Math.trunc(input.sourceMaximum));

  const observed = input.observedRowsPerLead;
  const multiplier = Number.isFinite(observed) && (observed as number) > 0
    ? Math.min(20, observed as number)
    : DEFAULT_ROWS_PER_LEAD;

  const base = {
    multiplier, requestedLeads, remainingLeads, sourceMaximum,
  };

  // QUOTA MET ENDS SOURCING. Not a clamp — a stop.
  if (remainingLeads === 0) {
    return { count: 0, reason: "quota_met", derived: 0, ...base };
  }

  const widening = (input.completedSources ?? 0) > 0 ? LATER_SOURCE_WIDENING : 1;
  const derived = Math.ceil(remainingLeads * multiplier * widening);

  // Budget first: it is the only bound that can make a round unpayable.
  const affordable = input.costPerCallUsd > 0 && input.remainingBudgetUsd < input.costPerCallUsd
    ? 0
    : sourceMaximum;
  if (affordable === 0) {
    return { count: 0, reason: "capped_by_budget", derived, ...base };
  }

  if (derived > sourceMaximum) {
    return { count: sourceMaximum, reason: "capped_by_source_limit", derived, ...base };
  }
  if (derived < MINIMUM_DISCOVERY_BATCH) {
    // The floor itself must still respect the source ceiling.
    const floored = Math.min(MINIMUM_DISCOVERY_BATCH, sourceMaximum);
    return {
      count: floored,
      reason: floored === sourceMaximum && sourceMaximum < MINIMUM_DISCOVERY_BATCH
        ? "capped_by_source_limit"
        : "raised_to_floor",
      derived, ...base,
    };
  }
  return { count: derived, reason: "unclamped", derived, ...base };
}

/** The safe record of one batch decision. Numbers and a reason code only. */
export function batchDecisionDiagnostics(d: DiscoveryBatchDecision): Record<string, unknown> {
  return {
    requested_leads: d.requestedLeads,
    remaining_leads: d.remainingLeads,
    discovery_count: d.count,
    derived_count: d.derived,
    rows_per_lead: d.multiplier,
    clamping_reason: d.reason,
    provider_limit: d.sourceMaximum,
  };
}
