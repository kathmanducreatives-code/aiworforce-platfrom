// LEAD V2 — THE CLAIM PLAN: WHAT MUST BE PROVEN, AND WHAT CAN PROVE IT.
//
//   user query → mission compiler → criteria
//        ↓
//   CLAIM PLAN
//     hard claims   each with: carried by the chosen discovery entry?  the
//                   READY verification routes that can answer it (cheapest
//                   first)?  or nothing — PENDING by design, said up front
//     targets       rank only; never bought for
//     signals       opportunity signals; rank only
//
// There is no fixed "jobs → company → web → funding → employees" sequence
// anywhere in it. What runs after discovery is exactly the verifiers whose
// routes answer a HARD claim the entry did not already carry — and the
// verification phase reads this plan to know which verifiers are relevant at
// all (`claimVerificationPhase.ts`).
//
// Pure.

import { deriveMissionCriteria, type MissionCriterion } from "./missionCriteria.ts";
import type { LeadMissionV1 } from "./leadMission.ts";
import { CLAIM_REGISTRY, claimFor, type ClaimDefinition } from "./evidenceGapRouter.ts";
import { PRODUCTION_READINESS, type ReadinessPolicy } from "./routeReadiness.ts";

export const CLAIM_PLAN_VERSION = "claim-plan-v1" as const;

/**
 * Evidence a discovery entry's own rows carry. A claim here arrives WITH the
 * candidate (it may still be only plausible, and verification still reads it
 * first); a claim absent here must be bought per company or stays PENDING.
 */
const ENTRY_CARRIES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  job_discovery: ["hiring"],
  // A round is funding evidence; against a stage it can contradict (a later
  // round) but never prove (one event is not a history).
  funding_signal_discovery: ["funding", "company_stage"],
  startup_company_discovery: [],
  general_company_discovery: [],
  known_company_resolution: [],
});

export interface ClaimPlanRoute { actor: string; capability: string; cost_hint_usd: number }

export interface HardClaimPlan {
  criterion_id: string;
  dimension: string;
  value: unknown;
  claim: string | null;
  /** The entry's rows carry evidence for it. */
  carried_by_entry: boolean;
  /** Executable verification routes, cheapest first. */
  routes: ClaimPlanRoute[];
  status: "verifiable" | "carried" | "blocked";
  why: string;
}

export interface ClaimPlan {
  version: typeof CLAIM_PLAN_VERSION;
  entry_capability: string | null;
  hard: HardClaimPlan[];
  /** Ranking only. Never a purchase. */
  targets: Array<{ criterion_id: string; dimension: string; value: unknown }>;
  opportunity_signals: Array<{ criterion_id: string; dimension: string }>;
  /** Hard criteria no current source proves — disclosed, not checked. */
  unprovable: Array<{ criterion_id: string; dimension: string; label: string }>;
}

export function buildClaimPlan(
  criteria: readonly MissionCriterion[],
  entry: string | null,
  readiness: ReadinessPolicy = PRODUCTION_READINESS,
  registry: readonly ClaimDefinition[] = CLAIM_REGISTRY,
): ClaimPlan {
  const carries = new Set(ENTRY_CARRIES[entry ?? ""] ?? []);
  const plan: ClaimPlan = {
    version: CLAIM_PLAN_VERSION, entry_capability: entry, hard: [], targets: [], opportunity_signals: [], unprovable: [],
  };
  for (const c of criteria) {
    if (c.status !== "ok") {
      if (c.kind === "hard") plan.unprovable.push({ criterion_id: c.id, dimension: c.dimension, label: c.label });
      continue;
    }
    if (c.kind === "target") { plan.targets.push({ criterion_id: c.id, dimension: c.dimension, value: c.value }); continue; }
    if (c.kind !== "hard") { plan.opportunity_signals.push({ criterion_id: c.id, dimension: c.dimension }); continue; }
    const def = claimFor(c.dimension, registry);
    const routes = (def?.routes ?? [])
      .filter((r) => r.canonical_executor && readiness.decide(r.actor, r.capability).executable)
      .sort((a, b) => a.cost_hint_usd - b.cost_hint_usd)
      .map((r) => ({ actor: r.actor, capability: r.capability, cost_hint_usd: r.cost_hint_usd }));
    const carried = carries.has(c.dimension) || (def?.evidence ?? []).some((e) => carries.has(e));
    const status: HardClaimPlan["status"] = routes.length > 0 ? "verifiable" : carried ? "carried" : "blocked";
    plan.hard.push({
      criterion_id: c.id, dimension: c.dimension, value: c.value, claim: def?.claim ?? null,
      carried_by_entry: carried, routes, status,
      why: status === "verifiable"
        ? `${routes.map((r) => r.actor).join(" → ")} can answer it per company`
        : status === "carried"
        ? `${entry} carries it; no ready route can re-verify it`
        : "no ready route answers it and discovery does not carry it: it stays PENDING",
    });
  }
  return plan;
}

/** Route actors that answer at least one HARD claim of this plan — the only verifiers worth running. */
export function relevantVerifierActors(plan: ClaimPlan): Set<string> {
  return new Set(plan.hard.flatMap((h) => h.routes.map((r) => r.actor)));
}

export interface VerifiedAfterEligibility {
  claim: string;
  criterion_id: string;
  value: unknown;
  /** The verification CAPABILITY — never an actor a planner could propose. */
  verified_by: string[];
  /** Evidence dimensions the verification writes (from the claim registry). */
  evidence: string[];
}

/**
 * Hard claims the claim-verification phase will establish for this mission.
 *
 * THE ONE ANSWER to "is this fact owned by a later phase?", asked by every gate
 * that used to assume only a graph capability can establish anything: the
 * execution planner (which returned an empty plan) and request feasibility
 * (which refused the run as `request_not_feasible`). Both were right given what
 * they could see — the claim-verification phase runs after eligibility and has
 * no step in the graph by design — and both refused a known-company funding
 * mission for that reason alone.
 *
 * Built by `buildClaimPlan`, the function the phase itself runs, under the
 * run's own readiness policy: a claim no EXECUTABLE verifier answers is not
 * returned, so production behaviour — where the funding pair may not run — is
 * exactly what it was.
 */
export function verifiedAfterEligibility(
  mission: LeadMissionV1, entry: string | null, readiness: ReadinessPolicy = PRODUCTION_READINESS,
  registry: readonly ClaimDefinition[] = CLAIM_REGISTRY,
): VerifiedAfterEligibility[] {
  const plan = buildClaimPlan(deriveMissionCriteria(mission, readiness), entry, readiness, registry);
  return plan.hard
    .filter((h) => h.status === "verifiable" && h.claim)
    .map((h) => ({
      claim: h.claim!,
      criterion_id: h.criterion_id,
      value: h.value,
      verified_by: [...new Set(h.routes.map((r) => r.capability))],
      evidence: [...(registry.find((d) => d.claim === h.claim)?.evidence ?? [])],
    }));
}
