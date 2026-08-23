// Evidence Sufficiency Gate (Phase 1D) — pure / deterministic.
//
// Answers ONE question per candidate: given the compiled evidence contract and the
// evidence the candidate already carries, what happens next?
//
// Core principle: MISSING EVIDENCE IS NOT REJECTION. Only an invalid identity,
// invalid provenance, an incompatible artifact, or an explicit ICP CONTRADICTION
// rejects immediately. Everything else either enriches (if a permitted source can
// fill the gap within budget) or stages honestly.

import type { EvidenceCategory, EvidenceContract, EvidenceRequirement } from "./evidenceContract.ts";
import { timingIsAnyOf } from "./evidenceContract.ts";
import type { CandidateEnvelope } from "./candidateEnvelope.ts";
import { isVerifiedProviderEvidence, isEvidenceFresh } from "./candidateEnvelope.ts";
import { expectedArtifactType } from "./leadEntityIntent.ts";

export type SufficiencyDecision =
  | "qualify_now"
  | "structured_company_enrichment"
  | "targeted_web_verification"
  | "signal_enrichment"
  | "stage_missing_evidence"
  | "reject_source";

export interface EvidenceSufficiencyResult {
  sufficient: boolean;
  identityComplete: boolean;
  fitComplete: boolean;
  timingComplete: boolean;
  satisfiedRequirements: EvidenceCategory[];
  missingCriticalRequirements: EvidenceCategory[];
  missingOptionalRequirements: EvidenceCategory[];
  staleRequirements: EvidenceCategory[];
  nextDecision: SufficiencyDecision;
  /** Machine-readable reason for the decision. */
  reasonCode: string;
}

const rank: Record<string, number> = { low: 0, medium: 1, high: 2 };

/** Categories that structured company enrichment (firmographics) can fill. */
const FIRMOGRAPHIC: ReadonlySet<EvidenceCategory> = new Set([
  "company_identity", "company_website", "company_industry", "company_size", "company_geography",
]);
/** Categories that need official web verification. */
const WEB_VERIFIABLE: ReadonlySet<EvidenceCategory> = new Set(["company_business_model"]);
/** Timing/signal categories. */
const SIGNAL_CATS: ReadonlySet<EvidenceCategory> = new Set([
  "job_signal", "funding_signal", "launch_signal", "expansion_signal",
  "founder_activity_signal", "gtm_signal",
  // The categories added when the signal vocabulary was made total. Omitting
  // them here would classify a social or technology requirement as neither
  // firmographic nor signal, and `nextDecision` would route it to structured
  // company enrichment — asking a firmographics Actor to prove a post.
  "company_activity_signal", "engagement_signal", "technology_signal",
  "headcount_signal",
]);

function requirementMet(env: CandidateEnvelope, r: EvidenceRequirement, now: string): { met: boolean; stale: boolean } {
  let sawButStale = false;
  for (const e of env.evidence) {
    if (e.category !== r.category) continue;
    if (!isVerifiedProviderEvidence(e)) continue;
    if (rank[e.confidence] < rank[r.minimumConfidence]) continue;
    if (!r.acceptableSourceTypes.includes(e.sourceType)) continue;
    if (isEvidenceFresh(e, now, r.freshnessWindowHours)) return { met: true, stale: false };
    sawButStale = true;
  }
  return { met: false, stale: sawButStale };
}

/**
 * Evaluate sufficiency. `icpContradiction` is supplied by the caller when the
 * candidate's own evidence CONTRADICTS the ICP (e.g. a disqualified industry) —
 * that is a genuine reject, unlike merely-missing evidence.
 */
export function evaluateEvidenceSufficiency(args: {
  contract: EvidenceContract;
  envelope: CandidateEnvelope;
  now: string;
  icpContradiction?: boolean;
}): EvidenceSufficiencyResult {
  const { contract, envelope, now } = args;
  const satisfied: EvidenceCategory[] = [];
  const missingCritical: EvidenceCategory[] = [];
  const missingOptional: EvidenceCategory[] = [];
  const stale: EvidenceCategory[] = [];

  const evalGroup = (reqs: EvidenceRequirement[]) => {
    let allRequiredMet = true;
    for (const r of reqs) {
      const { met, stale: isStale } = requirementMet(envelope, r, now);
      if (met) { satisfied.push(r.category); continue; }
      if (isStale) stale.push(r.category);
      if (r.required) { missingCritical.push(r.category); allRequiredMet = false; }
      else missingOptional.push(r.category);
    }
    return allRequiredMet;
  };

  // ---- hard rejects first (these are NOT "missing evidence") ----
  if (!envelope.sourceProvenance?.verified) {
    return {
      sufficient: false, identityComplete: false, fitComplete: false, timingComplete: false,
      satisfiedRequirements: [], missingCriticalRequirements: [], missingOptionalRequirements: [], staleRequirements: [],
      nextDecision: "reject_source", reasonCode: "unverified_provenance",
    };
  }
  if (envelope.primaryArtifactType !== expectedArtifactType(contract.targetEntity)) {
    return {
      sufficient: false, identityComplete: false, fitComplete: false, timingComplete: false,
      satisfiedRequirements: [], missingCriticalRequirements: [], missingOptionalRequirements: [], staleRequirements: [],
      nextDecision: "reject_source", reasonCode: "artifact_mismatch",
    };
  }
  if (args.icpContradiction) {
    return {
      sufficient: false, identityComplete: true, fitComplete: false, timingComplete: false,
      satisfiedRequirements: [], missingCriticalRequirements: [], missingOptionalRequirements: [], staleRequirements: [],
      nextDecision: "reject_source", reasonCode: "icp_contradiction",
    };
  }

  const identityComplete = evalGroup(contract.identityRequirements);
  const fitComplete = evalGroup(contract.fitRequirements);

  // Timing: any-of for hot_opportunity, all-required otherwise.
  let timingComplete: boolean;
  if (contract.timingRequirements.length === 0) {
    timingComplete = true;
  } else if (timingIsAnyOf(contract)) {
    const anyMet = contract.timingRequirements.some((r) => requirementMet(envelope, r, now).met);
    timingComplete = anyMet;
    for (const r of contract.timingRequirements) {
      const { met, stale: isStale } = requirementMet(envelope, r, now);
      if (met) satisfied.push(r.category);
      else if (isStale) stale.push(r.category);
    }
    if (!anyMet) missingCritical.push(...contract.timingRequirements.map((r) => r.category));
  } else {
    timingComplete = evalGroup(contract.timingRequirements);
  }
  evalGroup(contract.optionalRequirements);

  const sufficient = identityComplete && fitComplete && timingComplete;
  if (sufficient) {
    return {
      sufficient: true, identityComplete, fitComplete, timingComplete,
      satisfiedRequirements: [...new Set(satisfied)], missingCriticalRequirements: [],
      missingOptionalRequirements: [...new Set(missingOptional)], staleRequirements: [...new Set(stale)],
      nextDecision: "qualify_now", reasonCode: "primary_source_sufficient",
    };
  }

  // ---- route the gap to the CHEAPEST capable stage ----
  const missing = [...new Set(missingCritical)];
  const needsFirmographic = missing.some((c) => FIRMOGRAPHIC.has(c));
  const needsWeb = missing.some((c) => WEB_VERIFIABLE.has(c));
  const needsSignal = missing.some((c) => SIGNAL_CATS.has(c));

  let nextDecision: SufficiencyDecision;
  let reasonCode: string;
  if (!identityComplete) {
    // Identity gaps can't be back-filled cheaply for a primary-sourced candidate.
    nextDecision = "stage_missing_evidence"; reasonCode = "incomplete_identity";
  } else if (needsFirmographic) {
    nextDecision = "structured_company_enrichment"; reasonCode = "missing_firmographics";
  } else if (needsWeb) {
    nextDecision = "targeted_web_verification"; reasonCode = "missing_official_proof";
  } else if (needsSignal) {
    nextDecision = "signal_enrichment"; reasonCode = "missing_timing_signal";
  } else {
    nextDecision = "stage_missing_evidence"; reasonCode = "unfillable_gap";
  }

  return {
    sufficient: false, identityComplete, fitComplete, timingComplete,
    satisfiedRequirements: [...new Set(satisfied)],
    missingCriticalRequirements: missing,
    missingOptionalRequirements: [...new Set(missingOptional)],
    staleRequirements: [...new Set(stale)],
    nextDecision, reasonCode,
  };
}
