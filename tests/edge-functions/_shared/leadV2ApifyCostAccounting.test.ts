// LEAD V2 RUN 4250f181 — THE LEDGER SAID $0.059, APIFY BILLED $0.355.
//
// Replays all twenty audited runs as the worker saw them at SUCCEEDED: a
// `usageTotalUsd` that had settled only the start fee, event counts that had
// charged only the start, the run's own published prices, and the rows each run
// actually returned. The ledger must now record what Apify billed.
//
// PURE.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  apifyEventPrices, priceProviderCall,
} from "../../../supabase/functions/_shared/providerCostModel.ts";

/** Event prices exactly as the runs' own `pricingInfo` published them. */
const PRICES: Record<string, Record<string, number>> = {
  apify_yc_companies_memo23: { "apify-actor-start": 0.008, "apify-default-dataset-item": 0.001, "additional-data": 0.0001 },
  apify_linkedin_company_search: { "apify-actor-start": 0.001, "short-company": 0.002, "full-company": 0.004 },
};

/** [run, actor, scraperMode, rows returned, ledger actual at SUCCEEDED, Apify final usageTotalUsd] */
const RUNS: Array<[string, string, string | null, number, number, number]> = [
  ["ECCPnUcOMwc7EjDTR", "apify_yc_companies_memo23", null, 10, 0.008, 0.018],
  ["OU43gsiNE6jW4hHNf", "apify_linkedin_company_search", "short", 0, 0.0, 0.001],
  ["11iFlStZRAwUJOFcE", "apify_linkedin_company_search", "short", 3, 0.001, 0.007],
  ["XtCXYeO1DC29lAEeu", "apify_linkedin_company_search", "short", 14, 0.001, 0.029],
  ["mn3pJvVwDGp5YjWxc", "apify_linkedin_company_search", "short", 3, 0.001, 0.007],
  ["2AgXPE5MAzDFjupYe", "apify_linkedin_company_search", "short", 15, 0.001, 0.031],
  ["beesxjPtxGLMeF49P", "apify_linkedin_company_search", "short", 8, 0.0, 0.017],
  ["ECNryguUedqb8XT35", "apify_linkedin_company_search", "short", 15, 0.001, 0.031],
  ["BajyMoN8km8fWkhty", "apify_linkedin_company_search", "short", 1, 0.001, 0.003],
  ["dTKjqhRdrXbraA7Ur", "apify_yc_companies_memo23", null, 10, 0.008, 0.018],
  ["B1qQGdoal9fadYzSf", "apify_linkedin_company_search", "short", 8, 0.001, 0.017],
  ["lnPfSJ71GBj140P60", "apify_linkedin_company_search", "short", 3, 0.001, 0.007],
  ["poa6rBspq8ChD8flC", "apify_yc_companies_memo23", null, 10, 0.008, 0.018],
  ["bOtwVG84SqgkusU51", "apify_yc_companies_memo23", null, 10, 0.008, 0.018],
  ["PRLKaH64gLvpkanfo", "apify_linkedin_company_search", "short", 15, 0.001, 0.031],
  ["Uia7nNBhXDKEayCPO", "apify_linkedin_company_search", "short", 15, 0.001, 0.031],
  ["ePCUHes7Vjs1jWwdO", "apify_yc_companies_memo23", null, 10, 0.0, 0.018],
  ["5b4ppsxMmQtEPgdGx", "apify_linkedin_company_search", "short", 8, 0.001, 0.017],
  ["pFDHJ4W7PDFOSdlPI", "apify_yc_companies_memo23", null, 10, 0.008, 0.018],
  ["eKQp7gjdoAuQSpjo2", "apify_yc_companies_memo23", null, 10, 0.008, 0.018],
];

/** The run document as it read at SUCCEEDED: start settled, results not yet. */
const atFinish = (actor: string, ledgerUsd: number) => ({
  usageTotalUsd: ledgerUsd,
  chargedEventCounts: { "apify-actor-start": ledgerUsd > 0 ? 1 : 0 },
  eventPrices: PRICES[actor],
});

Deno.test("the audited run's twenty calls now cost what Apify billed — $0.355, not $0.059", () => {
  let recorded = 0, billed = 0, before = 0;
  for (const [run, actor, mode, rows, ledgerUsd, finalUsd] of RUNS) {
    const cost = priceProviderCall({
      actorKey: actor, itemCount: rows, input: mode ? { scraperMode: mode } : {},
      run: atFinish(actor, ledgerUsd), started: true,
    });
    assertEquals(cost.source, "provider_reported", run);
    assertAlmostEquals(cost.actual_usd!, finalUsd, 1e-9, `${run}: start + ${rows} result events`);
    recorded += cost.actual_usd!; billed += finalUsd; before += ledgerUsd;
  }
  assertAlmostEquals(billed, 0.355, 1e-9);
  assertAlmostEquals(recorded, billed, 1e-9, "the ledger now matches the bill");
  assertAlmostEquals(before, 0.059, 1e-9, "the fixture is the audited under-report");
});

Deno.test("a settled run document is not double-counted — the largest figure, never the sum", () => {
  const cost = priceProviderCall({
    actorKey: "apify_linkedin_company_search", itemCount: 3, input: { scraperMode: "short" },
    run: {
      usageTotalUsd: 0.007,
      chargedEventCounts: { "apify-actor-start": 1, "short-company": 3, "full-company": 0 },
      eventPrices: PRICES.apify_linkedin_company_search,
    },
    started: true,
  });
  assertAlmostEquals(cost.actual_usd!, 0.007, 1e-9);
});

Deno.test("actor-start and result events are both counted; full rows cost full price", () => {
  const cost = priceProviderCall({
    actorKey: "apify_linkedin_company_search", itemCount: 15, input: { scraperMode: "full" },
    run: { usageTotalUsd: 0.001, chargedEventCounts: { "apify-actor-start": 1 },
      eventPrices: PRICES.apify_linkedin_company_search },
    started: true,
  });
  assertAlmostEquals(cost.actual_usd!, 0.001 + 15 * 0.004, 1e-9);
});

Deno.test("a re-read of a run already paid for costs this call nothing — no duplicate settlement", () => {
  const cost = priceProviderCall({
    actorKey: "apify_yc_companies_memo23", itemCount: 10, input: {},
    run: { usageTotalUsd: 0.018, eventPrices: PRICES.apify_yc_companies_memo23 },
    started: false, adopted: true,
  });
  assertEquals(cost.actual_usd, null);
  assertEquals(cost.estimated_usd, 0);
});

Deno.test("unknown cost is never recorded as $0", () => {
  const cost = priceProviderCall({ actorKey: "not_a_card", itemCount: 5, input: {}, run: null, started: true });
  assertEquals(cost.source, "unknown");
  assertEquals(cost.actual_usd, null);
});

Deno.test("event prices are read from the run's own pricingInfo", () => {
  const prices = apifyEventPrices({ pricingPerEvent: { actorChargeEvents: {
    "apify-actor-start": { eventPriceUsd: 0.001 }, "short-company": { eventPriceUsd: 0.002 },
  } } });
  assertEquals(prices, { "apify-actor-start": 0.001, "short-company": 0.002 });
  assertEquals(apifyEventPrices(null), null);
  const src = Deno.readTextFileSync(new URL("../../../supabase/functions/_shared/toolRegistry.ts", import.meta.url));
  assert(src.includes("eventPrices: apifyEventPrices(finalRun?.pricingInfo)"),
    "the worker's provider path carries the run's own prices into the ledger");
});
