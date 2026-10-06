// LEAD V2 QUALITY REGRESSIONS — THE DETERMINISTIC CHAIN, FROM THE CLOSEST STABLE BOUNDARY.
//
// Production (pilot-chat):
//
//   sentence ─GPT (Chat Brain)→ RequestV1 ─→ projectToLeadMission ─→ compileLeadMission
//            ─→ LeadMissionV1 ─→ deriveMissionCriteria ─→ buildCapabilityGraph ─→ buildClaimPlan
//
// Everything after `RequestV1` is deterministic code. The quality run
// (2026-10-06, local pilot-chat at 1222a20e) recorded the FINAL card — the
// compiled mission and its metadata — but NOT the RequestV1 Chat Brain produced,
// so the compiler cannot be replayed from the run itself.
//
// LIMITATION, STATED ONCE AND REFERENCED BY EVERY RECONSTRUCTED CASE:
// a reconstructed case hands the chain the RequestV1 the sentence most plainly
// expresses in RequestV1's own vocabulary (the run's serve log recorded Chat
// Brain's per-query shape — objective, entity, count, filter FIELDS, requirement
// EVENTS — but not the values). The test therefore proves what the deterministic
// chain does with a faithful reading. It cannot prove what Chat Brain itself
// reads: a fix made ONLY in the Chat Brain prompt is invisible here, and a
// regression made only there will not be caught. Recording RequestV1 on the card
// would remove this limitation.
//
// Pure. No network, no model, no provider, no database.

import { projectToLeadMission } from "../../../supabase/functions/_shared/projectToLeadMission.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { compileRequestMission } from "../../../supabase/functions/_shared/requestToMission.ts";
import { type BrainMergeInput, effectiveRequestedCount, type LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";
import { deriveMissionCriteria, type MissionCriterion } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { buildClaimPlan } from "../../../supabase/functions/_shared/claimPlan.ts";
import { PRODUCTION_READINESS } from "../../../supabase/functions/_shared/routeReadiness.ts";
import {
  REQUEST_V1_VERSION, type RequestFilter, type RequestObjective, type RequestReference, type RequestRequirement,
  type RequestV1,
} from "../../../supabase/functions/_shared/requestV1.ts";

/**
 * The quality workspace's Company Brain, as the run's cards disclosed it: every
 * `company_brain_preference` criterion and every `field_provenance: company_brain`
 * field in the 192 recorded cards carried exactly these values.
 */
export const QUALITY_RUN_BRAIN: BrainMergeInput = {
  industries: ["b2b saas", "fintech"],
  stages: ["seed", "series_a"],
  locations: ["united states"],
};

export interface PartSpec {
  objective?: RequestObjective;
  entity?: "company" | "person" | "job";
  references?: RequestReference[];
  filters?: RequestFilter[];
  requirements?: RequestRequirement[];
  count?: number | null;
}

/** A one-part RequestV1 — the shape Chat Brain produced for every catalogue query (`parts: 1`). */
export function request(utterance: string, p: PartSpec): RequestV1 {
  const objective = p.objective ?? "source";
  return {
    version: REQUEST_V1_VERSION, utterance, objective,
    parts: [{
      id: "p1", objective,
      subject: { entity: p.entity ?? "company", references: p.references ?? [], filters: p.filters ?? [] },
      requirements: p.requirements ?? [],
      output: { shape: "records", count: p.count ?? null },
    }],
    ambiguity: [],
    authority: { may_spend: true, max_cost_units: null, requires_confirmation: true },
    provenance: {}, confidence: 0.95,
  } as RequestV1;
}

export const named = (value: string): RequestReference => ({ kind: "named", value });
export const hiring = (phrase: string, role_terms: string[], role_families?: string[], recency_days?: number | null): RequestRequirement =>
  ({ event: "hiring", subject: "company", phrase, qualifier: { role_terms, ...(role_families ? { role_families } : {}) },
    ...(recency_days !== undefined ? { recency_days } : {}) } as RequestRequirement);
export const funding = (phrase: string, recency_days?: number | null, round_type?: string): RequestRequirement =>
  ({ event: "funding", subject: "company", phrase, qualifier: round_type ? { round_type } : {},
    ...(recency_days !== undefined ? { recency_days } : {}) } as RequestRequirement);

export interface Chain {
  ok: boolean;
  /** Set when the chain refused (a clarification / stated refusal — never a card). */
  refusal: { reason: string; message: string; violations: string[] } | null;
  mission: LeadMissionV1 | null;
  criteria: MissionCriterion[];
  hard: MissionCriterion[];
  entry: string | null;
  claimPlan: ReturnType<typeof buildClaimPlan> | null;
  effectiveCount: number | null;
  unprojected: string[];
}

/** RequestV1 → the card, exactly as pilot-chat compiles it (`compileRequestMission`). */
export function compileChain(r: RequestV1, brain: BrainMergeInput | null = QUALITY_RUN_BRAIN): Chain {
  const proj = projectToLeadMission(r);
  const out = compileRequestMission(r, proj, { originalUserQuery: r.utterance, companyBrain: brain });
  if (!out.ok) {
    return { ok: false, refusal: { reason: out.reason, message: out.message, violations: out.violations }, mission: null,
      criteria: [], hard: [], entry: null, claimPlan: null, effectiveCount: null, unprojected: proj.unprojected };
  }
  return { ...fromMission(out.result.final_mission), unprojected: proj.unprojected };
}

/** A recorded (or compiled) mission through the deterministic downstream. */
export function fromMission(mission: LeadMissionV1): Chain {
  const criteria = deriveMissionCriteria(mission, PRODUCTION_READINESS);
  const plan = buildCapabilityGraph(mission, { executability: "enforce", readiness: PRODUCTION_READINESS });
  return {
    ok: true, refusal: null, mission, criteria, hard: criteria.filter((c) => c.kind === "hard" && c.status === "ok"),
    entry: plan.entry_capability ?? null,
    claimPlan: buildClaimPlan(criteria, plan.entry_capability ?? null, PRODUCTION_READINESS),
    effectiveCount: effectiveRequestedCount(mission), unprojected: [],
  };
}

/** `compileLeadMission` on its own, for the boundary below projection. */
export { compileLeadMission };

/** Criteria of one dimension. */
export const ofDim = (c: Chain, dim: string) => c.criteria.filter((x) => x.dimension === dim);
export const textOf = (v: unknown) => JSON.stringify(v ?? null).toLowerCase();

import { assessRequestFeasibility } from "../../../supabase/functions/_shared/requestFeasibility.ts";

/** What the card preview decides — pilot-chat's `assessRequestFeasibility` under the enforced gate. */
export function feasibilityOf(mission: LeadMissionV1) {
  const plan = buildCapabilityGraph(mission, { executability: "enforce", readiness: PRODUCTION_READINESS });
  return assessRequestFeasibility(mission, plan, { executability: "enforce", readiness: PRODUCTION_READINESS });
}
