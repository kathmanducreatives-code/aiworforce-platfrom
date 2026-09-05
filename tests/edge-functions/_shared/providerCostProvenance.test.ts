// EVERY COST FIGURE CARRIES ITS OWN GRADE.
//
// ── THE STATE THIS REPLACES ─────────────────────────────────────────────────
//
// All 118 rows in `lead_execution_calls` said `cost_source: "unknown"` with
// `actual_cost_usd: null`. The justification in `toolRegistry` was:
//
//     "Apify does not return a charge on the run object we poll, so nothing
//      here may claim `provider_reported`. A per-actor price table can promote
//      this later; until then the row says estimated and actual stays null."
//
// Neither half held. The per-actor price table already existed and was already
// verified — `hiringActorCatalog.cost_model`, with named per-event prices — and
// nothing read it. And the row did not say "estimated": `cost: { source:
// "unknown" }` was hardcoded, so no figure of any grade was ever recorded.
//
// The grades exist to keep two very different claims apart:
//
//   provider_reported   Apify stated a charge for this run.
//   event_priced        computed from the verified table and this run's own
//                       counts. Accurate to the cent. Still not their number.
//   estimated           no per-event basis.
//   unknown             nothing known. NOT zero — zero is a claim.
//
// ZERO network, ZERO Actor runs, ZERO database writes.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  priceProviderCall, resultEventName,
} from "../../../supabase/functions/_shared/providerCostModel.ts";
import {
  costConfidence, summarizeTaskLedger, buildStartedRow, buildFinalPatch,
  type ExecutionLedgerRow,
} from "../../../supabase/functions/_shared/executionLedger.ts";
import { hiringActorCard } from "../../../supabase/functions/_shared/hiringActorCatalog.ts";

const SEARCH = "apify_linkedin_company_search";
const MEMO23 = "apify_yc_companies_memo23";

// ═══ 1. THE PROVIDER'S OWN FIGURE WINS, AND IT IS THE ONLY "ACTUAL" ════════

Deno.test("1. a reported charge is the only figure allowed to be actual", () => {
  const c = priceProviderCall({
    actorKey: SEARCH, itemCount: 15,
    input: { scraperMode: "full" },
    run: { usageTotalUsd: 0.0731 },
  });
  assertEquals(c.source, "provider_reported");
  assertEquals(c.actual_usd, 0.0731);
  assertEquals(c.estimated_usd, null, "the two are never populated together");
});

Deno.test("2. the nested usage shape is read too", () => {
  const c = priceProviderCall({
    actorKey: SEARCH, itemCount: 2, run: { usage: { totalUsd: 0.02 } },
  });
  assertEquals(c.source, "provider_reported");
  assertEquals(c.actual_usd, 0.02);
});

Deno.test("3. computeUnits alone is NOT a charge", () => {
  // The only usage field this morning's real run actually exposed. It is a
  // resource measure, not money, and reading it as money would be a fabricated
  // `actual_cost_usd`.
  const c = priceProviderCall({
    actorKey: SEARCH, itemCount: 12,
    input: { scraperMode: "full" },
    run: { stats: { computeUnits: 0.00045826 } },
  });
  assertEquals(c.source, "event_priced");
  assertEquals(c.actual_usd, null);
});

// ═══ 2. EVENT PRICING USES THE VERIFIED TABLE ══════════════════════════════

Deno.test("4. short and full company rows are priced differently — the 2x", () => {
  const card = hiringActorCard(SEARCH)!;
  assertEquals(card.cost_model.events_usd?.["short-company"], 0.002);
  assertEquals(card.cost_model.events_usd?.["full-company"], 0.004);

  const short = priceProviderCall({
    actorKey: SEARCH, itemCount: 15, input: { scraperMode: "short" },
  });
  const full = priceProviderCall({
    actorKey: SEARCH, itemCount: 15, input: { scraperMode: "full" },
  });
  // start 0.001 + 15 × price
  assertEquals(short.estimated_usd, 0.031);
  assertEquals(full.estimated_usd, 0.061);
  assertEquals(short.source, "event_priced");
  assert(full.estimated_usd! > short.estimated_usd! * 1.9,
    "the mode difference must survive into the ledger, or the largest line in the pipeline is the least accurate");
});

Deno.test("5. resultEventName only claims what it knows", () => {
  assertEquals(resultEventName(SEARCH, { scraperMode: "short" }), "short-company");
  assertEquals(resultEventName(SEARCH, { scraperMode: "FULL" }), "full-company");
  assertEquals(resultEventName(SEARCH, {}), null, "no mode named, no event claimed");
  assertEquals(resultEventName(MEMO23, { scraperMode: "short" }), null,
    "memo23 does not price by mode; its flat per-result rate applies");
});

Deno.test("6. an actor without named events uses its flat per-result rate", () => {
  const card = hiringActorCard(MEMO23)!;
  const c = priceProviderCall({ actorKey: MEMO23, itemCount: 100 });
  // start 0.008 + 100 × 0.001
  assertEquals(c.estimated_usd, Number((card.cost_model.start_usd + 100 * 0.001).toFixed(4)));
  assertEquals(c.source, "event_priced");
});

Deno.test("7. a published minimum charge is a floor, not a safety margin", () => {
  const enrich = "apify_linkedin_company_details";
  const card = hiringActorCard(enrich)!;
  const min = card.cost_model.minimum_total_usd!;
  const c = priceProviderCall({ actorKey: enrich, itemCount: 0 });
  assertEquals(c.estimated_usd, min, "several of these actors bill a minimum whatever they return");
});

// ═══ 3. WHAT MUST NEVER BE PRICED AT ZERO, AND WHAT MUST ═══════════════════

Deno.test("8. an unknown actor is UNKNOWN, never zero", () => {
  const c = priceProviderCall({ actorKey: "apify_not_in_the_catalog", itemCount: 9 });
  assertEquals(c.source, "unknown");
  assertEquals(c.actual_usd, null);
  assertEquals(c.estimated_usd, null,
    "'we did not spend' and 'we do not know' are different answers");
});

Deno.test("9. a REUSED run is not charged a second start fee", () => {
  // `adopted` is now the signal, not `started: false` alone. See test 9b: the
  // absence of a start is also true of a provider that has no runs to start.
  const c = priceProviderCall({
    actorKey: SEARCH, itemCount: 15, input: { scraperMode: "short" },
    started: false, adopted: true,
  });
  assertEquals(c.estimated_usd, 0,
    "an adopted run was already paid for; charging again makes idempotency look expensive");
  assertEquals(c.source, "event_priced");
});

Deno.test("9b. a call that never started and adopted NOTHING is not free", () => {
  // ── THE FIRECRAWL ROWS ──────────────────────────────────────────────────
  //
  // `started: runId !== null` is false for every failed Firecrawl scrape,
  // because `/scrape` is synchronous and returns no run id at all. Read as an
  // adoption, that recorded 39 failed calls as `event_priced` at exactly
  // $0.00 — the ledger asserting on a high provenance grade that a failed call
  // was free. During an outage the spend would read as untouched.
  //
  // Zero is only a measured answer when something was actually adopted.
  const c = priceProviderCall({
    actorKey: "firecrawl_scrape", itemCount: 0, started: false,
  });
  assertEquals(c.actual_usd, null);
  assertEquals(c.estimated_usd, null,
    "no card and no adoption is 'we do not know', never 'it was free'");
  assertEquals(c.source, "unknown");
});

Deno.test("10. a FAILED call that started still costs its start fee", () => {
  // An Actor that started and timed out has been charged. Pricing it at zero
  // would hide the expensive failures from a run's economics.
  const c = priceProviderCall({ actorKey: SEARCH, itemCount: 0, started: true });
  assertEquals(c.estimated_usd, hiringActorCard(SEARCH)!.cost_model.start_usd);
  assert(c.estimated_usd! > 0);
});

// ═══ 4. THE ROW, AND THE INVARIANT THE DATABASE ALSO ENFORCES ══════════════

const rowWith = (cost: Parameters<typeof buildFinalPatch>[1]["cost"]): ExecutionLedgerRow => {
  const started = buildStartedRow({
    workspace_id: "w", stage: "company_discovery", reason: "initial_discovery",
    provider_id: "apify", logical_call_key: "k",
  });
  return { ...started, ...buildFinalPatch(started, { status: "succeeded", cost }) };
};

Deno.test("11. actual_cost_usd is populated ONLY by a provider-reported figure", () => {
  const reported = rowWith({ actual_usd: 0.05, estimated_usd: null, source: "provider_reported" });
  assertEquals(reported.actual_cost_usd, 0.05);

  for (const source of ["event_priced", "estimated", "unknown"] as const) {
    const row = rowWith({ actual_usd: 0.05, estimated_usd: 0.05, source });
    assertEquals(row.actual_cost_usd, null,
      `${source} may not populate actual_cost_usd — the database refuses it too`);
    assertEquals(row.cost_source, source, "and the grade survives onto the row");
  }
});

// ═══ 5. RUN ECONOMICS, DERIVED FROM THE LEDGER ═════════════════════════════

Deno.test("12. a run's cost is answerable per stage, with its grade", () => {
  const mk = (
    stage: "company_discovery" | "company_enrichment", est: number, n = 1,
  ) => Array.from({ length: n }, () => {
    const started = buildStartedRow({
      workspace_id: "w", stage, reason: "initial_discovery",
      provider_id: "apify", logical_call_key: `${stage}-${Math.random()}`,
    });
    return {
      ...started,
      ...buildFinalPatch(started, {
        status: "succeeded",
        cost: { actual_usd: null, estimated_usd: est, source: "event_priced" as const },
      }),
    };
  });

  const s = summarizeTaskLedger([...mk("company_discovery", 0.031, 23), ...mk("company_enrichment", 0.05, 4)]);

  assertEquals(s.calls, 27);
  assertEquals(s.actual_cost_usd, 0, "nothing was provider-confirmed");
  assertEquals(s.estimated_cost_usd, 0.913);
  assertEquals(s.cost_is_partly_estimated, true);
  assertEquals(s.cost_confidence.event_priced, 27);
  assertEquals(s.cost_confidence.fully_reported, false);

  // "How much did identity cost?" — the question the totals cannot answer.
  const discovery = s.by_stage.find((x) => x.stage === "company_discovery")!;
  assertEquals(discovery.calls, 23);
  assertEquals(discovery.estimated_cost_usd, 0.713);
  assertEquals(discovery.cost_confidence.event_priced, 23);
});

Deno.test("13. cost grades are counted, never averaged into one number", () => {
  const c = costConfidence([
    "provider_reported", "provider_reported", "event_priced", "estimated", "unknown",
  ]);
  assertEquals(c, {
    provider_reported: 2, event_priced: 1, estimated: 1, unknown: 1, fully_reported: false,
  });
  assert(costConfidence(["provider_reported"]).fully_reported);
  assert(!costConfidence([]).fully_reported, "no calls is not full confidence");
});
