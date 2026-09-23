// WHAT A PROVIDER CALL COST, AND HOW WE KNOW.
//
// ── THE STATE THIS REPLACES ─────────────────────────────────────────────────
//
// Every row in `lead_execution_calls` carried `cost_source: "unknown"` and
// `actual_cost_usd: null`, on this justification in `toolRegistry`:
//
//     "Apify does not return a charge on the run object we poll, so nothing
//      here may claim `provider_reported`. A per-actor price table can promote
//      this later; until then the row says estimated and actual stays null."
//
// Half of that was never tested and half of it was already available. The per-
// actor price table it defers to EXISTS, is verified, and sits in
// `hiringActorCatalog` — `start_usd`, `per_result_usd`, `events_usd` and
// `minimum_total_usd`, priced at the benchmark account's BRONZE tier. Nothing
// consulted it. And the run object the poller already holds is the full
// `/actor-runs/{id}` document, whose contents were assumed rather than read.
//
// ── THREE WAYS TO KNOW A PRICE, NEVER MERGED ────────────────────────────────
//
//   provider_reported   the provider stated a charge for THIS run. The only
//                       figure allowed into `actual_cost_usd`, and the database
//                       enforces that with a CHECK constraint.
//   event_priced        computed from the verified card price table and the
//                       counts this run actually produced. Trustworthy to the
//                       cent, and still not the provider's own number.
//   estimated           a figure with no per-event basis.
//   unknown             nothing is known. Not zero — zero is a claim.
//
// The distinction between `event_priced` and `estimated` is the whole point of
// this module. Collapsing them would answer "what did this run cost?" with a
// number nobody can grade.
//
// PURE. No network, no database, no clock.

import { hiringActorCard, type ActorCostModel } from "./hiringActorCatalog.ts";
import type { ExecutionCost } from "./executionLedger.ts";

export const PROVIDER_COST_MODEL_VERSION = "provider-cost-model-v1" as const;

/**
 * The Apify run document, as far as pricing is concerned.
 *
 * Deliberately structural and deliberately optional. `usageTotalUsd` is read
 * because the run object is the natural place for a provider to state a charge
 * and reading it costs nothing; if Apify does not send it, this resolves to
 * null and the event table answers instead. That is a probe built into the
 * code rather than an assumption written into a comment.
 */
export interface ProviderRunUsage {
  usageTotalUsd?: unknown;
  usage?: { totalUsd?: unknown } | null;
  stats?: { computeUnits?: unknown } | null;
  /** Apify's own per-event charge counts for this run (`chargedEventCounts`). */
  chargedEventCounts?: Record<string, unknown> | null;
  /** The run's OWN published event prices, from `pricingInfo` — see `apifyEventPrices`. */
  eventPrices?: Record<string, unknown> | null;
}

/**
 * `event → USD` from an Apify run document's `pricingInfo`. The prices the
 * provider itself published FOR THIS RUN, so they are provider-reported, not an
 * estimate from our catalogue. Null when the run carries no pay-per-event table.
 */
export function apifyEventPrices(pricingInfo: unknown): Record<string, number> | null {
  const events = (pricingInfo as {
    pricingPerEvent?: { actorChargeEvents?: Record<string, { eventPriceUsd?: unknown }> };
  } | null | undefined)?.pricingPerEvent?.actorChargeEvents;
  if (!events || typeof events !== "object") return null;
  const out: Record<string, number> = {};
  for (const [name, ev] of Object.entries(events)) {
    const p = money(ev?.eventPriceUsd);
    if (p !== null) out[name] = p;
  }
  return Object.keys(out).length ? out : null;
}

/** A finite, non-negative number, or null. Zero is a real price; NaN is not. */
function money(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Round to the cent-fraction the ledger columns store — THE SAME WAY the spend
 * ledger's settlement rounds (`budgetPolicy.round4`). This used `toFixed(4)`,
 * which rounds a binary half down: the enrichment run Apify billed $0.00405 was
 * recorded at completion as $0.0040 and settled as $0.0041, a variance that
 * was nothing but two rounding rules (canary abc316e8).
 */
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * Which per-event price applies to one RESULT from this actor.
 *
 * Two actors charge different prices for the same row depending on how it was
 * asked for — `scraperMode: "short"` against `"full"` is a 2x difference on
 * company search, and the identity stage makes ~23 such calls a run. Pricing
 * those at one rate would make the largest line in the pipeline the least
 * accurate one.
 *
 * Explicit and small, because it encodes a fact about two actors rather than a
 * general rule. An actor not listed prices by `per_result_usd`, which is what
 * the card already publishes for exactly that purpose.
 */
export function resultEventName(
  actorKey: string, input: Record<string, unknown> | null | undefined,
): string | null {
  const mode = typeof input?.scraperMode === "string"
    ? input.scraperMode.toLowerCase() : null;
  switch (actorKey) {
    case "apify_linkedin_company_search":
      return mode === "short" ? "short-company" : mode === "full" ? "full-company" : null;
    case "apify_linkedin_people_search":
    case "apify_linkedin_profile_search":
      // The email variant is a third price, and asking for it is explicit.
      if (input?.enrichEmails === true || input?.includeEmail === true) {
        return "full-profile-with-email";
      }
      return mode === "short" ? "short-profile" : mode === "full" ? "full-profile" : null;
    // THE FUNDING PAIR. Named exactly as each run's `pricingInfo` publishes its
    // per-result event (read from runs yXMNWcg0RHbhY4Fsh and 6u7BzSMsN27YrSeFH,
    // 2026-09-23). Unnamed, the completion-time floor below had no per-result
    // price for atomus and recorded its $0.00005 start fee as the whole charge:
    // `actual_cost_usd: 0.0001` against a receipt of $0.00355.
    case "apify_funding_atomus":
      return "company-enriched";
    case "apify_funding_pvalyou":
      return String(input?.tier ?? "basic") === "full" ? "company_full" : "company_basic";
    default:
      return null;
  }
}

/**
 * How many of a run's rows the provider BILLS for.
 *
 * Every row is billed on most actors. Two charge only for a company they found,
 * and return a free row for one they did not: atomus (`status: "success"` with a
 * company) and pvalyou (a record, not `not_found`). Counting the free rows would
 * price a miss as a hit. The tests are the ones the normalizers use to decide a
 * row found anything (`normalizeAtomusFunding`, `normalizePvalyouFunding`).
 */
export function billableResultCount(actorKey: string, rows: readonly unknown[] | null | undefined): number | null {
  if (!Array.isArray(rows)) return null;
  const obj = (v: unknown): Record<string, unknown> =>
    v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
  switch (actorKey) {
    case "apify_funding_atomus":
      return rows.filter((r) => obj(r).status === "success" && Object.keys(obj(obj(r).company)).length > 0).length;
    case "apify_funding_pvalyou":
      return rows.filter((r) => obj(r).status !== "not_found" && Object.keys(obj(obj(r).record)).length > 0).length;
    default:
      return rows.length;
  }
}

/**
 * Price one result, in order of what is actually known about this actor.
 *
 * A named event beats the flat rate, because the flat rate on a mode-priced
 * actor is an average of two prices and matches neither.
 */
function perResultUsd(
  cost: ActorCostModel, actorKey: string, input: Record<string, unknown> | null | undefined,
): number | null {
  const event = resultEventName(actorKey, input);
  const named = event ? money(cost.events_usd?.[event]) : null;
  return named ?? money(cost.per_result_usd);
}

/** The start charge, preferring the named event over the summary field. */
function startUsd(cost: ActorCostModel): number {
  const named = money(cost.events_usd?.["apify-actor-start"])
    ?? money(cost.events_usd?.["actor-start"]);
  return named ?? money(cost.start_usd) ?? 0;
}

export interface PriceProviderCallInput {
  /** The engine's actor key, e.g. `apify_linkedin_company_search`. */
  actorKey: string;
  /** Rows the run produced. Null when the call failed before producing any. */
  itemCount?: number | null;
  /** The compiled actor input, for mode-dependent pricing. */
  input?: Record<string, unknown> | null;
  /** The provider's own run document, if one was obtained. */
  run?: ProviderRunUsage | null;
  /** False for a call that never started — a reused run charges nothing new. */
  started?: boolean;
  /**
   * THIS CALL RE-READ A RUN SOMEBODY ELSE ALREADY BOUGHT.
   *
   * The only condition under which zero is a MEASURED answer rather than an
   * absence of one. `started === false` alone cannot carry it: a provider that
   * has no run ids at all — Firecrawl's `/scrape` is synchronous and returns
   * none — reports `started: false` on every failure, and was priced as a free
   * adoption on that basis.
   */
  adopted?: boolean;
}

/**
 * What this call cost, with provenance.
 *
 * NEVER THROWS and never guesses upward. An actor with no card, or a card with
 * no usable price, returns `unknown` rather than zero: "we did not spend" and
 * "we do not know" are different answers and only one of them is honest here.
 */
export function priceProviderCall(i: PriceProviderCallInput): ExecutionCost {
  // ── 0. AN ADOPTED RUN COSTS THIS CALL NOTHING ───────────────────────────
  //
  // FIRST, and that ordering is the whole point. This test used to sit below the
  // provider-reported branch, where it could never be reached for the actors
  // that matter: adopting a run is `GET /actor-runs/{id}`, and Apify answers
  // with the full run document INCLUDING its usage. So the branch below read a
  // real `usageTotalUsd` — what the ORIGINAL run cost — and recorded it as the
  // cost of the re-read.
  //
  // Live on 2026-08-29: task 0ed83116 adopted run G9ppGtOL11gNZr9Af, reported
  // `status: "reused"` exactly as designed, and still wrote
  // `actual_cost_usd: 0.000100` — the price of a purchase another row had
  // already recorded. The lineage's spend was overstated by every adoption it
  // made, which is precisely the opposite of what adoption is for.
  //
  // "What did the run cost" and "what did THIS CALL cost" are different
  // questions. The run was bought once, by the row that started it; re-reading
  // its dataset is free. Zero is not a rounding of a small number here — it is
  // the correct answer.
  //
  // ── AND "NOT STARTED" IS NOT THE SAME AS "ADOPTED" ──────────────────────
  //
  // This test read `started === false` alone, which is true of an adopted run
  // AND of a provider that has no run ids to report. Firecrawl's `/scrape` is
  // synchronous and returns none, so `started: runId !== null` was false on
  // every failed scrape and 39 failed Firecrawl calls were recorded as
  // `event_priced` at exactly $0.00 — the ledger asserting, on its highest
  // provenance grade short of the provider's own figure, that a failed call
  // was free.
  //
  // `modelCostModel` already states the rule one layer over: "NO USAGE
  // REPORTED IS NOT A FREE CALL... during an outage every row would read as a
  // priced, free call and the bill would look untouched while nothing worked."
  // The same rule belongs here. Without a positive adoption signal the honest
  // answer falls through to the card, and to `unknown` when there is no card.
  if (i.started === false && i.adopted === true) {
    return { actual_usd: null, estimated_usd: 0, source: "event_priced" };
  }

  // ── 1. DID THE PROVIDER SAY? ────────────────────────────────────────────
  //
  // Checked first and read from two shapes, because a provider that reports a
  // charge is the only source that can settle the question. If Apify never
  // populates either, this branch simply never fires and the ledger will show
  // `event_priced` on every row — which is itself the answer to "does the run
  // object carry a charge?", recorded rather than assumed.
  //
  // ── AND APIFY SETTLES LATE ──────────────────────────────────────────────
  //
  // Lead V2 run 4250f181 recorded $0.059 for twenty runs Apify billed $0.355.
  // The run document read at SUCCEEDED carried a `usageTotalUsd` that held only
  // the start fee — $0.001 for a LinkedIn search that returned 3 rows and cost
  // $0.007, $0.008 for a memo23 call that returned 10 and cost $0.018. Every
  // per-result event was charged after that read.
  //
  // Three figures, ALL from the provider, and the largest is the truth: the
  // usage total; the charged event counts at the run's own published prices;
  // and the run's own start price plus its result price times the rows it
  // actually returned — the minimum Apify bills for those rows. The MAX, never
  // the sum: a settled document makes all three agree.
  const reported = money(i.run?.usageTotalUsd) ?? money(i.run?.usage?.totalUsd);
  const prices = i.run?.eventPrices && typeof i.run.eventPrices === "object"
    ? i.run.eventPrices as Record<string, unknown> : null;
  let eventsUsd: number | null = null;
  if (prices && i.run?.chargedEventCounts && typeof i.run.chargedEventCounts === "object") {
    eventsUsd = 0;
    for (const [name, count] of Object.entries(i.run.chargedEventCounts)) {
      const p = money(prices[name]); const n = money(count);
      if (p !== null && n !== null) eventsUsd += p * n;
    }
  }
  let itemsUsd: number | null = null;
  const itemRows = Math.max(0, Math.trunc(Number(i.itemCount ?? 0)) || 0);
  if (prices) {
    const start = money(prices["apify-actor-start"]) ?? money(prices["actor-start"]) ?? 0;
    const event = resultEventName(i.actorKey, i.input);
    const perRow = (event ? money(prices[event]) : null) ?? money(prices["apify-default-dataset-item"]);
    if (perRow !== null || itemRows === 0) itemsUsd = start + itemRows * (perRow ?? 0);
  }
  if (reported !== null || eventsUsd !== null) {
    const actual = Math.max(reported ?? 0, eventsUsd ?? 0, itemsUsd ?? 0);
    return { actual_usd: round4(actual), estimated_usd: null, source: "provider_reported" };
  }

  const card = hiringActorCard(i.actorKey);
  if (!card) return { actual_usd: null, estimated_usd: null, source: "unknown" };

  const cost = card.cost_model;
  const rows = Math.max(0, Math.trunc(Number(i.itemCount ?? 0)) || 0);
  const per = perResultUsd(cost, i.actorKey, i.input);
  if (per === null && rows > 0) {
    // Rows were produced and nothing prices them. Saying "just the start fee"
    // would understate it; `estimated` marks the figure as ungraded.
    return { actual_usd: null, estimated_usd: round4(startUsd(cost)), source: "estimated" };
  }

  const raw = startUsd(cost) + rows * (per ?? 0);
  // The floor is part of the published price, not a safety margin: several of
  // these actors bill a minimum whatever the run returned.
  const floored = Math.max(raw, money(cost.minimum_total_usd) ?? 0);
  return { actual_usd: null, estimated_usd: round4(floored), source: "event_priced" };
}
