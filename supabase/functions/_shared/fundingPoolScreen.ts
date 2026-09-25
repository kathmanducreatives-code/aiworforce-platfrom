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
  /**
   * Search rows discovery may buy over the whole screen: the first page plus
   * the conditional top-up. The run's discovery-row allowance.
   */
  pool_rows: number;
  /** Rows the FIRST page asks for, at the next page this workspace has not read. */
  first_rows: number;
  /**
   * Rows a SECOND, later page may add — only when the first leaves fewer than
   * `fresh_target` fresh, admissible companies (recently checked, placeholders
   * and duplicates are not fresh). Zero = no top-up.
   */
  topup_rows: number;
  /** Fresh admissible companies the screen wants before it stops paging. */
  fresh_target: number;
  /** The most companies ONE Atomus read screens. The rest of a wider pool is closed unscreened. */
  screen_max: number;
  /** Companies admitted to per-candidate spend: the run's `max_candidates`. */
  admit: number;
  scraper_mode: typeof SCREEN_SCRAPER_MODE;
  /** The priced worst case this plan was admitted under. */
  worst_case_usd: number;
  provider_usd: number;
  recently_checked_days: number;
}

export interface FundingScreenPricing {
  first_rows: number;
  topup_rows: number;
  screen_max: number;
  search_usd: number;
  atomus_usd: number;
  /** Per admitted candidate: details + one Pvalyou read + downstream verifiers. */
  per_admitted_usd: number;
  worst_case_usd: number;
}

/** Headroom the priced worst case keeps under `provider_usd`, for per-row estimate rounding. */
export const SCREEN_PRICE_MARGIN_USD = 0.001;
/** The largest later page the screen may add. Bounded: a top-up, never a crawl. */
export const SCREEN_MAX_TOPUP_ROWS = 2;

function price(actor: string, input: Record<string, unknown>): number | null {
  const card = hiringActorCard(actor);
  return card ? estimateCallUsd(actor, card.cost_model, input) : null;
}

/**
 * The screen's worst case for one shape, or null when a part is unpriced.
 *
 * Worst case = the first page + the top-up page (each its own actor start) +
 * ONE Atomus read of `screen` companies + every admitted company paying details,
 * one Pvalyou read and the downstream verifiers.
 */
export function priceFundingScreen(i: {
  first: number; topup: number; screen: number; admit: number;
  /** The downstream claim verifiers' per-target estimates (job search, first-party pages). */
  downstream_verifiers_usd: number | null;
}): FundingScreenPricing | null {
  const first = price(SEARCH, { maxItems: i.first, scraperMode: SCREEN_SCRAPER_MODE });
  const topup = i.topup > 0 ? price(SEARCH, { maxItems: i.topup, scraperMode: SCREEN_SCRAPER_MODE }) : 0;
  const atomus = price(ATOMUS, { companies: Array.from({ length: i.screen }, (_, n) => `${PROBE}-${n}`) });
  const details = price(DETAILS, { companies: [PROBE] });
  const pvalyou = price(PVALYOU, { tier: "basic", companies: ["estimate.com"] });
  if (first == null || topup == null || atomus == null || details == null || pvalyou == null ||
    i.downstream_verifiers_usd == null) {
    return null;
  }
  const perAdmitted = details + pvalyou + i.downstream_verifiers_usd;
  const round = (n: number) => Number(n.toFixed(4));
  return {
    first_rows: i.first, topup_rows: i.topup, screen_max: i.screen,
    search_usd: round(first + topup), atomus_usd: round(atomus),
    per_admitted_usd: round(perAdmitted),
    worst_case_usd: round(first + topup + atomus + i.admit * perAdmitted),
  };
}

/** The mission's HARD recency funding criterion, when it has one with a window. */
export function hardRecencyFundingCriterion(criteria: readonly MissionCriterion[]): MissionCriterion | null {
  return criteria.find((c) => c.kind === "hard" && c.dimension === "funding" &&
    typeof c.time_window?.days === "number" && c.time_window.days > 0) ?? null;
}

/**
 * Should this run screen a wider pool on funding, and in what shape?
 *
 * Off — with the reason — unless the mission has a hard windowed funding claim,
 * the run has a provider budget and a candidate cap, every part is priced, and
 * a shape screening more than `admit` companies fits `provider_usd` with
 * `SCREEN_PRICE_MARGIN_USD` to spare.
 *
 * PREFERENCE: the most companies screened; then a top-up page (fresh candidates
 * when the first page is stale); then the widest first page. A shape without a
 * top-up is taken only when no top-up shape fits.
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
  const cap = b.provider_usd - SCREEN_PRICE_MARGIN_USD + 1e-9;
  const priced: FundingScreenPricing[] = [];
  let best: FundingScreenPricing | null = null;
  // Two passes: every shape WITH a top-up first, then — only if none fits —
  // the single-page shapes.
  shapes:
  for (const topups of [[SCREEN_MAX_TOPUP_ROWS, 1], [0]]) {
    for (let screen = SCREEN_MAX_POOL_ROWS; screen > admit; screen--) {
      for (const topup of topups) {
        for (let first = SCREEN_MAX_POOL_ROWS; first > admit; first--) {
          if (first + topup < screen) continue;
          const p = priceFundingScreen({ first, topup, screen, admit, downstream_verifiers_usd: i.downstream_verifiers_usd });
          if (!p) return { plan: null, reason: "unpriced", priced };
          priced.push(p);
          if (p.worst_case_usd <= cap) { best = p; break shapes; }
        }
      }
    }
  }
  if (!best) return { plan: null, reason: "pool_does_not_fit_provider_usd", priced };
  return {
    plan: {
      version: FUNDING_SCREEN_VERSION, criterion_id: crit.id, window_days: crit.time_window!.days,
      pool_rows: best.first_rows + best.topup_rows, first_rows: best.first_rows, topup_rows: best.topup_rows,
      fresh_target: admit + 1, screen_max: best.screen_max,
      admit, scraper_mode: SCREEN_SCRAPER_MODE,
      worst_case_usd: best.worst_case_usd, provider_usd: b.provider_usd,
      recently_checked_days: SCREEN_RECENTLY_CHECKED_DAYS,
    },
    reason: "screening",
    priced,
  };
}

// ── THE NEXT PAGE THIS WORKSPACE HAS NOT READ ───────────────────────────────
//
// Company search ranks by LinkedIn relevance, which for a filter-only search is
// dominated by follower count: the same filters return the same head, run after
// run (BigRio, How to AI and Psychology Today came back across canaries
// 5bfa76db, 4a0611b0, 16699a45…). Every canary read page 1. Live evidence that
// a later page is genuinely different: task 6e4a93b9 read page 1 (Quark, iQuall)
// and page 2 (3CX, EMQtech) under identical filters — disjoint.

/** LinkedIn's company-search result page. A call reading more rows spans more pages. */
export const LINKEDIN_SEARCH_PAGE_ROWS = 10;
/** The actor's own paging bound (card `input_limits.takePages`). */
export const LINKEDIN_SEARCH_MAX_PAGE = 20;

/** The filters that define "the same search", paging and size of read aside. */
export function searchShape(input: Record<string, unknown>): string {
  const list = (v: unknown) => Array.isArray(v) ? v.map(String).sort() : [];
  return JSON.stringify({
    q: typeof input.searchQuery === "string" ? input.searchQuery.trim().toLowerCase() : "",
    loc: list(input.locations), ind: list(input.industryIds), size: list(input.companySize),
  });
}

/**
 * The first page of `input`'s search no earlier call in `prior` has read:
 * one past the last page any same-shaped call consumed. Page 1 when nothing
 * matches; never past the actor's own bound.
 */
export function nextUnreadPage(prior: readonly Record<string, unknown>[], input: Record<string, unknown>): number {
  const shape = searchShape(input);
  let last = 0;
  for (const p of prior) {
    if (searchShape(p) !== shape) continue;
    const start = Math.max(1, Math.floor(Number(p.startPage ?? 1)) || 1);
    const rows = Math.max(1, Math.floor(Number(p.maxItems ?? 1)) || 1);
    last = Math.max(last, start + Math.ceil(rows / LINKEDIN_SEARCH_PAGE_ROWS) - 1);
  }
  return Math.min(LINKEDIN_SEARCH_MAX_PAGE, last + 1);
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
