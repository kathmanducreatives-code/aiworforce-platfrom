// ONE PRICE SOURCE: THE ACTOR'S CATALOG CARD.
//
// The Datahyena per-record price was written in five places — the card, the
// intelligence registry, a compiler refusal message, the capability graph and
// the readiness table. When the Store repriced, the card moved and the others
// kept quoting the old number; the refusal message under-stated the cost of the
// call it was refusing. These tests hold the rule that stops that recurring:
// the card is the price, everything else reads it.
//
// And the run budget (runBudget.ts) had no tests of its own: the tighten-only
// guarantee, the one-lead pool and the pre-execution refusal are pinned here.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { APIFY_INTELLIGENCE } from "../../../supabase/functions/_shared/apifyIntelligenceRegistry.ts";
import { HIRING_ACTOR_CATALOG, perResultPriceUsd } from "../../../supabase/functions/_shared/hiringActorCatalog.ts";
import {
  affordableRows, callCeilingFor, DEFAULT_CEILINGS, estimateCallUsd,
} from "../../../supabase/functions/_shared/budgetPolicy.ts";
import {
  candidatePool, parseRunBudget, tightenCeilings,
} from "../../../supabase/functions/_shared/runBudget.ts";

const DATAHYENA = "apify_funding_rounds_datahyena";
const card = (k: string) => HIRING_ACTOR_CATALOG[k];

Deno.test("the registry's Datahyena price IS the card's price", () => {
  const reg = APIFY_INTELLIGENCE[card(DATAHYENA).actor_id];
  assertEquals(reg.cost.per_result_usd, perResultPriceUsd(DATAHYENA));
  assertEquals(reg.cost.start_usd, card(DATAHYENA).cost_model.start_usd);
});

Deno.test("every registry price is one the Actor's card publishes", () => {
  // The registry keeps one row price; a card may publish several (short vs
  // full rows). The registry may pick any of them — never one the card lacks.
  const byActorId = new Map(Object.values(HIRING_ACTOR_CATALOG).map((c) => [c.actor_id, c]));
  let compared = 0;
  for (const [actorId, rec] of Object.entries(APIFY_INTELLIGENCE)) {
    const c = byActorId.get(actorId);
    if (!c) continue;
    compared++;
    const published = new Set<number>([
      ...(c.cost_model.per_result_usd == null ? [] : [c.cost_model.per_result_usd]),
      ...Object.values(c.cost_model.events_usd ?? {}),
    ]);
    assert(published.has(rec.cost.per_result_usd),
      `${actorId}: registry row price ${rec.cost.per_result_usd} is not on its card (${[...published]})`);
    assertEquals(rec.cost.start_usd, c.cost_model.start_usd, `${actorId}: start price drifted from its card`);
  }
  assert(compared >= 5, "the cross-check compared too few Actors to mean anything");
});

Deno.test("no Lead V2 source outside the card quotes the Datahyena price", async () => {
  const price = perResultPriceUsd(DATAHYENA)!;
  const literal = `$${price}`;
  const offenders: string[] = [];
  const roots = ["_shared", "run-agent", "orchestrate", "pilot-chat"];
  for (const root of roots) {
    const dir = new URL(`../../../supabase/functions/${root}/`, import.meta.url);
    for await (const e of Deno.readDir(dir)) {
      if (!e.isFile || !e.name.endsWith(".ts") || e.name === "hiringActorCatalog.ts") continue;
      const text = await Deno.readTextFile(new URL(e.name, dir));
      // `$0.07` but not `$0.070…` or `$0.075` — the exact per-record figure.
      if (new RegExp(`\\${literal.replace(".", "\\.")}(?![0-9])`).test(text)) offenders.push(`${root}/${e.name}`);
    }
  }
  assertEquals(offenders, [], `the price belongs on the card only: ${offenders.join(", ")}`);
});

Deno.test("a full Pvalyou read is priced as full, not as the basic profile", () => {
  const m = card("apify_funding_pvalyou").cost_model;
  const basic = estimateCallUsd("apify_funding_pvalyou", m, { tier: "basic", companies: ["x"] });
  const full = estimateCallUsd("apify_funding_pvalyou", m, { tier: "full", companies: ["x"] });
  assertEquals(basic, Math.round((m.start_usd + m.events_usd!["company_basic"]) * 1e4) / 1e4);
  assertEquals(full, Math.round((m.start_usd + m.events_usd!["company_full"]) * 1e4) / 1e4);
  assert(full > basic);
});

// ── THE RUN BUDGET ─────────────────────────────────────────────────────────

Deno.test("run_budget: anything but a positive finite number names no budget", () => {
  assertEquals(parseRunBudget(null), null);
  assertEquals(parseRunBudget([]), null);
  assertEquals(parseRunBudget({ provider_usd: "0.10" }), null);
  assertEquals(parseRunBudget({ provider_usd: 0, max_candidates: -1 }), null);
  assertEquals(parseRunBudget({ provider_usd: Infinity }), null);
  assertEquals(parseRunBudget({ max_candidates: 0.5 }), null);
  assertEquals(parseRunBudget({ provider_usd: 0.1, max_candidates: 2.9 }), { provider_usd: 0.1, max_candidates: 2 });
});

Deno.test("candidate pool: unchanged without a budget, lowered with one, never widened", () => {
  assertEquals(candidatePool(1, null), 10);
  assertEquals(candidatePool(3, null), 30);
  assertEquals(candidatePool(1, { provider_usd: null, max_candidates: 1 }), 1);
  // Never below the leads owed…
  assertEquals(candidatePool(3, { provider_usd: null, max_candidates: 1 }), 3);
  // …and never above the default.
  assertEquals(candidatePool(1, { provider_usd: null, max_candidates: 500 }), 10);
});

Deno.test("tightenCeilings only lowers, and leaves model spend alone", () => {
  const t = tightenCeilings(DEFAULT_CEILINGS, { provider_usd: 0.1, max_candidates: null });
  assertEquals(t.mission_provider_usd, 0.1);
  for (const v of Object.values(t.per_route_usd)) assert(v <= 0.1);
  for (const v of Object.values(t.per_call_usd)) assert(v == null || v <= 0.1);
  assert(t.per_candidate_evidence_usd <= 0.1);
  assertEquals(t.mission_model_usd, DEFAULT_CEILINGS.mission_model_usd);
  // A budget above the default changes nothing.
  assertEquals(tightenCeilings(DEFAULT_CEILINGS, { provider_usd: 50, max_candidates: null }), {
    ...DEFAULT_CEILINGS,
    per_route_usd: DEFAULT_CEILINGS.per_route_usd,
    per_call_usd: DEFAULT_CEILINGS.per_call_usd,
  });
  assertEquals(tightenCeilings(DEFAULT_CEILINGS, null), DEFAULT_CEILINGS);
});

Deno.test("a one-lead funding-discovery call is refused or clamped before it runs under a small budget", () => {
  const m = card(DATAHYENA).cost_model;
  const tenRows = estimateCallUsd(DATAHYENA, m, { maxItems: candidatePool(1, null) });
  const defaultCeiling = callCeilingFor(DEFAULT_CEILINGS, "discovery", "funding");
  const budget = { provider_usd: 0.1, max_candidates: 1 };
  const tight = tightenCeilings(DEFAULT_CEILINGS, budget);
  const tightCeiling = callCeilingFor(tight, "discovery", "funding");
  // The defect: the default ceiling admits the ten-record call for one lead.
  assert(tenRows <= defaultCeiling);
  // Under the budget, the same call no longer fits, and the clamp affords at most one row.
  assertFalse(tenRows <= tightCeiling);
  assert(affordableRows(DATAHYENA, m, { maxItems: 1 }, tightCeiling) <= 1);
  assert(estimateCallUsd(DATAHYENA, m, { maxItems: candidatePool(1, budget) }) <= tightCeiling);
});
