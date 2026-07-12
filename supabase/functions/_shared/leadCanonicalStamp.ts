// Canonical lead stamp — the single composition point that turns the facts the
// live Find Leads pipeline already computes (Aria fit, proof gate, analyst brief,
// hiring signal) into the Phase A canonical outputs every UI/CSV/counter should
// read. Pure / deterministic: it imports only the Phase A modules and makes ZERO
// provider calls, so run-agent can call it per accepted lead and it can be unit
// tested against frozen fixtures.
//
// It NEVER mutates or overwrites existing row fields; run-agent stamps the result
// under new keys (`canonical_final_decision`, `contact_ready`, `canonical`), so
// legacy consumers keep working while the Workbench migrates to the contract.

import { classifyRoleFamily, roleExactness, type RoleFamily, type RoleExactness } from "./roleFamilyMatcher.ts";
import {
  decideCanonical,
  contactReady,
  reconcile,
  type CanonicalDecision,
  type LeadFacts,
  type LegacyDecisionFields,
} from "./leadDecision.ts";
import { scoreLead, type ScoreBreakdown } from "./leadScoreBreakdown.ts";
import {
  classifyEvidence,
  provesCompanySignal,
  checkEvidenceInvariants,
  type EvidenceType,
} from "./evidenceType.ts";

/** Facts the live pipeline already has per accepted lead. Everything optional so
 *  a missing upstream field degrades gracefully to the strict (non-contact) side. */
export interface CanonicalStampInput {
  // --- identity ---
  company?: string | null;
  website?: string | null;
  source_url?: string | null;
  job_title?: string | null;

  // --- requested intent (from separateIntent / lead_intent) ---
  requested_role_family?: RoleFamily | null;
  requested_signal?: "required" | "preferred" | "none";
  source_strategy?: "account_first" | "profile_first" | null;

  // --- hiring / company signal facts ---
  exact_hiring_signal?: string | null;
  signal_type?: string | null;            // "hiring" | "funding" | ...
  evidence_url?: string | null;           // the URL that proves the signal
  evidence_recent?: boolean;

  // --- fit / gate facts from the existing engine ---
  aria_overall_fit?: number | null;       // 0..100
  aria_confidence_score?: number | null;  // 0..100
  matched_icp?: string[] | null;
  missing_fields?: string[] | null;
  missing_evidence?: string[] | null;
  gate_decision?: string | null;          // accept | reject | needs_review | watch
  disqualifiers_hit?: unknown;            // array (non-empty) or boolean

  // --- decision maker + narrative (contact-ready contract) ---
  decision_maker_profile_url?: string | null;
  why_this_company?: string | null;
  why_now?: string | null;

  // --- legacy decision fields for reconcile / contradiction ---
  match_tier?: string | null;
  fit_tier?: string | null;
  analyst_verdict?: string | null;

  // --- run-trace provenance ---
  search_stage?: string | null;           // e.g. "strict" | "relaxed_location"
  relaxed_filters?: string[] | null;
  min_confidence?: number;
}

export interface CanonicalRunTrace {
  source_strategy: "account_first" | "profile_first" | null;
  requested_role_family: RoleFamily | null;
  requested_signal: "required" | "preferred" | "none";
  role_exactness: RoleExactness | "none";
  candidate_role_family: RoleFamily;
  evidence_type: EvidenceType;
  proves_company_signal: boolean;
  evidence_violations: string[];          // invariant codes (empty = clean)
  gate_decision: string | null;
  search_stage: string | null;
  relaxed_filters: string[];
  contradiction_blocked: string | null;
}

export interface CanonicalStamp {
  canonical_final_decision: CanonicalDecision;
  contact_ready: boolean;
  contact_ready_missing: string[];
  score_breakdown: ScoreBreakdown;        // the EXPLAINABLE Phase A breakdown
  final_score: number;                    // 0..100
  confidence: number;                     // 0..1
  score_explanation: string;
  role_exactness: RoleExactness | "none";
  evidence_type: EvidenceType;
  evidence_violations: string[];
  blocked: string | null;                 // legacy contradiction, if any
  run_trace: CanonicalRunTrace;
}

const nonEmptyArray = (v: unknown): boolean => Array.isArray(v) && v.length > 0;
const hasUrl = (s: unknown): boolean => typeof s === "string" && /^https?:\/\/\S+/i.test(s.trim());
const hasText = (s: unknown): boolean => typeof s === "string" && s.trim().length > 0;

/** Was a hard disqualifier hit? True when a non-empty disqualifier list is
 *  present, an explicit boolean true, or the proof gate hard-rejected the row. */
function disqualifierHit(input: CanonicalStampInput): boolean {
  if (input.disqualifiers_hit === true) return true;
  if (nonEmptyArray(input.disqualifiers_hit)) return true;
  return String(input.gate_decision ?? "").toLowerCase() === "reject";
}

/** Company-level signal is verified when the evidence type actually proves a
 *  company signal AND the gate did not reject it. For a requested hiring role the
 *  candidate title must be an EXACT role-family match (adjacent sales roles are a
 *  watch signal only, never an exact one). */
function companySignalVerified(
  input: CanonicalStampInput,
  evidenceType: EvidenceType,
  exactness: RoleExactness | "none",
): boolean {
  const gateOk = String(input.gate_decision ?? "").toLowerCase() !== "reject";
  if (!gateOk) return false;
  if (input.requested_role_family) {
    // Hiring-role search: needs the exact role family proven by real hiring evidence.
    return exactness === "exact" && provesCompanySignal(evidenceType) && hasText(input.exact_hiring_signal);
  }
  if (input.requested_signal === "required") {
    return provesCompanySignal(evidenceType);
  }
  // No signal requested: a proving evidence type still counts, else no signal.
  return provesCompanySignal(evidenceType);
}

/** Compose the Phase A modules into one canonical stamp. Deterministic. */
export function buildCanonicalStamp(input: CanonicalStampInput): CanonicalStamp {
  const requested = input.requested_role_family ?? null;
  const candidate_role_family = classifyRoleFamily(input.job_title);
  const role_exactness: RoleExactness | "none" = requested
    ? roleExactness(requested, input.job_title)
    : "none";

  const evidence_type = classifyEvidence({
    url: input.evidence_url ?? input.source_url ?? null,
    text: input.exact_hiring_signal ?? input.why_now ?? null,
    claimed_type: input.signal_type ?? null,
  });

  const hard_disqualifier_hit = disqualifierHit(input);
  const company_identity_verified = hasText(input.company) && (hasUrl(input.website) || hasUrl(input.source_url) || hasText(input.website));
  const company_signal_verified = companySignalVerified(input, evidence_type, role_exactness);
  const brain_fit = typeof input.aria_overall_fit === "number"
    ? input.aria_overall_fit >= 50
    : nonEmptyArray(input.matched_icp);
  const timing_strong = input.evidence_recent === true || hasText(input.why_now);
  const decision_maker_verified = hasUrl(input.decision_maker_profile_url);
  const confidence = typeof input.aria_confidence_score === "number"
    ? Math.max(0, Math.min(1, input.aria_confidence_score / 100))
    : 0.5;
  const min_confidence = input.min_confidence ?? 0.6;

  const facts: LeadFacts = {
    hard_disqualifier_hit,
    company_identity_verified,
    company_signal_verified,
    brain_fit,
    timing_strong,
    decision_maker_verified,
    confidence,
    min_confidence,
  };

  const legacy: LegacyDecisionFields = {
    match_tier: input.match_tier ?? null,
    gate_decision: input.gate_decision ?? null,
    fit_tier: input.fit_tier ?? null,
    analyst_verdict: input.analyst_verdict ?? null,
  };

  const { decision, blocked } = reconcile(facts, legacy);
  const ready = contactReady(facts, {
    why_this_company: input.why_this_company ?? null,
    why_now: input.why_now ?? null,
    evidence_url: input.evidence_url ?? null,
    decision_maker_profile_url: input.decision_maker_profile_url ?? null,
  });
  // contact_ready must also agree with the reconciled canonical decision — a
  // legacy reject can never leave a row contact-ready even if artefacts exist.
  const contact_ready = ready.ready && decision === "contact";
  const contact_ready_missing = decision === "contact" ? ready.missing
    : [...new Set([...ready.missing, ...(decision === "skip" ? ["hard disqualifier"] : ["canonical decision is not contact"])])];

  const missingCount = (input.missing_fields?.length ?? 0) + (input.missing_evidence?.length ?? 0);
  const scored = scoreLead({
    company_icp_fit: brain_fit,
    industry_fit: nonEmptyArray(input.matched_icp),
    business_model_fit: brain_fit,
    company_size_fit: brain_fit,
    geography_fit: brain_fit,
    requested_role_exactness: role_exactness === "none" ? "unrelated" : role_exactness,
    signal_relevant: company_signal_verified,
    evidence_quality: provesCompanySignal(evidence_type) ? "primary" : evidence_type === "person_profile" ? "weak" : "none",
    evidence_recent: input.evidence_recent === true,
    decision_maker_complete: decision_maker_verified,
    hard_disqualifier_hit,
    missing_evidence_count: missingCount,
    profile_only: evidence_type === "person_profile" && !company_signal_verified,
  });

  const evidence_violations = checkEvidenceInvariants({
    signal_evidence_type: evidence_type,
    signal_label: input.signal_type ?? (input.exact_hiring_signal ? "hiring" : null),
    is_signal_from_person_title: !!input.requested_role_family && candidate_role_family === "founder_exec" && String(input.signal_type ?? "").toLowerCase() === "hiring",
    job_post: input.requested_role_family
      ? { employer: input.company ?? null, role_title: input.job_title ?? null }
      : null,
  }).map((v) => v.code);

  const run_trace: CanonicalRunTrace = {
    source_strategy: input.source_strategy ?? null,
    requested_role_family: requested,
    requested_signal: input.requested_signal ?? "none",
    role_exactness,
    candidate_role_family,
    evidence_type,
    proves_company_signal: provesCompanySignal(evidence_type),
    evidence_violations,
    gate_decision: input.gate_decision ?? null,
    search_stage: input.search_stage ?? null,
    relaxed_filters: input.relaxed_filters ?? [],
    contradiction_blocked: blocked,
  };

  return {
    canonical_final_decision: decision,
    contact_ready,
    contact_ready_missing,
    score_breakdown: scored.score_breakdown,
    final_score: scored.final_score,
    confidence: scored.confidence,
    score_explanation: scored.score_explanation,
    role_exactness,
    evidence_type,
    evidence_violations,
    blocked,
    run_trace,
  };
}
