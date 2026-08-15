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
export interface LineageProgress {
  version: typeof AUTO_CONTINUATION_VERSION;
  continuations_used: number;
  cost_units_used: number;
  barren_slices: number;
  /** Highest qualified count observed. Never allowed to fall — see below. */
  qualified_high_water: number;
  investigated_total: number;
  stopped_reason: StopReason | null;
  stopped_detail: string | null;
}

export function newLineageProgress(): LineageProgress {
  return {
    version: AUTO_CONTINUATION_VERSION,
    continuations_used: 0, cost_units_used: 0, barren_slices: 0,
    qualified_high_water: 0, investigated_total: 0,
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
  slice: {
    qualified: number;
    investigated: number;
    costUnits: number;
  },
): LineageProgress {
  const qualifiedDelta = slice.qualified - prior.qualified_high_water;
  const barren = sliceWasBarren({
    qualifiedDelta,
    investigatedDelta: slice.investigated,
  });
  return {
    ...prior,
    continuations_used: prior.continuations_used + 1,
    cost_units_used: prior.cost_units_used + Math.max(0, slice.costUnits),
    barren_slices: barren ? prior.barren_slices + 1 : 0,
    qualified_high_water: Math.max(prior.qualified_high_water, slice.qualified),
    investigated_total: prior.investigated_total + Math.max(0, slice.investigated),
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
    investigated_total: n(o.investigated_total),
    stopped_reason: (o.stopped_reason as StopReason | null) ?? null,
    stopped_detail: typeof o.stopped_detail === "string" ? o.stopped_detail : null,
  };
}
