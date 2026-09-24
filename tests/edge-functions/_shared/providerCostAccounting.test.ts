// ONE PROVIDER CALL, FROM ESTIMATE TO THE WORKBENCH — AND THE FIGURE EACH STEP OWNS.
//
// Canary abc316e8 (Wordware, 2026-09-23) exposed three disagreements:
//
//   atomus row    actual_cost_usd 0.0001   settled_usd 0.0036
//   run_outcome   usd_reported    0.0242   (Apify billed 0.0278)
//   Workbench     provider_settled_usd 0   model_usd below the model ledger
//
// The run documents, read back from Apify for this file (no run was bought):
//
//   atomus  yXMNWcg0RHbhY4Fsh  PAY_PER_EVENT  apify-actor-start $0.00005 × 1
//                                             company-enriched  $0.0035  × 1
//                                             usageTotalUsd     $0.00355
//   pvalyou 6u7BzSMsN27YrSeFH  apify-actor-start × 1, company_basic $0.02 × 1
//                                             usageTotalUsd     $0.02005
//   enrich  icT97DyNoe9xknnvU  apify-actor-start × 1, apify-default-dataset-item $0.004 × 1
//                                             usageTotalUsd     $0.00405
//
// At SUCCEEDED Apify had charged only the start fee; the per-result event
// posted afterwards. The completion-time floor had no per-result price for
// atomus (`resultEventName` did not name `company-enriched`), so it recorded
// the start fee as the whole charge. Settlement was right all along.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  billableResultCount, priceProviderCall, resultEventName,
} from "../../../supabase/functions/_shared/providerCostModel.ts";
import { apifyReceiptFromRun, settleUntilStable } from "../../../supabase/functions/_shared/providerReceipts.ts";
import {
  DEFAULT_CEILINGS, estimateCallUsd, markAdopted, markExecuted, newSpendLedger, reserve, attachProviderRun,
  type SpendLedger,
} from "../../../supabase/functions/_shared/budgetPolicy.ts";
import { hiringActorCard } from "../../../supabase/functions/_shared/hiringActorCatalog.ts";
import { canonicalProviderCostUsd } from "../../../supabase/functions/_shared/executionLedger.ts";
import { readModelSpendUsd, readSpendFacts, type OutcomeDb } from "../../../supabase/functions/_shared/runOutcome.ts";
import { missionCostFromLedgers } from "../../../supabase/functions/_shared/workbenchMissionView.ts";

const START = { "apify-actor-start": 0.00005 };
const ATOMUS_PRICES = { ...START, "company-enriched": 0.0035 };
const PVALYOU_PRICES = { ...START, company_basic: 0.02, company_full: 0.1 };
const ENRICH_PRICES = { ...START, "apify-default-dataset-item": 0.004 };
const FOUND_ATOMUS = { status: "success", input: "https://www.linkedin.com/company/wordware", company: { name: "Wordware" } };
const MISSED_ATOMUS = { status: "not_found", input: "https://www.linkedin.com/company/nope", company: {} };

// ═══════════════════════════════════════════ one call, every figure ══

Deno.test("ATOMUS: estimate → completion floor → receipt → settlement agree on $0.0036, and say why", async () => {
  const input = { companies: ["https://www.linkedin.com/company/wordware"] };
  // 1. PRE-SPEND: the card, exactly as the spec compiles it.
  const estimate = estimateCallUsd("apify_funding_atomus", hiringActorCard("apify_funding_atomus")!.cost_model, input);
  assertEquals(estimate, 0.0036);

  // 2. EXECUTION: the run document AS READ AT SUCCEEDED — start fee only charged.
  const atSucceeded = { usageTotalUsd: 0.00005, chargedEventCounts: { "apify-actor-start": 1 }, eventPrices: ATOMUS_PRICES };
  const actual = priceProviderCall({
    actorKey: "apify_funding_atomus", input, run: atSucceeded,
    itemCount: billableResultCount("apify_funding_atomus", [FOUND_ATOMUS]),
  });
  assertEquals(actual.source, "provider_reported");
  assertEquals(actual.actual_usd, 0.0036, "the floor prices the found company it returned, not just the start fee");
  assertEquals(resultEventName("apify_funding_atomus", input), "company-enriched");

  // 3. RECEIPT → 4. SETTLEMENT, from the settled run document.
  const settledRun = {
    status: "SUCCEEDED", finishedAt: "2026-09-23T11:57:24.208Z", usageTotalUsd: 0.00355,
    chargedEventCounts: { "company-enriched": 1, "apify-actor-start": 1 },
    pricingInfo: { pricingPerEvent: { actorChargeEvents: {
      "company-enriched": { eventPriceUsd: 0.0035 }, "apify-actor-start": { eventPriceUsd: 0.00005 },
    } } },
  };
  const l = newSpendLedger(DEFAULT_CEILINGS);
  reserve(l, { idempotency_key: "k_atomus", provider_call_id: "pc_03d3", purpose: "funding_evidence", route_id: null, estimate_usd: estimate });
  markExecuted(l, "k_atomus", actual.actual_usd!);
  attachProviderRun(l, "k_atomus", "yXMNWcg0RHbhY4Fsh");
  await settleUntilStable(l, () => Promise.resolve(apifyReceiptFromRun(settledRun)), {
    attempts: 2, waitMs: 0, minFinishedAgeMs: 0, sleep: () => Promise.resolve(),
  });
  const r = l.reservations[0];
  assertEquals([r.status, r.settled_usd, r.settlement_source, r.variance_usd, r.settlement_stable], ["settled", 0.0036, "provider_receipt", 0, true]);

  // 5. CANONICAL: the settled receipt.
  assertEquals(canonicalProviderCostUsd({ actual_cost_usd: actual.actual_usd, settled_usd: r.settled_usd, settlement_source: "provider_receipt" }), 0.0036);
  // 6. WORKBENCH: from the ledger.
  assertEquals(missionCostFromLedgers({ spend_ledger: l, model_usd: 0 }).provider_settled_usd, 0.0036);
});

Deno.test("ATOMUS: a start fee alone is the right completion figure ONLY when nothing billable came back", () => {
  const atSucceeded = { usageTotalUsd: 0.00005, chargedEventCounts: { "apify-actor-start": 1 }, eventPrices: ATOMUS_PRICES };
  const price = (rows: unknown[]) => priceProviderCall({
    actorKey: "apify_funding_atomus", input: {}, run: atSucceeded,
    itemCount: billableResultCount("apify_funding_atomus", rows),
  }).actual_usd;
  assertEquals(price([MISSED_ATOMUS]), 0.0001, "not-found is free: the $0.00005 start is the whole charge (rounded)");
  assertEquals(price([FOUND_ATOMUS, MISSED_ATOMUS]), 0.0036, "one found, one free");
  assertEquals(billableResultCount("apify_funding_atomus", [FOUND_ATOMUS, MISSED_ATOMUS]), 1);
  assertEquals(billableResultCount("apify_funding_pvalyou", [{ status: "not_found", record: {} }, { record: { a: 1 } }]), 1);
  assertEquals(billableResultCount("apify_linkedin_company_details", [{}, {}]), 2, "every other actor bills every row");
});

Deno.test("PVALYOU and ENRICHMENT: the completion floor matches what Apify billed", () => {
  const pv = priceProviderCall({
    actorKey: "apify_funding_pvalyou", input: { tier: "basic", companies: ["wordware.ai"] },
    run: { usageTotalUsd: 0.00005, chargedEventCounts: { "apify-actor-start": 1 }, eventPrices: PVALYOU_PRICES },
    itemCount: billableResultCount("apify_funding_pvalyou", [{ record: { funding: {} } }]),
  });
  assertEquals(pv.actual_usd, 0.0201);
  assertEquals(resultEventName("apify_funding_pvalyou", { tier: "full" }), "company_full");
  const en = priceProviderCall({
    actorKey: "apify_linkedin_company_details", input: {},
    run: { usageTotalUsd: 0.00005, chargedEventCounts: { "apify-actor-start": 1 }, eventPrices: ENRICH_PRICES },
    itemCount: 1,
  });
  assertEquals(en.actual_usd, 0.0041);
  // The card and the run name pvalyou's events the same way.
  const card = hiringActorCard("apify_funding_pvalyou")!.cost_model.events_usd!;
  assertEquals([card.company_basic, card.company_full], [0.02, 0.1]);
});

Deno.test("CANONICAL: receipt beats the completion floor; a derived floor is not a receipt; unknown is null", () => {
  // The documented case: a floor read before per-result charges posted.
  assertEquals(canonicalProviderCostUsd({ actual_cost_usd: 0.0001, settled_usd: 0.0036, settlement_source: "provider_receipt" }), 0.0036);
  // `derived_floor` is the ledger's provisional figure, not the provider's.
  assertEquals(canonicalProviderCostUsd({ actual_cost_usd: 0.004, settled_usd: 0.0041, settlement_source: "derived_floor" }), 0.004);
  assertEquals(canonicalProviderCostUsd({ actual_cost_usd: null, settled_usd: 0.0041, settlement_source: "derived_floor" }), null);
  assertEquals(canonicalProviderCostUsd({ actual_cost_usd: "0.0201", settled_usd: null, settlement_source: null }), 0.0201, "numeric strings from PostgREST");
  assertEquals(canonicalProviderCostUsd({}), null, "not known is not zero");
});

// ═══════════════════════════════════════════════ the Workbench ══

function canaryLedger(): SpendLedger {
  const l = newSpendLedger(DEFAULT_CEILINGS);
  const add = (key: string, est: number, settled: number | null) => {
    reserve(l, { idempotency_key: key, provider_call_id: `pc_${key}`, purpose: "funding_evidence", route_id: null, estimate_usd: est });
    markExecuted(l, key, est);
    if (settled !== null) {
      const r = l.reservations.find((x) => x.idempotency_key === key)!;
      Object.assign(r, { status: "settled", settled_usd: settled, settlement_source: "provider_receipt", variance_usd: 0 });
    }
  };
  add("enrich", 0.0041, 0.0041);
  add("atomus", 0.0036, 0.0036);
  add("pvalyou", 0.0201, 0.0201);
  return l;
}

Deno.test("WORKBENCH: provider cost is the settled receipts, model is the model ledger, total is both", () => {
  const c = missionCostFromLedgers({ spend_ledger: canaryLedger(), model_usd: 0.009653 });
  assert(c.provider_settled_usd > 0, "settled calls exist, so settled spend is not zero");
  assertEquals(c.provider_settled_usd, 0.0278, "0.0041 + 0.0036 + 0.0201");
  assertEquals(c.provider_pending_usd, 0);
  assertEquals(c.model_usd, 0.009653, "exactly the model ledger, not rounded to the provider's 4 places");
  assertEquals(c.total_usd, 0.037453);
});

Deno.test("WORKBENCH: an adopted or idempotently repeated call is counted once; refused and released count nothing", () => {
  const l = canaryLedger();
  // The same key reserved again (an idempotent skip) returns the SAME reservation.
  const again = reserve(l, { idempotency_key: "atomus", provider_call_id: "pc_atomus", purpose: "funding_evidence", route_id: null, estimate_usd: 0.0036 });
  assert(again.ok);
  assertEquals(l.reservations.filter((r) => r.idempotency_key === "atomus").length, 1);
  // A re-read of a run another reservation bought.
  reserve(l, { idempotency_key: "adopt", provider_call_id: "pc_adopt", purpose: "funding_evidence", route_id: null, estimate_usd: 0.0201 });
  markAdopted(l, "adopt");
  // A call that never ran.
  reserve(l, { idempotency_key: "never", provider_call_id: "pc_never", purpose: "funding_evidence", route_id: null, estimate_usd: 0.01 });
  l.reservations.find((r) => r.idempotency_key === "never")!.status = "released";
  const c = missionCostFromLedgers({ spend_ledger: l, model_usd: 0 });
  assertEquals([c.provider_settled_usd, c.provider_pending_usd], [0.0278, 0]);
});

Deno.test("WORKBENCH: a bought call not yet settled is PENDING at its provisional figure, not zero and not settled", () => {
  const l = canaryLedger();
  reserve(l, { idempotency_key: "slow", provider_call_id: "pc_slow", purpose: "funding_evidence", route_id: null, estimate_usd: 0.0201 });
  markExecuted(l, "slow", 0.0201);
  const c = missionCostFromLedgers({ spend_ledger: l, model_usd: 0.001 });
  assertEquals([c.provider_settled_usd, c.provider_pending_usd, c.total_usd], [0.0278, 0.0201, 0.0489]);
});

// ═══════════════════════════════════════════════ the stored ledgers ══

function fakeDb(tables: Record<string, Record<string, unknown>[]>): OutcomeDb {
  return {
    from: (t: string) => ({
      select: () => {
        const rows = tables[t] ?? [];
        const result = Promise.resolve({ data: rows, error: null });
        const chain = Object.assign(result, {
          eq: () => Object.assign(Promise.resolve({ data: rows, error: null }), {
            eq: () => Promise.resolve({ data: rows, error: null }),
            in: () => Promise.resolve({ data: rows, error: null }),
          }),
        });
        return chain;
      },
    }),
  } as unknown as OutcomeDb;
}

Deno.test("RUN OUTCOME: reported spend is the canonical cost — the canary's rows sum to $0.0278, not $0.0242", async () => {
  // lead_execution_calls for task abc316e8, as stored.
  const db = fakeDb({
    lead_execution_calls: [
      { record_kind: "provider_call", status: "succeeded", actual_cost_usd: 0.004, settled_usd: 0.0041, settlement_source: "provider_receipt" },
      { record_kind: "provider_call", status: "succeeded", actual_cost_usd: 0.0001, settled_usd: 0.0036, settlement_source: "provider_receipt" },
      { record_kind: "provider_call", status: "succeeded", actual_cost_usd: 0.0201, settled_usd: 0.0201, settlement_source: "provider_receipt" },
      // A resumed re-read: never settled, costs this call nothing, counted once.
      { record_kind: "provider_call", status: "reused", actual_cost_usd: null, settled_usd: null, settlement_source: null },
      { record_kind: "model_call", status: "succeeded", actual_cost_usd: null, settled_usd: null, settlement_source: null },
    ],
    credit_transactions: [],
  });
  const s = await readSpendFacts(db, "ws", ["abc316e8"]);
  assertEquals([s.usd_reported, s.provider_calls, s.reused_operations], [0.0278, 4, 1]);
});

Deno.test("MODEL LEDGER: the canary's four model calls sum to $0.009653; unpriced is counted, not free", async () => {
  const rows = [0.000451, 0.000257, 0.008466, 0.000479].map((c) => ({ estimated_cost_usd: c, actual_cost_usd: null, cost_source: "event_priced" }));
  const m = await readModelSpendUsd(fakeDb({ lead_model_calls: rows }), "ws", ["abc316e8"]);
  assertEquals([m.usd, m.priced_calls, m.unpriced_calls, m.ok], [0.009653, 4, 0, true]);
  const withUnknown = await readModelSpendUsd(fakeDb({
    lead_model_calls: [...rows, { estimated_cost_usd: null, actual_cost_usd: null, cost_source: "unknown" }],
  }), "ws", ["t"]);
  assertEquals([withUnknown.usd, withUnknown.unpriced_calls], [0.009653, 1]);
  const c = missionCostFromLedgers({ spend_ledger: canaryLedger(), model_usd: m.usd, model_unpriced_calls: m.unpriced_calls });
  assertEquals([c.provider_settled_usd, c.model_usd, c.total_usd], [0.0278, m.usd, 0.037453]);
});

Deno.test("RUN-AGENT: the view's cost comes from the ledgers, after settlement and after the reasoner", () => {
  const src = Deno.readTextFileSync(new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));
  const view = src.indexOf("return buildWorkbenchMissionView({\n                  mission: {\n                    requested_count: p5RequestedCount");
  assert(view > 0);
  const block = src.slice(src.lastIndexOf("const p5View =", view), src.indexOf("const p5Decision", view));
  assert(block.includes("cost: missionCostFromLedgers({"), "cost is read from the ledgers");
  assert(block.includes("spend_ledger: capabilityRun.state.spend_ledger"));
  assert(!block.includes("modelCalls.check().priced_usd ?? 0 }"), "not the pre-reasoner model snapshot");
  assert(block.indexOf("await reasonForCandidates(") < block.indexOf("modelCalls.check()"), "reasoner runs before model cost is read");
  // Both settlement passes precede the view.
  assert(src.indexOf("[run-agent][p2-spine][final]") < view);
  assert(src.indexOf("[run-agent][p2-spine][claim-verifier]") < view);
});

// ═══════════════════════ the price reads the input the call actually SENT ══

import { outcomeFromToolResultForTest, sentActorInput } from "../../../supabase/functions/_shared/toolRegistry.ts";

Deno.test("COMPANY SEARCH: a compiled envelope is priced from its payload — full-mode rows, not the start fee alone", () => {
  // Canary 6e4a93b9, runs uieidmanaOmb52ct2 / LdTEgbXfldnvFBoWs: 2 × full-company
  // at $0.004 + $0.001 start = $0.009 billed; the completion figure said $0.001
  // because pricing read the `compiled_actor_input: true` FLAG as the input.
  const envelope = {
    compiled_actor_input: true, selected_actor_key: "apify_linkedin_company_search",
    input: { maxItems: 2, locations: ["Germany"], companySize: ["51-200"], industryIds: ["4"], scraperMode: "full" },
  };
  assertEquals(sentActorInput(envelope).scraperMode, "full");
  const out = outcomeFromToolResultForTest({
    ok: true,
    data: {
      items: [{ name: "3CX" }, { name: "EMQ Technologies" }], run_id: "uieidmanaOmb52ct2",
      selected_actor_key: "apify_linkedin_company_search",
      provider_usage: {
        usageTotalUsd: 0.001, chargedEventCounts: { "apify-actor-start": 1 },
        eventPrices: { "apify-actor-start": 0.001, "short-company": 0.002, "full-company": 0.004 },
      },
    },
  } as never, envelope);
  assertEquals([out.cost?.source, out.cost?.actual_usd], ["provider_reported", 0.009]);
});

Deno.test("sentActorInput: a legacy envelope (no compiled flag) is its own input; a flag without a payload is not trusted", () => {
  const legacy = { scraperMode: "short", maxItems: 5 };
  assertEquals(sentActorInput(legacy), legacy);
  const flagOnly = { compiled_actor_input: true, input: "not an object" };
  assertEquals(sentActorInput(flagOnly), flagOnly);
});
