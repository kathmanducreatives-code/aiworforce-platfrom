// FIRECRAWL SPEND IS COUNTABLE.
//
// ── WHAT THIS CLOSES ────────────────────────────────────────────────────────
//
// 229 Firecrawl rows in `lead_execution_calls`, 214 of them successful, every
// one `cost_source: "unknown"` and no cost at all. Apify beside it reports a
// real charge on 956 rows totalling $19.01. One of the two paid providers could
// not be budgeted, alerted on or billed back.
//
// The cause was structural: `priceProviderCall` prices from
// `hiringActorCard(actorKey)`, and a Firecrawl call has no actor key. It
// arrived as `actorKey: ""`, matched no card, and fell through to `unknown`.
//
// ── THE TWO THINGS THESE TESTS REFUSE TO LET SLIDE ──────────────────────────
//
// 1. `unknown` MUST NOT BECOME $0. The ledger already records what that costs:
//    39 failed scrapes were written `event_priced` at exactly $0.00 — the
//    highest provenance grade short of the provider's own figure, asserting
//    that a failed call was free. Without a configured rate the answer here is
//    `unknown`, and the credit count is recorded anyway so the spend stays
//    countable while it is unpriced.
//
// 2. CREDITS ARE NOT DOLLARS. Firecrawl never states a charge — `/scrape`
//    returns only `success`, `data`, `warning`, and `/crawl` returns
//    `creditsUsed`, a count. So `actual_cost_usd` must stay null, which the
//    database enforces:
//      CHECK (actual_cost_usd IS NULL OR cost_source = 'provider_reported')
//
// ZERO network, ZERO providers, ZERO database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  firecrawlCredits, priceFirecrawlCall, resolveFirecrawlCreditPrice,
  FIRECRAWL_USD_PER_CREDIT_ENV, FIRECRAWL_PRICE_TIER_ENV,
} from "../../../supabase/functions/_shared/firecrawlCostModel.ts";

const REGISTRY = new URL("../../../supabase/functions/_shared/toolRegistry.ts", import.meta.url);
const SRC = await Deno.readTextFile(REGISTRY);

/** A reader for a fixed env, so nothing here depends on the ambient one. */
const env = (m: Record<string, string>) => (k: string) => m[k];

// ══════════ 1. the published credit rule ══════════════════════════════════

Deno.test("THE RULE: scrape and crawl are 1 credit per page", () => {
  // docs.firecrawl.dev/billing, read 2026-09-10.
  assertEquals(firecrawlCredits({ pages: 1, producedResult: true }), 1);
  assertEquals(firecrawlCredits({ pages: 5, producedResult: true }), 5);
});

Deno.test("OUR ACTUAL REQUEST SHAPE costs exactly one credit per page", () => {
  // `execScrapeUrl` asks for `formats: ["markdown", "summary"]`. Neither is
  // surcharged — the billing page lists surcharges for PDF parsing, JSON
  // format, prompt-injection checking and zero data retention, and `summary`
  // appears in none of them. If that ever changes, this is the test that says
  // the ledger is now understating every scrape.
  assertEquals(
    firecrawlCredits({ pages: 1, formats: ["markdown", "summary"], producedResult: true }),
    1,
    "markdown + summary must remain the plain 1-credit case",
  );
});

Deno.test("the surcharges are encoded for the day somebody adds json", () => {
  // +4 per page for LLM extraction, +1 for zero data retention, +1 per PDF page.
  assertEquals(
    firecrawlCredits({ pages: 1, formats: ["markdown", "json"], producedResult: true }), 5);
  assertEquals(
    firecrawlCredits({
      pages: 1, formats: ["markdown", "json"], zeroDataRetention: true, producedResult: true,
    }), 6);
  assertEquals(
    firecrawlCredits({ pages: 2, formats: ["markdown"], pdfPages: 3, producedResult: true }), 5);
});

Deno.test("A SCRAPE THAT RETURNED NOTHING IS NOT CHARGED", () => {
  // Firecrawl's own rule. Distinct from the next test, and the two are easy to
  // conflate into pricing every 404 at zero.
  assertEquals(firecrawlCredits({ pages: 1, producedResult: false }), 0);
  assertEquals(firecrawlCredits({ pages: 0, producedResult: true }), 0);
});

Deno.test("A 404 THAT STILL RETURNED CONTENT *IS* CHARGED", () => {
  // "A page that responds with an error status such as 403 or 404 is still
  // returned to you and costs 1 credit." So the charge keys on whether a
  // document came back, never on whether the page was healthy — and
  // `execScrapeUrl` reports `producedResult: true` whenever Firecrawl answered
  // with a document, which is exactly that distinction.
  assertEquals(firecrawlCredits({ pages: 1, producedResult: true }), 1);
});

// ══════════ 2. credits are not dollars ════════════════════════════════════

Deno.test("THE HONESTY PROPERTY: no configured rate means `unknown`, never $0", () => {
  const c = priceFirecrawlCall({ credits: 12, basis: "published_rate", read: env({}) });
  assertEquals(c.source, "unknown", "an unpriced call is unknown, not free");
  assertEquals(c.estimated_usd, null);
  assertEquals(c.actual_usd, null);
  // AND THE COUNT SURVIVES. This is what makes the spend countable while it is
  // unpriced — the state the 229 rows were missing entirely.
  assertEquals(c.credits, 12, "the credit count is recorded even with no rate");
  assertEquals(c.credit_basis, "published_rate");
});

Deno.test("a configured rate prices it, as `event_priced` and never higher", () => {
  const c = priceFirecrawlCall({
    credits: 1000, basis: "published_rate",
    read: env({ [FIRECRAWL_USD_PER_CREDIT_ENV]: "0.00083" }),
  });
  assertEquals(c.source, "event_priced");
  assertEquals(c.estimated_usd, 0.83);
  // NEVER `provider_reported`, however good the count. Firecrawl states
  // credits, not a charge, and the database refuses `actual_cost_usd` on any
  // other grade:
  //   CHECK (actual_cost_usd IS NULL OR cost_source = 'provider_reported')
  assertEquals(c.actual_usd, null, "actual_cost_usd is reserved for a provider-stated charge");
  assertEquals(c.usd_per_credit, 0.00083);
});

Deno.test("Firecrawl's own creditsUsed is recorded as a better BASIS, not a better grade", () => {
  // `/crawl/{id}` returns `creditsUsed`. That improves the count — a partial
  // crawl bills for pages it did not return — but it is still not dollars, so
  // the grade does not move.
  const c = priceFirecrawlCall({
    credits: 7, basis: "provider_reported_credits",
    read: env({ [FIRECRAWL_USD_PER_CREDIT_ENV]: "0.001" }),
  });
  assertEquals(c.credit_basis, "provider_reported_credits");
  assertEquals(c.source, "event_priced", "a credit count is not a stated charge");
  assertEquals(c.actual_usd, null);
});

Deno.test("a zero or negative rate is not a rate", () => {
  // Zero would silently reinstate the exact bug this replaces.
  for (const bad of ["0", "-1", "", "abc", "NaN"]) {
    assertEquals(
      resolveFirecrawlCreditPrice(env({ [FIRECRAWL_USD_PER_CREDIT_ENV]: bad })), null,
      `"${bad}" must not be accepted as a per-credit price`,
    );
  }
  assertEquals(resolveFirecrawlCreditPrice(env({ [FIRECRAWL_USD_PER_CREDIT_ENV]: "0.0005" })), 0.0005);
});

Deno.test("the rate carries its provenance", () => {
  const c = priceFirecrawlCall({
    credits: 1, basis: "published_rate",
    read: env({
      [FIRECRAWL_USD_PER_CREDIT_ENV]: "0.00083",
      [FIRECRAWL_PRICE_TIER_ENV]: "Standard plan, 2026-09 invoice",
    }),
  });
  assertEquals(c.price_tier, "Standard plan, 2026-09 invoice");
});

Deno.test("zero credits with a rate IS a real zero", () => {
  // Once a rate exists, "consumed no credits" is a measured answer rather than
  // an absent one — the same distinction `priceProviderCall` draws for adopted
  // Apify runs.
  const c = priceFirecrawlCall({
    credits: 0, basis: "published_rate",
    read: env({ [FIRECRAWL_USD_PER_CREDIT_ENV]: "0.001" }),
  });
  assertEquals(c.source, "event_priced");
  assertEquals(c.estimated_usd, 0);
});

// ══════════ 3. the call reports it, and the ledger reads it ═══════════════

Deno.test("THE WIRING: execScrapeUrl states its credits on every charged path", () => {
  const scrape = SRC.slice(SRC.indexOf("async function execScrapeUrl"));
  const body = scrape.slice(0, scrape.indexOf("\n}\n"));
  // Three charged paths: the single-page scrape, the inline-doc crawl, and the
  // polled crawl. All three must state a cost or the ledger has nothing to read.
  const stated = [...body.matchAll(/firecrawl_cost:/g)].length;
  assert(
    stated >= 3,
    `expected all charged Firecrawl paths to state a cost, found ${stated}`,
  );
  assert(
    body.includes('basis: "provider_reported_credits"'),
    "the crawl path must prefer Firecrawl's own creditsUsed when it sends one",
  );
  assert(
    /Number\(status\?\.creditsUsed\)/.test(body),
    "the crawl status poll must actually read creditsUsed",
  );
});

Deno.test("the ledger prefers the stated Firecrawl cost over the actor-card fallback", () => {
  // `priceProviderCall` cannot price Firecrawl — no actor key, no card — so
  // without this the fall-through to `unknown` is the only answer available.
  assert(
    /cost: firecrawlCost\(d\) \?\? priceProviderCall\(\{/.test(SRC),
    "outcomeFromToolResult must consult the Firecrawl cost first",
  );
  // Both branches: a failed call must not silently keep the old pricing either.
  assertEquals(
    [...SRC.matchAll(/cost: firecrawlCost\(d\) \?\?/g)].length, 2,
    "both the success and failure outcomes must consult it",
  );
});

Deno.test("the reader is EXPLICIT, not inferred from the result's shape", () => {
  // Guessing "this looks like a Firecrawl result" would misprice the next tool
  // that happens to return markdown.
  const fn = SRC.slice(SRC.indexOf("function firecrawlCost("));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert(body.includes("d.firecrawl_cost"), "it must key on the stated field");
  assert(
    /if \(!raw \|\| typeof raw !== "object"\) return null;/.test(body),
    "a call that stated nothing must fall through, not be priced as zero",
  );
  assert(
    /return null;/.test(body) && body.includes("credits < 0"),
    "a malformed credit count must fall through rather than reach the ledger",
  );
});
