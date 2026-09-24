// LEAD V2 — A CLAIM VERIFIER'S CALL, COMPILED LIKE EVERY OTHER PROVIDER CALL.
//
// The verifier decides WHAT to ask (which companies, which tier); this turns
// that into a ProviderCallSpec with the same compiler the engine uses, so the
// verifier path gets the same answers to the same questions:
//
//   may it run?            the mission's readiness policy (refused_policy)
//   what exactly is sent?  the live input contract; unknown fields dropped
//   how much can it bill?  billable units from the card's multiplier fields
//   what can it cost?      the card's canonical price × those units, against
//                          the call ceiling (refused_budget)
//   which purchase is it?  one idempotency key per exact input in the lineage
//
// There is no planner proposal for a verifier call — the gap router chose the
// route and the verifier built the input — so the input is recorded as the
// engine's, with its provenance.
//
// Pure.

import type { Ceilings, CostModelLike } from "./budgetPolicy.ts";
import type { VerifierCall } from "./claimVerifier.ts";
import type { CriteriaExecutionPolicy } from "./criteriaExecutionPolicy.ts";
import { ACTOR_INPUT_CONTRACTS } from "./actorInputContracts.ts";
import { hiringActorCard } from "./hiringActorCatalog.ts";
import { compileProviderCallSpec, type ProviderCallSpec } from "./providerCallSpec.ts";
import type { ReadinessPolicy } from "./routeReadiness.ts";

/** Which run-budget route a verifier capability spends from. */
const VERIFIER_ROUTE_ANCHOR: Readonly<Record<string, string>> = Object.freeze({
  funding_verification: "funding", hiring_verification: "hiring", web_evidence: "company_profile",
});

/** An actor with no card price is unaffordable, never free: its estimate is Infinity. */
const UNPRICED: CostModelLike = Object.freeze({ start_usd: Number.POSITIVE_INFINITY, per_result_usd: Number.POSITIVE_INFINITY });

export interface VerifierSpecContext {
  scope: { workspace_id: string; lineage_id: string };
  mission_hash: string;
  policy: CriteriaExecutionPolicy;
  /** Read per call: the ledger's ceilings, already tightened by the run budget. */
  ceilings: () => Ceilings;
  readiness: ReadinessPolicy;
  plan?: { plan_id: string | null; version: number | null } | null;
}

export function verifierSpecCompiler(o: VerifierSpecContext): (c: VerifierCall) => ProviderCallSpec {
  return (c) => {
    const card = hiringActorCard(c.actor_key);
    return compileProviderCallSpec({
      actorKey: c.actor_key, capability: c.capability, purpose: c.purpose,
      proposed: null, engine: c.input, policy: o.policy,
      plan: {
        plan_id: o.plan?.plan_id ?? null, version: o.plan?.version ?? null,
        // The per-route ceiling this call draws on, by the capability it serves.
        route_id: null, route_anchor: VERIFIER_ROUTE_ANCHOR[c.capability] ?? "funding", route_refused: null,
      },
      candidate_keys: c.candidate_keys, scope: o.scope, mission_hash: o.mission_hash,
      ceilings: o.ceilings(),
      cost_model: card?.cost_model ?? UNPRICED,
      contract_fields: ACTOR_INPUT_CONTRACTS[c.actor_key]?.fields ?? null,
      card_enums: card?.verified_enums, card_limits: card?.input_limits,
      readiness: o.readiness,
    });
  };
}
