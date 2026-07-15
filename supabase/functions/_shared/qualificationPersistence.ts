// Canonical qualification → persistence decision for Find Leads.
//
// Root cause it fixes (see evals/find-leads/dual-apify/20260715T085336Z-q1-intent-routing):
// provider-backed person profiles were persisted DURING Scout's sourcing tool
// call — before Aria qualification ran — gated only by provider provenance. All
// five Q1 rows were `fit_tier=rejected` yet persisted, because acceptance logic
// was scattered across insert paths and none of them consulted the qualification
// verdict.
//
// This module is the SINGLE, deterministic acceptance authority. Every final
// persistence path must route its accept/reject choice through
// `qualificationPersistenceDecision`. Provider provenance is necessary but never
// sufficient: a candidate persists ONLY when Aria evaluated it and accepted it,
// its artifact type matches the requested entity, and its tier is not rejected.
//
// Pure / import-light so it is fully unit-testable with no provider calls.

import type { ArtifactType, TargetEntity } from "./leadEntityIntent.ts";
import { expectedArtifactType } from "./leadEntityIntent.ts";

/** Explicit qualification verdict for a single candidate. `null`/`undefined`
 * means Aria never evaluated it (→ never persist). */
export type AriaDecision = "accept" | "reject" | "needs_review" | null | undefined;

/** Tiers the scoring stack can assign. `rejected` never persists. */
export type QualityTier = "hot" | "qualified" | "weak" | "rejected" | string | null | undefined;

export interface QualificationPersistenceInput {
  /** Immutable requested entity from the compiled LeadEntityIntent. */
  targetEntity: TargetEntity;
  /** Expected artifact type; defaults to `expectedArtifactType(targetEntity)`. */
  expectedArtifactType?: ArtifactType | null;
  /** Artifact type carried by the normalized candidate. Must match the target. */
  candidateArtifactType: ArtifactType | null | undefined;
  /** Provider provenance validated (verified=true). Necessary, not sufficient. */
  providerVerified: boolean;
  /** Did Aria/qualification actually evaluate THIS candidate? */
  ariaEvaluated: boolean;
  /** Aria's explicit verdict for this candidate. */
  ariaDecision: AriaDecision;
  /** Scoring tier. `rejected` blocks persistence even if Aria said accept. */
  tier?: QualityTier;
  /** Optional numeric score (informational; policy keys on tier + decision). */
  score?: number | null;
  /** Evidence-invariant violations recorded on the candidate. */
  evidenceViolations?: string[] | null;
}

export interface QualificationPersistenceDecision {
  persist: boolean;
  reason: string;
  /** Persistence is anchored on Aria qualification, never on provider sourcing. */
  decision_source: "aria";
}

/** Tiers that represent a positive qualification outcome. */
export const ACCEPTED_TIERS: ReadonlySet<string> = new Set(["hot", "qualified"]);
/** Evidence violations that are hard blockers regardless of tier/decision. */
const HARD_EVIDENCE_BLOCKERS: ReadonlySet<string> = new Set([
  "profile_as_job",
  "title_as_signal",
  "jobpost_no_employer",
  "jobpost_no_role",
]);

/**
 * The one acceptance policy. A candidate persists as a FINAL lead ONLY when every
 * condition below holds. Checks are ordered so the returned `reason` names the
 * first (most specific) failing condition.
 */
export function qualificationPersistenceDecision(
  input: QualificationPersistenceInput,
): QualificationPersistenceDecision {
  const source = "aria" as const;
  const expected = input.expectedArtifactType ?? expectedArtifactType(input.targetEntity);
  const tier = (input.tier ?? null) as string | null;
  const violations = input.evidenceViolations ?? [];

  // 1) Provider provenance is necessary but NOT sufficient.
  if (!input.providerVerified) {
    return { persist: false, reason: "unverified_provenance", decision_source: source };
  }
  // 2) Artifact type must exist and match the requested entity. An unsupported /
  //    missing identity (e.g. a JobSignal for a person target) never persists.
  if (!input.candidateArtifactType) {
    return { persist: false, reason: "missing_artifact_type", decision_source: source };
  }
  if (input.candidateArtifactType !== expected) {
    return { persist: false, reason: "artifact_mismatch", decision_source: source };
  }
  // 3) Aria must have evaluated this candidate.
  if (!input.ariaEvaluated || input.ariaDecision === null || input.ariaDecision === undefined) {
    return { persist: false, reason: "no_qualification", decision_source: source };
  }
  // 4) Explicit Aria rejection blocks persistence.
  if (input.ariaDecision === "reject") {
    return { persist: false, reason: "aria_rejected", decision_source: source };
  }
  // 5) A rejected tier blocks persistence even if Aria did not say "reject".
  if (tier === "rejected") {
    return { persist: false, reason: "tier_rejected", decision_source: source };
  }
  // 6) Hard evidence-invariant violations (job-shaped contradictions) block.
  const hardHit = violations.find((v) => HARD_EVIDENCE_BLOCKERS.has(v));
  if (hardHit) {
    return { persist: false, reason: `evidence_violation:${hardHit}`, decision_source: source };
  }
  // 7) Positive acceptance: Aria accepted AND the tier is a qualified/hot tier.
  //    Nothing persists merely because it came from Apify.
  if (input.ariaDecision === "accept" && (tier == null || ACCEPTED_TIERS.has(tier))) {
    return { persist: true, reason: "aria_accepted", decision_source: source };
  }
  // Everything else (needs_review, weak tier, accept-without-qualified-tier) is
  // held back from FINAL persistence — stage it for review instead.
  return { persist: false, reason: "not_accepted", decision_source: source };
}

/** Shape the live `aria` scoring object carries (subset we read). */
export interface AriaLike {
  star_label?: string | null;   // "Hot" | "Qualified" | "Weak" | "Reject"
  gate_decision?: string | null; // "contact" | "needs_verification" | "reject"
  overall_fit?: number | null;
}

/**
 * Map the live Aria scoring object → an explicit {evaluated, decision}. This is
 * the ONE production mapping tests and run-agent both use, so acceptance logic is
 * never duplicated in test-only code.
 *   - star_label "Reject" or gate_decision "reject"        → reject
 *   - star_label "Hot"/"Qualified" (+ non-reject gate)     → accept
 *   - otherwise                                            → needs_review
 * A missing `aria` object means Aria never evaluated the candidate.
 */
export function mapAriaToDecision(aria: AriaLike | null | undefined): {
  evaluated: boolean;
  decision: AriaDecision;
} {
  if (!aria) return { evaluated: false, decision: null };
  const label = (aria.star_label ?? "").toString().trim().toLowerCase();
  const gate = (aria.gate_decision ?? "").toString().trim().toLowerCase();
  if (label === "reject" || gate === "reject") return { evaluated: true, decision: "reject" };
  if (label === "hot" || label === "qualified") return { evaluated: true, decision: "accept" };
  return { evaluated: true, decision: "needs_review" };
}

export interface PersistencePartition<T> {
  persist: Array<{ candidate: T; decision: QualificationPersistenceDecision }>;
  staged: Array<{ candidate: T; decision: QualificationPersistenceDecision }>;
}

/**
 * Split a set of candidates into the FINAL-persist set and the staged (held for
 * review) set using one decision function. `decide` maps each candidate to a
 * `QualificationPersistenceInput`.
 */
export function partitionForPersistence<T>(
  candidates: readonly T[],
  decide: (candidate: T) => QualificationPersistenceInput,
): PersistencePartition<T> {
  const persist: PersistencePartition<T>["persist"] = [];
  const staged: PersistencePartition<T>["staged"] = [];
  for (const candidate of candidates) {
    const decision = qualificationPersistenceDecision(decide(candidate));
    (decision.persist ? persist : staged).push({ candidate, decision });
  }
  return { persist, staged };
}
