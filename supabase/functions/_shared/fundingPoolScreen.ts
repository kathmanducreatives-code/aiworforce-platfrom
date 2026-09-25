// LEAD V2 — SCREEN A WIDER POOL ON FUNDING BEFORE ADMITTING CANDIDATES.
//
// ── THE RUNS THIS EXISTS FOR ────────────────────────────────────────────────
//
// Canaries 1156c062, 5bfa76db, 4a0611b0 and 021d4987 (2026-09-24/25) asked for
// US B2B SaaS, declared size 11–50, funded within 365 days, hiring a growth
// role. Company search cannot target funding: `searchQuery` matches NAMES, the
// industry filter is loose, and the most-followed companies come first, so the
// same media brands came back run after run (How to AI, Psychology Today,
// Design Milk, Towards Data Science). Discovery bought exactly `max_candidates`
// rows, so every run paid details, Atomus — and since the fallback, Pvalyou —
// for the two companies at the head of that list. 0 of 21 funding checks
// passed.
//
// ── WHAT CHANGES ────────────────────────────────────────────────────────────
//
// When a HARD recency funding claim is the mission's most selective gate and
// the run carries a budget, discovery buys a wider SHORT-mode pool (cheap rows,
// the declared-size filter still applied by the provider) and ONE batched Atomus
// read screens it before anything per-candidate is bought:
//
//   funding FAIL (complete history, nothing recent)   closed — a hard claim failed
//   funding PASS (a verified dated round in window)   admitted first
//   still PENDING                                      admitted after the passes
//   checked by this workspace recently                 not screened again
//
// Only `admit` companies — the run's `max_candidates` — then go on to identity,
// details and the claim verifiers. `max_candidates` therefore caps the
// companies that receive PER-CANDIDATE spend; the screened pool is priced into
// `provider_usd` here, before discovery, or the screen does not run.
//
// ── WHAT DOES NOT CHANGE ────────────────────────────────────────────────────
//
// Evidence authority: the screen records Atomus exactly as the funding verifier
// does (it IS the funding verifier, with its fallback off), and eligibility
// decides from that record as it always has. Pvalyou stays the conditional
// Atomus fallback, asked later only for an ADMITTED company Atomus left open.
//
// PURE. No network, provider, model or database access.

import type { MissionCriterion } from "./missionCriteria.ts";
import { candidatePool, type RunBudget } from "./runBudget.ts";
import { estimateCallUsd } from "./budgetPolicy.ts";
import { hiringActorCard } from "./hiringActorCatalog.ts";

export const FUNDING_SCREEN_VERSION = "funding-pool-screen-v1" as const;
/** The widest pool the screen buys. Bounded again by what `provider_usd` affords. */
export const SCREEN_MAX_POOL_ROWS = 5;
/** Short rows cost half a full row; the provider still applies the declared-size filter. */
export const SCREEN_SCRAPER_MODE = "short" as const;
/** A company this workspace funding-checked within this many days is not screened again. */
export const SCREEN_RECENTLY_CHECKED_DAYS = 30;

const SEARCH = "apify_linkedin_company_search";
const DETAILS = "apify_linkedin_company_details";
const ATOMUS = "apify_funding_atomus";
const PVALYOU = "apify_funding_pvalyou";
const PROBE = "https://www.linkedin.com/company/estimate";

export interface FundingScreenPlan {
  version: typeof FUNDING_SCREEN_VERSION;
  criterion_id: string;
  window_days: number;
  /** Search rows discovery buys, and the most companies Atomus screens. */
  pool_rows: number;
  /** Companies admitted to per-candidate spend: the run's `max_candidates`. */
  admit: number;
  scraper_mode: typeof SCREEN_SCRAPER_MODE;
  /** The priced worst case this plan was admitted under. */
  worst_case_usd: number;
  provider_usd: number;
  recently_checked_days: number;
}

export interface FundingScreenPricing {
  pool_rows: number;
  search_usd: number;
  atomus_usd: number;
  /** Per admitted candidate: details + one Pvalyou read + downstream verifiers. */
  per_admitted_usd: number;
  worst_case_usd: number;
}

function price(actor: string, input: Record<string, unknown>): number | null {
  const card = hiringActorCard(actor);
  return card ? estimateCallUsd(actor, card.cost_model, input) : null;
}

/** The screen's worst case for a pool of `rows`, or null when a part is unpriced. */
export function priceFundingScreen(i: {
  rows: number; admit: number;
  /** The downstream claim verifiers' per-target estimates (job search, first-party pages). */
  downstream_verifiers_usd: number | null;
}): FundingScreenPricing | null {
  const search = price(SEARCH, { maxItems: i.rows, scraperMode: SCREEN_SCRAPER_MODE });
  const atomus = price(ATOMUS, { companies: Array.from({ length: i.rows }, (_, n) => `${PROBE}-${n}`) });
  const details = price(DETAILS, { companies: [PROBE] });
  const pvalyou = price(PVALYOU, { tier: "basic", companies: ["estimate.com"] });
  if (search == null || atomus == null || details == null || pvalyou == null || i.downstream_verifiers_usd == null) {
    return null;
  }
  const perAdmitted = details + pvalyou + i.downstream_verifiers_usd;
  const round = (n: number) => Number(n.toFixed(4));
  return {
    pool_rows: i.rows, search_usd: round(search), atomus_usd: round(atomus),
    per_admitted_usd: round(perAdmitted),
    worst_case_usd: round(search + atomus + i.admit * perAdmitted),
  };
}

/** The mission's HARD recency funding criterion, when it has one with a window. */
export function hardRecencyFundingCriterion(criteria: readonly MissionCriterion[]): MissionCriterion | null {
  return criteria.find((c) => c.kind === "hard" && c.dimension === "funding" &&
    typeof c.time_window?.days === "number" && c.time_window.days > 0) ?? null;
}

/**
 * Should this run screen a wider pool on funding, and how wide?
 *
 * Off — with the reason — unless the mission has a hard windowed funding claim,
 * the run has a provider budget and a candidate cap, every part is priced, and
 * a pool wider than `admit` fits the budget. The widest pool that fits is taken,
 * up to `SCREEN_MAX_POOL_ROWS`.
 */
export function fundingScreenPlan(i: {
  criteria: readonly MissionCriterion[];
  runBudget: RunBudget | null;
  requestedCount: number;
  downstream_verifiers_usd: number | null;
}): { plan: FundingScreenPlan | null; reason: string; priced: FundingScreenPricing[] } {
  const crit = hardRecencyFundingCriterion(i.criteria);
  if (!crit) return { plan: null, reason: "no_hard_windowed_funding_claim", priced: [] };
  const b = i.runBudget;
  if (!b || b.provider_usd == null || b.max_candidates == null) {
    return { plan: null, reason: "no_run_budget", priced: [] };
  }
  const admit = candidatePool(i.requestedCount, b);
  const priced: FundingScreenPricing[] = [];
  let best: FundingScreenPricing | null = null;
  for (let rows = admit + 1; rows <= SCREEN_MAX_POOL_ROWS; rows++) {
    const p = priceFundingScreen({ rows, admit, downstream_verifiers_usd: i.downstream_verifiers_usd });
    if (!p) return { plan: null, reason: "unpriced", priced };
    priced.push(p);
    if (p.worst_case_usd <= b.provider_usd + 1e-9) best = p;
  }
  if (!best) return { plan: null, reason: "pool_does_not_fit_provider_usd", priced };
  return {
    plan: {
      version: FUNDING_SCREEN_VERSION, criterion_id: crit.id, window_days: crit.time_window!.days,
      pool_rows: best.pool_rows, admit, scraper_mode: SCREEN_SCRAPER_MODE,
      worst_case_usd: best.worst_case_usd, provider_usd: b.provider_usd,
      recently_checked_days: SCREEN_RECENTLY_CHECKED_DAYS,
    },
    reason: "screening",
    priced,
  };
}

export type ScreenVerdict = "pass" | "fail" | "pending";

/**
 * Admission order after the screen: passes, then pending, each in the order
 * the free ranking already gave them. A FAIL is never admitted.
 */
export function screenAdmissionOrder<T extends { key: string; rank: number; verdict: ScreenVerdict }>(
  xs: readonly T[],
): T[] {
  const weight = (v: ScreenVerdict) => v === "pass" ? 0 : v === "pending" ? 1 : 2;
  return xs.filter((x) => x.verdict !== "fail")
    .sort((a, b) => weight(a.verdict) - weight(b.verdict) || a.rank - b.rank || a.key.localeCompare(b.key));
}

/**
 * LinkedIn company pages this workspace's EARLIER tasks funding-checked with
 * Atomus, from their ledger rows. The current task is excluded: its own screen
 * is idempotent through the operation mark, not through this set.
 */
export function recentlyCheckedPages(
  rows: ReadonlyArray<{ task_id: string | null; candidate_keys: unknown }>, currentTaskId: string,
): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    if (r.task_id === currentTaskId || !Array.isArray(r.candidate_keys)) continue;
    for (const k of r.candidate_keys) {
      const m = typeof k === "string" ? /linkedin\.com\/company\/([^/?#]+)/i.exec(k) : null;
      if (m) out.add(`https://www.linkedin.com/company/${m[1].toLowerCase()}`);
    }
  }
  return out;
}
