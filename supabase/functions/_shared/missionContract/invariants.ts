// MEANING IS PRESERVED, OR EXECUTION STOPS.
//
// The fundamental invariant of the Mission Contract architecture:
//
//   No downstream component may silently introduce, remove, strengthen or weaken an
//   approved hard requirement.
//
// Checked at each boundary, on the artifacts themselves (never by convention):
//   I1 compile   — the frozen mission's criteria are exactly the contract's executable
//                  requirements (same ids, same meaning, same necessity);
//   I2 plan      — the planner's requirement view holds exactly those hard requirement ids
//                  (no added gate, none dropped);
//   I3 approval  — what runs has the approved contract hash;
//   I4 evaluate  — every candidate gets one verdict per executable required requirement,
//                  and an unknown is never reported as verified.
//
// Pure. A violation is returned as a reason; callers refuse to proceed on any.

import { criteriaOf } from "../missionCriteriaReader.ts";
import { contractHash, isExecutable, type MissionContract, type Requirement } from "./contract.ts";
import { criterionOf, semanticCriteria } from "./compile.ts";

export interface InvariantViolation { invariant: "I1" | "I2" | "I3" | "I4"; detail: string }

/** I1 — the mission's effective criteria (what every reader acts on) are exactly the contract's. */
export function checkCompiled(contract: MissionContract, mission: unknown): InvariantViolation[] {
  const want = semanticCriteria(contract.requirements.filter(isExecutable).map(criterionOf));
  const got = semanticCriteria(criteriaOf(mission as never));
  if (JSON.stringify(want) === JSON.stringify(got)) return [];
  const added = got.filter((x) => !want.includes(x)), dropped = want.filter((x) => !got.includes(x));
  return [{ invariant: "I1", detail: `the compiled mission differs from the contract: added ${JSON.stringify(added).slice(0, 300)}; dropped ${JSON.stringify(dropped).slice(0, 300)}` }];
}

/** I2 — the plan's hard requirements are exactly the contract's executable required ones. */
export function checkPlanRequirements(
  contract: MissionContract, plannerCriteria: readonly { id: string; kind: string }[],
): InvariantViolation[] {
  const want = new Set(contract.requirements.filter((r) => r.necessity === "required" && isExecutable(r)).map((r) => r.id));
  const got = new Set(plannerCriteria.filter((c) => c.kind === "hard").map((c) => c.id));
  const added = [...got].filter((id) => !want.has(id)), dropped = [...want].filter((id) => !got.has(id));
  return added.length || dropped.length
    ? [{ invariant: "I2", detail: `the plan's hard requirements differ from the contract: added ${JSON.stringify(added)}, dropped ${JSON.stringify(dropped)}` }]
    : [];
}

/** I3 — what is about to run is exactly what was approved. */
export async function checkApproved(contract: MissionContract, approvedHash: string | null): Promise<InvariantViolation[]> {
  if (!approvedHash) return [{ invariant: "I3", detail: "no approved contract hash" }];
  const h = await contractHash(contract);
  return h === approvedHash ? [] : [{ invariant: "I3", detail: `the contract changed after approval (approved ${approvedHash.slice(0, 12)}…, running ${h.slice(0, 12)}…)` }];
}

// ── Per-requirement verdicts ─────────────────────────────────────────────────

export type VerdictStatus = "verified" | "unverified" | "contradicted" | "not_applicable";

export interface RequirementVerdict {
  requirementId: string;
  necessity: Requirement["necessity"];
  status: VerdictStatus;
  /** What this verdict means for the candidate: a contradicted REQUIRED requirement rejects it. */
  decision: "satisfied" | "pending" | "rejects" | "ranks_only" | "not_checked";
  explanation: string;
  evidence: { evidence_id: string; actor: string; url: string | null; observed_at: string; occurred_at: string | null }[];
}

export interface QualificationCheckLike {
  criterion_id: string; result: string; reason: string;
  evidence?: RequirementVerdict["evidence"];
}

const STATUS_OF: Record<string, VerdictStatus> = { pass: "verified", fail: "contradicted", unknown: "unverified" };

/**
 * One verdict per contract requirement for a candidate, from the engine's checks.
 * A requirement the engine did not check is `unverified` ("not evaluated") — never
 * verified. A disclosed requirement is `not_applicable` (it was never executed).
 */
export function requirementVerdicts(contract: MissionContract, checks: readonly QualificationCheckLike[]): RequirementVerdict[] {
  return contract.requirements.map((r) => {
    if (!isExecutable(r)) {
      return { requirementId: r.id, necessity: r.necessity, status: "not_applicable", decision: "not_checked", evidence: [],
        explanation: "shown at approval; no evidence dimension can establish it, so it was not checked" };
    }
    const c = checks.find((x) => x.criterion_id === r.id);
    if (!c) {
      return { requirementId: r.id, necessity: r.necessity, status: "unverified", decision: r.necessity === "required" ? "pending" : "ranks_only",
        evidence: [], explanation: "not evaluated for this candidate" };
    }
    const status = STATUS_OF[c.result] ?? "unverified";
    // Verified needs evidence: a "pass" with nothing cited is reported as unverified.
    const evidence = c.evidence ?? [];
    const proven = status === "verified" && evidence.length === 0 ? "unverified" : status;
    const decision = r.necessity !== "required" ? "ranks_only"
      : proven === "verified" ? "satisfied" : proven === "contradicted" ? "rejects" : "pending";
    return { requirementId: r.id, necessity: r.necessity, status: proven, decision, evidence,
      explanation: proven !== status ? `${c.reason} (no evidence cited, so not counted as verified)` : c.reason };
  });
}

/** I4 — every executable required requirement has exactly one verdict, and no unknown is reported verified. */
export function checkVerdicts(contract: MissionContract, verdicts: readonly RequirementVerdict[]): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const r of contract.requirements.filter((x) => x.necessity === "required" && isExecutable(x))) {
    const v = verdicts.filter((x) => x.requirementId === r.id);
    if (v.length !== 1) out.push({ invariant: "I4", detail: `requirement ${r.id} has ${v.length} verdicts` });
  }
  for (const v of verdicts) if (v.status === "verified" && !v.evidence.length) out.push({ invariant: "I4", detail: `${v.requirementId} verified without evidence` });
  return out;
}
