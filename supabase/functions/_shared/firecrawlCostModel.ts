// WHAT A FIRECRAWL CALL COST, AND HOW WE KNOW.
//
// ── THE STATE THIS REPLACES ─────────────────────────────────────────────────
//
// 229 Firecrawl rows in `lead_execution_calls`, 214 of them successful, every
// one `cost_source: "unknown"` and `actual_cost_usd: null`. Apify, beside it,
// reports a real charge on 956 rows totalling $19.01. So one of the two paid
// providers could not be budgeted, alerted on, or billed back — and the spend
// ceiling that sums the ledger was, for Firecrawl, summing nothing.
//
// The cause was structural, not neglect: `priceProviderCall` prices from
// `hiringActorCard(actorKey)`, and Firecrawl has no actor key. It arrived with
// `actorKey: ""`, matched no card, and fell through to `unknown` — which was at
// least honest, and stayed honest for three weeks.
//
// ── WHY THIS CANNOT REACH `provider_reported` ───────────────────────────────
//
// `provider_reported` means the provider stated a CHARGE for this call, and the
// database enforces that it is the only grade allowed into `actual_cost_usd`.
// Firecrawl never states dollars. Its `/crawl` status endpoint reports
// `creditsUsed`, and `/scrape` reports nothing at all — verified against the
// API reference on 2026-09-10, where `ScrapeResponse` carries only
// `success`, `data` and `warning`.
//
// Credits are not money until a plan is known, so the highest grade this can
// honestly reach is `event_priced`: computed from a verified rate and the
// quantity this call actually consumed. That is the same grade the Apify cards
// earn, and for the same reason.
//
// ── WHY THE DOLLAR RATE IS CONFIGURATION AND NOT A CONSTANT ─────────────────
//
// Firecrawl bills per credit, and the credits a dollar buys depend on the plan:
// the published tiers list monthly credit allowances as RANGES (Hobby
// 5,000–8,000, Standard 100,000–160,000, Growth 500,000–650,000, Scale
// 1,000,000) and the billing page does not publish a per-credit price at all.
// A single number hard-coded here would be a guess dressed as a rate, which is
// exactly what `UNPRICED_MODELS` refuses to do for the gateway models.
//
// So the rate is read from `FIRECRAWL_USD_PER_CREDIT`, and when it is unset the
// cost is `unknown` — NOT zero. The credit COUNT is recorded either way, so the
// spend is countable even while it is unpriced, and turning pricing on is a
// config change against a number somebody has read off an invoice.
//
// PURE. No network, no database, no clock.

import type { ExecutionCost } from "./executionLedger.ts";

export const FIRECRAWL_COST_MODEL_VERSION = "firecrawl-cost-model-v1" as const;

/** Set this to the account's actual per-credit price, from an invoice. */
export const FIRECRAWL_USD_PER_CREDIT_ENV = "FIRECRAWL_USD_PER_CREDIT";
/** Free-text provenance for the rate above, e.g. "Standard plan, 2026-09 invoice". */
export const FIRECRAWL_PRICE_TIER_ENV = "FIRECRAWL_PRICE_TIER";

export type EnvReader = (key: string) => string | undefined;

function defaultReader(k: string): string | undefined {
  return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } })
    .Deno?.env.get(k);
}

/** A finite, positive rate, or null. Zero is not a rate — it is a claim of free. */
export function resolveFirecrawlCreditPrice(read?: EnvReader): number | null {
  const raw = (read ?? defaultReader)(FIRECRAWL_USD_PER_CREDIT_ENV);
  const n = Number(String(raw ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function resolveFirecrawlPriceTier(read?: EnvReader): string | null {
  const raw = (read ?? defaultReader)(FIRECRAWL_PRICE_TIER_ENV);
  const s = String(raw ?? "").trim();
  return s || null;
}

/**
 * THE PUBLISHED CREDIT RULE, verified against docs.firecrawl.dev/billing on
 * 2026-09-10:
 *
 *     scrape, crawl, map ....... 1 credit per page
 *     PDF parsing .............. +1 credit per PDF page
 *     JSON format (LLM) ........ +4 credits per page
 *     prompt-injection check ... +4 credits per page
 *     zero data retention ...... +1 credit per page
 *
 * `summary`, `screenshot` and `changeTracking` carry NO surcharge, which
 * matters because `execScrapeUrl` requests `formats: ["markdown", "summary"]`
 * — so our calls are the plain 1-credit-per-page case, and the surcharges are
 * encoded for the day somebody adds `json`.
 */
export const FIRECRAWL_SURCHARGE_PER_PAGE: Readonly<Record<string, number>> = Object.freeze({
  json: 4,
  changeTracking: 0,
  summary: 0,
  screenshot: 0,
});
export const FIRECRAWL_ZDR_SURCHARGE_PER_PAGE = 1;
export const FIRECRAWL_PDF_SURCHARGE_PER_PAGE = 1;

export interface FirecrawlCreditsInput {
  /** Pages the call actually processed. */
  pages: number;
  /** The `formats` array the request asked for. */
  formats?: readonly string[] | null;
  /** Zero-data-retention was requested. */
  zeroDataRetention?: boolean;
  /** The pages were PDFs, which are surcharged per PDF page. */
  pdfPages?: number;
  /**
   * DID ANYTHING COME BACK?
   *
   * "A scrape that returns no result is not charged" — but "a page that
   * responds with an error status such as 403 or 404 is still returned to you
   * and costs 1 credit". So this is about whether Firecrawl produced a
   * document, NOT about whether the page was healthy, and the two were easy to
   * conflate into pricing every 404 at zero.
   */
  producedResult: boolean;
}

/** Credits this call consumed, by the published rule. Never negative. */
export function firecrawlCredits(i: FirecrawlCreditsInput): number {
  if (!i.producedResult) return 0;
  const pages = Math.max(0, Math.floor(Number(i.pages) || 0));
  if (pages === 0) return 0;
  let perPage = 1;
  for (const f of i.formats ?? []) {
    perPage += FIRECRAWL_SURCHARGE_PER_PAGE[String(f)] ?? 0;
  }
  if (i.zeroDataRetention) perPage += FIRECRAWL_ZDR_SURCHARGE_PER_PAGE;
  const pdf = Math.max(0, Math.floor(Number(i.pdfPages) || 0));
  return pages * perPage + pdf * FIRECRAWL_PDF_SURCHARGE_PER_PAGE;
}

/** How the credit count was arrived at. Recorded so a wrong figure is traceable. */
export type FirecrawlCreditBasis =
  /** `/crawl` status returned `creditsUsed` — Firecrawl's own count. */
  | "provider_reported_credits"
  /** Computed from the published per-page rule; `/scrape` reports nothing. */
  | "published_rate";

export interface FirecrawlCallCost extends ExecutionCost {
  credits: number;
  credit_basis: FirecrawlCreditBasis;
  usd_per_credit: number | null;
  price_tier: string | null;
}

/**
 * Price a Firecrawl call.
 *
 * NEVER `provider_reported`, however good the credit count is: Firecrawl states
 * credits, not dollars, so `actual_cost_usd` must stay null and the database
 * CHECK is what guarantees it.
 *
 * With no configured rate the answer is `unknown` — not zero. A zero here would
 * put 229 rows' worth of real spend on the ledger's highest grade as free,
 * which is the mistake `priceProviderCall` records having made once already
 * when 39 failed scrapes were priced `event_priced` at $0.00.
 */
export function priceFirecrawlCall(i: {
  credits: number;
  basis: FirecrawlCreditBasis;
  read?: EnvReader;
}): FirecrawlCallCost {
  const usdPerCredit = resolveFirecrawlCreditPrice(i.read);
  const tier = resolveFirecrawlPriceTier(i.read);
  const credits = Math.max(0, Math.floor(Number(i.credits) || 0));
  const base = {
    credits,
    credit_basis: i.basis,
    usd_per_credit: usdPerCredit,
    price_tier: tier,
    // Firecrawl never states a charge, so this column can never be populated
    // from this path, whatever the credit count.
    actual_usd: null as number | null,
  };
  if (usdPerCredit === null) {
    return { ...base, estimated_usd: null, source: "unknown" };
  }
  // A call that consumed no credits genuinely cost nothing, and saying so is
  // only honest once a rate exists to say it against.
  const usd = Number((credits * usdPerCredit).toFixed(6));
  return { ...base, estimated_usd: usd, source: "event_priced" };
}
