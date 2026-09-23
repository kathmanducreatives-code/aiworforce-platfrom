// A RUN'S OWN BUDGET — WHICH MAY ONLY EVER BE SMALLER.
//
// ── THE TWO DEFECTS THIS CLOSES ────────────────────────────────────────────
//
// 1. A ONE-LEAD CANARY WAS PRICED LIKE A TEN-LEAD RUN. run-agent sized every
//    discovery pool as `Math.max(10, requestedLeadCount * 10)`. That floor of
//    ten is a healthy over-discovery margin for a real mission, and it is the
//    WHOLE cost of a bounded probe: funding discovery bills per record at the
//    highest row price in the catalog (see its card), so "find 1 lead" bought
//    ten records before any verification ran.
//
// 2. THERE WAS NO WAY FOR A RUN TO SAY WHAT IT MAY SPEND. The spend ledger has
//    always refused a call whose estimate would breach a ceiling, BEFORE the
//    call (`budgetPolicy.reserve`). But the ceilings were always the defaults
//    (`DEFAULT_CEILINGS`), whose mission and funding-route limits are sized for
//    a real mission, so that ten-record call cleared every check. Provider
//    credits count CALLS, not dollars, and model spend is capped separately;
//    nothing held provider dollars to what the person running the mission
//    actually approved.
//
// ── TIGHTEN-ONLY, BY CONSTRUCTION ──────────────────────────────────────────
//
// A client may already not name a `budget`, `budget_override` or `max_spend`
// (run-agent ignores them) and a model proposal may not either (the compiler's
// safety scanner refuses them), because a budget a client can RAISE is spend a
// client can authorise. `run_budget` cannot raise anything: every value it
// carries is combined with the default by `min`, so the worst a hostile or
// mistaken value can do is make a run buy less. Absent — the default for every
// ordinary mission — nothing changes.
//
// Pure: no I/O, no environment.

import type { Ceilings } from "./budgetPolicy.ts";

export const RUN_BUDGET_VERSION = "run-budget-v1" as const;

export interface RunBudget {
  /** The most this run may spend on providers, in USD. Never raises a ceiling. */
  provider_usd: number | null;
  /** The most candidates discovery may buy. Never raises the pool, never below the leads owed. */
  max_candidates: number | null;
}

/** The over-discovery margin a normal mission keeps: ten raw rows per lead, at least ten. */
export const DISCOVERY_ROWS_PER_LEAD = 10;
export const MIN_DISCOVERY_POOL = 10;

const positive = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;

/**
 * Read a `run_budget` from a request, or null.
 *
 * Anything that is not a positive finite number is DROPPED, not coerced: a
 * string "0.10", a negative, a zero or an Infinity names no budget at all,
 * and treating it as one would be guessing what the caller meant with money.
 */
export function parseRunBudget(raw: unknown): RunBudget | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const provider_usd = positive(r.provider_usd);
  const cand = positive(r.max_candidates);
  const max_candidates = cand === null ? null : Math.floor(cand) >= 1 ? Math.floor(cand) : null;
  if (provider_usd === null && max_candidates === null) return null;
  return { provider_usd, max_candidates };
}

/**
 * How many candidates discovery may buy.
 *
 * Without a budget this is exactly the old `Math.max(10, requested * 10)`.
 * With one, it is lowered to `max_candidates` — but never below the leads
 * still owed (a pool smaller than the request cannot fill it) and never above
 * the default (a budget cannot widen discovery).
 */
export function candidatePool(requestedLeadCount: number, b: RunBudget | null): number {
  const requested = Math.max(1, Math.floor(Number.isFinite(requestedLeadCount) ? requestedLeadCount : 1));
  const normal = Math.max(MIN_DISCOVERY_POOL, requested * DISCOVERY_ROWS_PER_LEAD);
  if (!b || b.max_candidates === null) return normal;
  return Math.min(normal, Math.max(requested, b.max_candidates));
}

/**
 * The ceilings a run is held to: the base, lowered by the budget.
 *
 * The mission's provider ceiling becomes `min(base, provider_usd)`, and no
 * route or single call may exceed it either — a small run cannot hold the
 * default funding route open. Model ceilings are untouched: model spend has its
 * own cap (`MODEL_SPEND_CEILING_USD`), and folding the two together would let
 * one starve the other.
 */
export function tightenCeilings(base: Ceilings, b: RunBudget | null): Ceilings {
  if (!b || b.provider_usd === null) return base;
  const cap = Math.min(base.mission_provider_usd, b.provider_usd);
  const lower = <T extends Record<string, number | undefined>>(o: T): T =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v == null ? v : Math.min(v, cap)])) as T;
  return {
    ...base,
    mission_provider_usd: cap,
    per_route_usd: lower(base.per_route_usd),
    per_call_usd: lower(base.per_call_usd as Record<string, number | undefined>) as Ceilings["per_call_usd"],
    per_candidate_evidence_usd: Math.min(base.per_candidate_evidence_usd, cap),
  };
}
