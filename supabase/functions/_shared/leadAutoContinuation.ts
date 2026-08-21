// THE USER'S REQUEST IS THE JOB, NOT THE INVOCATION.
//
// "Find 10 qualified AI startups in the US hiring software engineers" is one
// job. An edge invocation is a ~125s slice of it. Those are different things,
// and until now the product conflated them: a run investigated what one slice
// allowed, checkpointed the rest, and stopped — leaving the user to press
// Continue for a second slice that, across 202 tasks, nobody ever pressed and
// nothing ever triggered.
//
// This module owns the decision to take another slice AUTOMATICALLY, and every
// condition that must stop it. It is PURE: no network, no database, no clock of
// its own. `run-agent` asks it what to do and performs the dispatch, so the
// stopping rules can be exercised exhaustively without spending a penny.
//
// ── WHY A SEPARATE DECISION FROM `shouldTakeAnotherSlice` ─────────────────────
//
// That one decides whether THIS invocation has time for another slice. This one
// decides whether ANOTHER INVOCATION should exist at all. The first is bounded
// by the wall clock; the second is bounded by money, by lineage depth, and by
// whether the last slice actually achieved anything. Merging them would mean a
// run that is out of time and a run that is out of pool stop for the same
// reason, which is exactly the confusion the funnel work exists to remove.

export const AUTO_CONTINUATION_VERSION = "lead-auto-continuation-v1" as const;

/**
 * Where the running totals live on `tasks.result`.
 *
 * Beside `lead_resume_lineage_root`, and for the same reason: a continuation
 * reuses the task row, so anything the NEXT slice needs has to survive on it.
 */
export const LINEAGE_PROGRESS_KEY = "lead_lineage_progress" as const;

/**
 * How many continuations one request may spawn.
 *
 * A slice investigates ~10 companies and qualifies ~4, so ten continuations is
 * ~100 companies of investigation — the whole default discovery pool. Past that
 * the pool, not the ceiling, should be what stops the run.
 */
export const DEFAULT_MAX_CONTINUATIONS = 10;
export const MAX_CONTINUATIONS_CAP = 25;
export const MAX_CONTINUATIONS_ENV = "LEAD_MAX_AUTO_CONTINUATIONS";

/**
 * Provider cost units one REQUEST may spend across every slice.
 *
 * The per-invocation budget bounds a slice; this bounds the job. Without it,
 * "keep going until you have ten" is an unbounded instruction to spend money.
 */
export const DEFAULT_MAX_LINEAGE_COST_UNITS = 120;
export const MAX_LINEAGE_COST_UNITS_ENV = "LEAD_MAX_LINEAGE_COST_UNITS";

/**
 * How many consecutive slices may achieve nothing before the run stops.
 *
 * One barren slice is ordinary — a batch of candidates whose identities do not
 * resolve. Two in a row means the frontier is not yielding, and continuing to
 * pay for it is how an honest shortfall turns into an expensive one.
 */
export const MAX_BARREN_SLICES = 2;

export type StopReason =
  | "quota_met"
  | "frontier_exhausted"
  | "continuation_ceiling"
  | "cost_ceiling"
  | "no_progress"
  | "provider_failure"
  | "cancelled"
  /**
   * The job wanted to continue and the handoff did not happen — a refused or
   * unreachable dispatch. Its own reason because it is a fault in OUR plumbing,
   * not a finding about the candidates, and conflating it with
   * `provider_failure` blames Apify for a bug in the continuation path.
   */
  | "dispatch_failed";

export interface AutoContinuationInput {
  /** Qualified companies PERSISTED so far, across every slice of this request. */
  qualified: number;
  requestedCount: number;
  /** Candidates still `pending_investigation`. */
  frontierRemaining: number;
  /** How many continuations this request has already spawned. */
  continuationsUsed: number;
  maxContinuations: number;
  /** Provider cost units spent across the whole request. */
  costUnitsUsed: number;
  maxCostUnits: number;
  /**
   * Consecutive slices that neither qualified anybody nor investigated anybody.
   * Reset to zero by any slice that does either.
   */
  barrenSlices: number;
  /** The last slice ended on a provider failure. */
  providerFailed?: boolean;
  cancelled?: boolean;
}

export interface AutoContinuationDecision {
  continue: boolean;
  reason: StopReason | "quota_unmet_frontier_remains";
  detail: string;
  /** What the Workbench should say while the next slice runs. */
  user_message: string | null;
}

const stop = (
  reason: StopReason, detail: string,
): AutoContinuationDecision => ({ continue: false, reason, detail, user_message: null });

/**
 * Should another slice run automatically?
 *
 * ORDER IS MEANING. Cancellation first, because a user who stopped the run must
 * not be billed for one more slice. Then the target, because reaching it is the
 * only ending that is a success. Then the pool, because an exhausted frontier is
 * an honest shortfall no amount of further spending can improve. Only then the
 * ceilings, which are protections rather than findings — a run that stops on one
 * of them has NOT established anything about the remaining candidates, and the
 * detail string says so.
 */
export function decideAutoContinuation(
  i: AutoContinuationInput,
): AutoContinuationDecision {
  if (i.cancelled) return stop("cancelled", "the request was cancelled");

  if (i.qualified >= i.requestedCount) {
    return stop("quota_met",
      `${i.qualified} of ${i.requestedCount} qualified — the request is met`);
  }

  // AN EXHAUSTED POOL IS A REAL ANSWER. Everything discovered has been
  // investigated or decided; a further slice has nothing to look at.
  if (i.frontierRemaining <= 0) {
    return stop("frontier_exhausted",
      `every discovered candidate has been investigated; ` +
      `${i.qualified} of ${i.requestedCount} qualified`);
  }

  if (i.providerFailed) {
    return stop("provider_failure",
      "the last slice ended on a provider failure; the frontier is preserved");
  }

  // NOTHING TWICE RUNNING IS EVIDENCE. See `MAX_BARREN_SLICES`.
  if (i.barrenSlices >= MAX_BARREN_SLICES) {
    return stop("no_progress",
      `${i.barrenSlices} consecutive slices qualified and investigated nobody; ` +
      `${i.frontierRemaining} candidates remain unexamined`);
  }

  if (i.continuationsUsed >= i.maxContinuations) {
    return stop("continuation_ceiling",
      `${i.continuationsUsed} of ${i.maxContinuations} continuations used; ` +
      `${i.frontierRemaining} candidates remain unexamined`);
  }

  if (i.costUnitsUsed >= i.maxCostUnits) {
    return stop("cost_ceiling",
      `${i.costUnitsUsed} of ${i.maxCostUnits} provider cost units spent; ` +
      `${i.frontierRemaining} candidates remain unexamined`);
  }

  const need = i.requestedCount - i.qualified;
  return {
    continue: true,
    reason: "quota_unmet_frontier_remains",
    detail:
      `${i.qualified} of ${i.requestedCount} qualified, ${i.frontierRemaining} ` +
      `candidates still to investigate`,
    // WHAT THE USER SEES WHILE IT WORKS. They asked once and are waiting; the
    // Workbench must say the run is continuing rather than that it stopped.
    user_message:
      `Continuing automatically — ${i.qualified} of ${i.requestedCount} qualified, ` +
      `looking for ${need} more across ${i.frontierRemaining} remaining companies.`,
  };
}

/**
 * Did this slice achieve anything at all?
 *
 * Investigating somebody counts even when nobody qualified: the frontier moved
 * and the next slice sees a different set. Only a slice that did neither is
 * barren.
 */
export function sliceWasBarren(
  i: { qualifiedDelta: number; investigatedDelta: number },
): boolean {
  return i.qualifiedDelta <= 0 && i.investigatedDelta <= 0;
}

type EnvReader = (key: string) => string | undefined;

const readInt = (
  read: EnvReader, key: string, fallback: number, cap: number,
): number => {
  const raw = Number(read(key));
  if (!Number.isFinite(raw) || raw < 1) return fallback;
  return Math.min(cap, Math.trunc(raw));
};

export function resolveMaxContinuations(read?: EnvReader): number {
  const get: EnvReader = read ?? ((k) => {
    try { return Deno.env.get(k); } catch { return undefined; }
  });
  return readInt(get, MAX_CONTINUATIONS_ENV, DEFAULT_MAX_CONTINUATIONS, MAX_CONTINUATIONS_CAP);
}

export function resolveMaxLineageCostUnits(read?: EnvReader): number {
  const get: EnvReader = read ?? ((k) => {
    try { return Deno.env.get(k); } catch { return undefined; }
  });
  return readInt(
    get, MAX_LINEAGE_COST_UNITS_ENV, DEFAULT_MAX_LINEAGE_COST_UNITS, 1_000);
}

/**
 * The running totals a request carries from slice to slice.
 *
 * Persisted on the task row so a continuation inherits them. Without this the
 * ceilings reset every slice and none of them bounds anything.
 */
/**
 * ── EVERY COUNT HERE IS ALREADY LINEAGE-CUMULATIVE ──────────────────────────
 *
 * THE DEFECT THIS SHAPE EXISTS TO END. `CapabilityExecutionState` is spread
 * from the checkpoint on every continuation (`leadCapabilityEngine.ts`, "state
 * = stateMatchesMission ? { ...opts.state } : newExecutionState"), so
 * `accumulated_cost_units` and `investigation_selected` do not reset — they are
 * running totals for the WHOLE lineage. `foldSlice` then ADDED them to running
 * totals of its own, once per slice, producing a sum of successive cumulative
 * snapshots. That is not a quantity of anything.
 *
 * Measured against the execution ledger, where one paid provider call is one
 * cost unit:
 *
 *     plan        provider calls    cost_units_used    continuations
 *     747ff464                 6                158                6
 *     a5332734                27                127                6
 *     958c86bc                29                124                5
 *     66554ea2                28                 58                3
 *     44c9c5c0                18                 27                2
 *
 * The inflation tracks the continuation count exactly. This was not a reporting
 * blemish: `a5332734` and `958c86bc` were both TERMINATED by the 120-unit
 * ceiling — "127 of 120 provider cost units spent; 78 candidates remain
 * unexamined" — after 27 and 29 real calls. The budget guard was killing runs
 * on money nobody had spent.
 *
 * So the rule for this record is now uniform and stated once: a cumulative
 * input is folded with MAX, never with addition. `max` is also self-healing —
 * if a slice ever arrives with a reset state (a mission-hash mismatch rebuilds
 * it from zero) the lineage keeps the higher figure, because the money was
 * still spent.
 *
 * `continuations_used` is the one true per-call increment and stays `+ 1`.
 */
export interface LineageProgress {
  version: typeof AUTO_CONTINUATION_VERSION;
  continuations_used: number;
  /** Cumulative paid provider work across the lineage. Governs the ceiling. */
  cost_units_used: number;
  barren_slices: number;
  /** Highest qualified count observed. Never allowed to fall — see below. */
  qualified_high_water: number;
  /**
   * DISTINCT companies carried to a terminal investigation state.
   *
   * A COMPANY count. Derived from the working set, which is deduplicated by
   * construction and survives continuation, so a company investigated in slice
   * one is not counted again in slice four.
   *
   * Replaces `investigated_total`, which was none of those things: it summed
   * `investigation_selected`, a SPEND counter that deliberately re-counts
   * carried in-flight work ("this invocation buys those searches too"), across
   * every slice. It reported 40, 148, 360 and 406 against a pool of 100.
   */
  unique_companies_investigated: number;
  /**
   * AUTHORISATIONS, not companies — the other half of what the old field
   * conflated.
   *
   * `investigation_selected` counts every time this lineage authorised paying
   * to investigate a company, INCLUDING re-authorising work carried in flight
   * from an earlier pass. That is the right definition for a spend question and
   * the wrong one for "how many companies did we look at", so it now has its
   * own name and both questions can be answered.
   */
  investigation_authorisations: number;
  stopped_reason: StopReason | null;
  stopped_detail: string | null;
}

export function newLineageProgress(): LineageProgress {
  return {
    version: AUTO_CONTINUATION_VERSION,
    continuations_used: 0, cost_units_used: 0, barren_slices: 0,
    qualified_high_water: 0,
    unique_companies_investigated: 0, investigation_authorisations: 0,
    stopped_reason: null, stopped_detail: null,
  };
}

/**
 * Fold one slice's result into the request's running totals.
 *
 * `qualified_high_water` is a MAXIMUM, not an assignment. A slice that evaluates
 * nobody reports zero qualified, and letting that overwrite the total is the
 * same defect the multi-round controller had — a barren round erasing a
 * productive one. Qualified companies are persisted; the count may not regress.
 */
export function foldSlice(
  prior: LineageProgress,
  /**
   * EVERY FIELD IS THE LINEAGE-CUMULATIVE VALUE AS THIS SLICE LEFT IT, and each
   * name says so. The old parameter was `{ qualified, investigated, costUnits }`
   * — three names that read as per-slice deltas while every caller passed a
   * cumulative total, which is precisely how the addition below became a sum of
   * snapshots. A name that lies is how the next person reintroduces this.
   */
  slice: {
    /** Distinct qualified companies in the pool. */
    qualifiedInPool: number;
    /** Distinct companies at a terminal investigation state, from the working set. */
    uniqueCompaniesInvestigatedInPool: number;
    /** Every authorisation this lineage has made, carried work included. */
    authorisationsInPool: number;
    /** Paid provider cost units accumulated across the lineage. */
    costUnitsInLineage: number;
  },
): LineageProgress {
  // DELTAS ARE DERIVED HERE, from cumulative in and cumulative held. They are
  // not asked for, because a caller that has to compute one will eventually
  // compute it wrong — `sliceWasBarren` was documented as taking a delta and
  // handed a cumulative count, so no slice after the first could ever be
  // barren. Every run this year reported `barren_slices: 0`, including
  // lineages whose last four slices selected nobody at all.
  const qualifiedDelta = slice.qualifiedInPool - prior.qualified_high_water;
  const investigatedDelta =
    slice.uniqueCompaniesInvestigatedInPool - prior.unique_companies_investigated;
  const barren = sliceWasBarren({ qualifiedDelta, investigatedDelta });
  const keepHigher = (was: number, now: number) => Math.max(was, Math.max(0, now));
  return {
    ...prior,
    // The one true per-call increment.
    continuations_used: prior.continuations_used + 1,
    cost_units_used: keepHigher(prior.cost_units_used, slice.costUnitsInLineage),
    barren_slices: barren ? prior.barren_slices + 1 : 0,
    qualified_high_water: keepHigher(prior.qualified_high_water, slice.qualifiedInPool),
    unique_companies_investigated: keepHigher(
      prior.unique_companies_investigated, slice.uniqueCompaniesInvestigatedInPool),
    investigation_authorisations: keepHigher(
      prior.investigation_authorisations, slice.authorisationsInPool),
  };
}

export function readLineageProgress(raw: unknown): LineageProgress {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const n = (v: unknown) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 ? Math.trunc(x) : 0;
  };
  return {
    version: AUTO_CONTINUATION_VERSION,
    continuations_used: n(o.continuations_used),
    cost_units_used: n(o.cost_units_used),
    barren_slices: n(o.barren_slices),
    qualified_high_water: n(o.qualified_high_water),
    // THE OLD FIELD IS DELIBERATELY NOT READ. A pre-split checkpoint holds
    // `investigated_total`, and its value is a sum of cumulative snapshots —
    // seeding a COMPANY count with it would pin the lineage to a meaningless
    // number for good, because `foldSlice` only ever moves these up. Starting a
    // resumed legacy lineage at zero and re-deriving from the working set is
    // strictly more correct: the working set is the thing that actually knows.
    //
    // `cost_units_used` IS still read, and a legacy value there is inflated by
    // the same defect. That errs toward stopping a resumed run early rather
    // than overspending on it, which is the right direction to be wrong in.
    unique_companies_investigated: n(o.unique_companies_investigated),
    investigation_authorisations: n(o.investigation_authorisations),
    stopped_reason: (o.stopped_reason as StopReason | null) ?? null,
    stopped_detail: typeof o.stopped_detail === "string" ? o.stopped_detail : null,
  };
}
