// FIRECRAWL SPEND REACHES THE RUN OUTCOME.
//
// Production ComfyUI canary, plan 6f6be04b / task 26b76ebf (2026-09-26):
//
//   run_outcome.spend.usd_reported          $0.0298   (Apify only)
//   workbench_mission_view.cost.provider_settled_usd   $0.049
//   Firecrawl: 1 map + 2 pages × $0.0064 = $0.0192, settled `derived_floor`
//
// Two readers of one ledger, two answers. The Workbench sums the spend
// ledger's settled reservations. `run_outcome` reads the `lead_execution_calls`
// rows through `canonicalProviderCostUsd`, which took `settled_usd` only from a
// `provider_receipt` and otherwise `actual_cost_usd` — and a Firecrawl row's
// `actual_cost_usd` is null by construction (`priceFirecrawlCall`: credits are
// not dollars; a database CHECK enforces it). With no `FIRECRAWL_USD_PER_CREDIT`
// in production the row's own estimate is null too, so every Firecrawl call
// read as UNPRICED and fell out of the total while still being counted in
// `provider_calls`.
//
// Firecrawl never issues a receipt. `settleByPublishedRule` closes each call at
// once, final, at the published credit rule × the rate — the figure the
// ceilings and the Workbench already count. The reader now takes it, for such
// providers only; an Apify `derived_floor` (provisional, awaiting a receipt)
// keeps its old meaning. Pricing is untouched.
//
// Each Firecrawl row below is built by the real chain: `priceFirecrawlCall`
// under production's env → `buildFinalPatch` → the spine's `settlementPatches`
// from a spend ledger closed by `settleByPublishedRule`. The Apify totals are
// production's; the per-row split of the $0.0298 is illustrative.
//
// ZERO network, providers, models or database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildFinalPatch, canonicalProviderCostUsd, PUBLISHED_RULE_SETTLED_PROVIDERS,
} from "../../../supabase/functions/_shared/executionLedger.ts";
import { priceFirecrawlCall } from "../../../supabase/functions/_shared/firecrawlCostModel.ts";
import {
  DEFAULT_CEILINGS, markExecuted, newSpendLedger, reserve, settle, settleByPublishedRule,
} from "../../../supabase/functions/_shared/budgetPolicy.ts";
import { settlementPatches } from "../../../supabase/functions/_shared/p2SpinePersistence.ts";
import { readSpendFacts, type OutcomeDb } from "../../../supabase/functions/_shared/runOutcome.ts";
import { missionCostFromLedgers } from "../../../supabase/functions/_shared/workbenchMissionView.ts";

globalThis.fetch = () => { throw new Error("these tests must not reach the network"); };

/** The production fallback rate (`FIRECRAWL_BUDGET_USD_PER_CREDIT`); production sets no account rate. */
const RATE = 0.0064;
const APIFY: Array<[string, number]> = [
  ["apify_linkedin_company_details", 0.0041], ["apify_funding_atomus", 0.0036],
  ["apify_funding_pvalyou", 0.0201], ["apify_linkedin_job_search", 0.002],
];
const FIRECRAWL = ["firecrawl_map", "scrape_platform", "scrape_pricing"];

/** The mission's spend ledger as the run left it: Apify by receipt, Firecrawl by published rule. */
function comfyLedger() {
  const l = newSpendLedger(DEFAULT_CEILINGS);
  for (const [key, usd] of APIFY) {
    reserve(l, { idempotency_key: key, provider_call_id: `pc_${key}`, purpose: "funding_evidence", route_id: null, estimate_usd: usd });
    markExecuted(l, key, usd);
    settle(l, key, usd);
  }
  for (const key of FIRECRAWL) {
    reserve(l, { idempotency_key: key, provider_call_id: `pc_${key}`, purpose: "web_evidence", route_id: null, estimate_usd: RATE });
    markExecuted(l, key, RATE);
    settleByPublishedRule(l, key, RATE);
  }
  return l;
}

/** The `lead_execution_calls` rows for the task, as the tool path and the spine leave them. */
function comfyRows(): Array<Record<string, unknown>> {
  const patches = new Map(settlementPatches(comfyLedger()).map((p) => [p.idempotency_key, p.patch]));
  const apify = APIFY.map(([key, usd]) => ({
    record_kind: "provider_call", status: "succeeded", provider_id: "apify",
    actual_cost_usd: usd, ...patches.get(key),
  }));
  const firecrawl = FIRECRAWL.map((key) => {
    // Production's env: no FIRECRAWL_USD_PER_CREDIT, so the row's own price is unknown.
    const cost = priceFirecrawlCall({ credits: 1, basis: "published_rate", read: () => undefined });
    const closed = buildFinalPatch({ started_at: new Date().toISOString() }, { status: "succeeded", cost } as never);
    return { record_kind: "provider_call", provider_id: "firecrawl", ...closed, ...patches.get(key) };
  });
  return [...apify, ...firecrawl];
}

function fakeDb(rows: Record<string, unknown>[], seen: string[] = []): OutcomeDb {
  const table = (t: string) => t === "lead_execution_calls" ? rows : [];
  return {
    from: (t: string) => ({
      select: (cols: string) => {
        seen.push(`${t}:${cols}`);
        const done = Promise.resolve({ data: table(t), error: null });
        return Object.assign(done, { eq: () => Object.assign(done, { in: () => done }) });
      },
    }),
  } as unknown as OutcomeDb;
}

// ── THE ROW IS WHAT PRODUCTION STORED ─────────────────────────────────────────

Deno.test("a Firecrawl row carries no actual cost and a final `derived_floor` settlement", () => {
  const fc = comfyRows().filter((r) => r.provider_id === "firecrawl");
  assertEquals(fc.length, 3);
  for (const r of fc) {
    assertEquals([r.actual_cost_usd, r.cost_source, r.settled_usd, r.settlement_source], [null, "unknown", RATE, "derived_floor"]);
    assertEquals(r.variance_usd, 0, "closed by `settleByPublishedRule`, not left provisional");
  }
});

// ── THE FIX ──────────────────────────────────────────────────────────────────

Deno.test("ComfyUI: run_outcome reports $0.049 — Apify $0.0298 + Firecrawl $0.0192 — not $0.0298", async () => {
  const s = await readSpendFacts(fakeDb(comfyRows()), "ws", ["26b76ebf"]);
  assertEquals([s.usd_reported, s.provider_calls], [0.049, 7]);
});

Deno.test("run_outcome and the Workbench now read the same provider total from the same run", async () => {
  const s = await readSpendFacts(fakeDb(comfyRows()), "ws", ["26b76ebf"]);
  const view = missionCostFromLedgers({ spend_ledger: comfyLedger(), model_usd: 0 });
  assertEquals([view.provider_settled_usd, view.provider_pending_usd], [0.049, 0]);
  assertEquals(s.usd_reported, view.provider_settled_usd);
});

Deno.test("the spend reader asks for the row's provider — without it no Firecrawl row can be recognised", async () => {
  const seen: string[] = [];
  await readSpendFacts(fakeDb(comfyRows(), seen), "ws", ["t"]);
  const cols = seen.find((x) => x.startsWith("lead_execution_calls:"))!.split(":")[1].split(",").map((c) => c.trim());
  assert(cols.includes("provider_id"), cols.join(","));
});

// ── WHAT DOES NOT MOVE ───────────────────────────────────────────────────────

Deno.test("canonical: an Apify `derived_floor` with no actual is still unknown; a receipt still wins", () => {
  assertEquals(canonicalProviderCostUsd({ provider_id: "apify", actual_cost_usd: null, settled_usd: 0.0041, settlement_source: "derived_floor" }), null,
    "provisional, awaiting a receipt — unchanged");
  assertEquals(canonicalProviderCostUsd({ actual_cost_usd: null, settled_usd: 0.0041, settlement_source: "derived_floor" }), null,
    "no provider named ⇒ the old rule");
  assertEquals(canonicalProviderCostUsd({ provider_id: "apify", actual_cost_usd: 0.0001, settled_usd: 0.0036, settlement_source: "provider_receipt" }), 0.0036);
  assertEquals(canonicalProviderCostUsd({ provider_id: "apify", actual_cost_usd: 0.004, settled_usd: 0.0041, settlement_source: "derived_floor" }), 0.004);
});

Deno.test("canonical: a Firecrawl row with nothing settled is unknown, never zero", () => {
  assertEquals(canonicalProviderCostUsd({ provider_id: "firecrawl", actual_cost_usd: null, settled_usd: null, settlement_source: null }), null);
  assertEquals(canonicalProviderCostUsd({ provider_id: "firecrawl", actual_cost_usd: null, settled_usd: null, settlement_source: "derived_floor" }), null);
  assertEquals(canonicalProviderCostUsd({ provider_id: "firecrawl", actual_cost_usd: null, settled_usd: "0.0064", settlement_source: "derived_floor" }), 0.0064,
    "numeric strings from PostgREST");
});

Deno.test("only providers that never issue a receipt are settled by their published rule", () => {
  assertEquals([...PUBLISHED_RULE_SETTLED_PROVIDERS], ["firecrawl"]);
});

Deno.test("pricing is untouched: a Firecrawl call still never claims a provider-reported charge", () => {
  const unrated = priceFirecrawlCall({ credits: 1, basis: "published_rate", read: () => undefined });
  assertEquals([unrated.actual_usd, unrated.estimated_usd, unrated.source], [null, null, "unknown"]);
  const rated = priceFirecrawlCall({ credits: 1, basis: "published_rate", read: (k) => k === "FIRECRAWL_USD_PER_CREDIT" ? "0.005" : undefined });
  assertEquals([rated.actual_usd, rated.estimated_usd, rated.source], [null, 0.005, "event_priced"]);
});
