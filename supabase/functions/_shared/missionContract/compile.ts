// THE CONTRACT COMPILER: Mission Contract → the frozen mission the existing engine runs.
//
// Deterministic and total over a valid contract. It reads ONLY the contract: never the
// user's sentence (`objective` is copied for display), never a second field. Each
// criterion it emits carries its requirement's id, so every plan step and every verdict
// points back at one approved requirement. The result is frozen (criteria-v1), so every
// reader (`criteriaOf`) acts on exactly these criteria, and carries the contract and its
// hash for audit and approval binding.
//
// `contractFromMission` (boundary.ts) is its inverse; `semanticCriteria` is the
// comparison both directions are tested with.

import { freezeCriteria } from "../missionCriteriaReader.ts";
import type { MissionCriterion } from "../missionCriteria.ts";
import { canonicalJson, contractHash, contractProblems, isExecutable, type MissionContract, type Requirement } from "./contract.ts";

export interface CompiledContractMission {
  original_user_query: string;
  target_entity: string;
  requested_count: number | null;
  decision_makers: { roles: string[] };
  directives: { disallowed_broadening: string[] };
  required_signals: Record<string, unknown>[];
  required_signal_terms: string[];
  criteria: MissionCriterion[];
  criteria_contract_version: string;
  criteria_fingerprint: string;
  /** The approved meaning this mission was compiled from, and its approval identity. */
  mission_contract: MissionContract;
  mission_contract_hash: string;
}

export class ContractInvalidError extends Error {
  constructor(readonly problems: string[]) {
    super(`mission contract is invalid: ${problems.join("; ")}`);
    this.name = "ContractInvalidError";
  }
}

const kindOf = (r: Requirement) => (r.necessity === "required" ? "hard" : "target");

/** One requirement → the criterion the engine evaluates (same id, same meaning). */
export function criterionOf(r: Requirement): MissionCriterion {
  const c: Record<string, unknown> = {
    id: r.id, kind: kindOf(r), label: r.display.label, rationale: r.display.rationale,
    source: r.origin.source, user_phrase: r.origin.span, status: r.evaluability,
  };
  if (r.origin.confidence !== undefined) c.confidence = r.origin.confidence;
  if (r.origin.elevatedBy !== undefined) c.elevated_by = r.origin.elevatedBy;
  if (r.alternatives) c.any_of = [...r.alternatives];
  switch (r.dimension) {
    case "geography":
      c.dimension = "geography"; c.value = r.place;
      if (r.scope) c.geography_scope = r.scope;
      break;
    case "company_size":
      c.dimension = "company_size";
      c.value = { ...(r.min !== null ? { min: r.min } : {}), ...(r.max !== null ? { max: r.max } : {}) };
      break;
    case "industry":
      c.dimension = r.facet; c.value = r.value;
      break;
    case "company_stage":
      c.dimension = "company_stage"; c.value = r.stage;
      break;
    case "known_companies":
      c.dimension = "known_companies"; c.value = [...r.companies];
      break;
    case "exclusion":
      c.dimension = "exclusion"; c.value = { field: r.field, value: r.values };
      break;
    case "unsupported":
      c.dimension = r.compiledAs; c.value = r.value;
      break;
    case "signal": {
      c.dimension = r.kind;
      const q: Record<string, unknown> = { ...r.qualifiers };
      if (r.roleTerms) q.role_terms = [...r.roleTerms];
      if (r.roleFamilies) q.role_families = [...r.roleFamilies];
      if (r.excludedRoleTerms) q.excluded_role_terms = [...r.excludedRoleTerms];
      if (r.roleMatch !== null) q.role_match = r.roleMatch;
      c.value = { event: r.event, subject: r.subject, ...(r.qualifierPresent ? { qualifier: q } : {}) };
      if (r.window) {
        c.time_window = {
          days: r.window.days, basis: r.window.basis, source: r.window.origin.source,
          ...(r.window.origin.policy !== null ? { rule: r.window.origin.policy } : {}),
          ...(r.window.enforced !== null ? { enforced: r.window.enforced } : {}),
        };
      }
      break;
    }
  }
  return c as unknown as MissionCriterion;
}

/** The engine's carrier for a signal requirement (what the planner reads from `required_signals`). */
function signalCarrier(r: Extract<Requirement, { dimension: "signal" }>): Record<string, unknown> {
  const qualifier: Record<string, unknown> = {};
  if (r.roleTerms) qualifier.role_terms = [...r.roleTerms];
  if (r.roleFamilies) qualifier.role_families = [...r.roleFamilies];
  if (r.excludedRoleTerms) qualifier.excluded_role_terms = [...r.excludedRoleTerms];
  if (r.roleMatch !== null) qualifier.role_match = r.roleMatch;
  return {
    type: r.kind, event: r.event, subject: r.subject, qualifier,
    timeframe_days: r.window?.days ?? null, phrase: r.origin.span,
    ...(r.roleFamilies ? { role_families: [...r.roleFamilies] } : {}),
  };
}

/**
 * Compile a contract. Refuses (throws) an invalid contract: an invalid meaning is never
 * executed. Approvability (ambiguities, unsupported REQUIRED requirements) is checked by
 * the caller before approval, not here — so a stored contract can still be inspected.
 */
export async function compileContract(contract: MissionContract): Promise<CompiledContractMission> {
  const problems = contractProblems(contract);
  if (problems.length) throw new ContractInvalidError(problems.map((p) => `${p.code}${p.requirementId ? `(${p.requirementId})` : ""}: ${p.detail}`));
  const signals = contract.requirements.filter((r): r is Extract<Requirement, { dimension: "signal" }> => r.dimension === "signal");
  const mission = {
    original_user_query: contract.objective,
    target_entity: contract.deliverable.entity,
    requested_count: contract.deliverable.count,
    decision_makers: { roles: [...contract.deliverable.personRoles] },
    directives: { disallowed_broadening: [...contract.forbidBroadening] },
    required_signals: signals.map(signalCarrier),
    required_signal_terms: signals.flatMap((s) => s.topics),
    // A disclosed requirement is shown at approval and never executed: no criterion.
    criteria: contract.requirements.filter(isExecutable).map(criterionOf),
    mission_contract: contract,
    mission_contract_hash: await contractHash(contract),
  };
  return freezeCriteria(mission) as CompiledContractMission;
}

/**
 * A criterion list reduced to what the engine ACTS on (no card text), in canonical form —
 * the comparison the round trip, the invariants and the regression tests use.
 */
export function semanticCriteria(criteria: readonly unknown[]): string[] {
  return (criteria as Record<string, unknown>[]).map((c) => {
    const { label: _l, rationale: _r, ...rest } = c;
    return canonicalJson(rest);
  }).sort();
}
