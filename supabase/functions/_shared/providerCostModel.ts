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
}

/** A finite, non-negative number, or null. Zero is a real price; NaN is not. */
function money(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Round to the cent-fraction the ledger columns store. */
const round4 = (n: number) => Number(n.toFixed(4));

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
    default:
      return null;
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
}

/**
 * What this call cost, with provenance.
 *
 * NEVER THROWS and never guesses upward. An actor with no card, or a card with
 * no usable price, returns `unknown` rather than zero: "we did not spend" and
 * "we do not know" are different answers and only one of them is honest here.
 */
export function priceProviderCall(i: PriceProviderCallInput): ExecutionCost {
  // ── 1. DID THE PROVIDER SAY? ────────────────────────────────────────────
  //
  // Checked first and read from two shapes, because a provider that reports a
  // charge is the only source that can settle the question. If Apify never
  // populates either, this branch simply never fires and the ledger will show
  // `event_priced` on every row — which is itself the answer to "does the run
  // object carry a charge?", recorded rather than assumed.
  const reported = money(i.run?.usageTotalUsd) ?? money(i.run?.usage?.totalUsd);
  if (reported !== null) {
    return { actual_usd: round4(reported), estimated_usd: null, source: "provider_reported" };
  }

  const card = hiringActorCard(i.actorKey);
  if (!card) return { actual_usd: null, estimated_usd: null, source: "unknown" };

  // ── 2. A RUN THAT NEVER STARTED COSTS NOTHING ───────────────────────────
  //
  // A resumed run is adopted, not bought again — the start charge already
  // happened on the run being adopted, and charging it twice would make the
  // idempotency guard look like it costs money to use.
  if (i.started === false) {
    return { actual_usd: null, estimated_usd: 0, source: "event_priced" };
  }

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
