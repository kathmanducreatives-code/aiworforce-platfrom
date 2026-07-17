// Canonical FINAL candidate state for Find Leads — pure / deterministic.
//
// Root cause it fixes (see evals/find-leads/dual-apify/20260716T163040Z-q1-v84-bounded-company-enrichment):
// the v84 controlled Q1 reported the SAME five candidates as both `staged` (5) and
// `rejected` (5), labelled three company-fit-verified founders
// `rejection_class=qualification_threshold`, and disagreed with the company
// enrichment observability that recommended `signal_enrichment` for those same
// candidates. Three independent causes:
//   1. run-agent collapsed every non-persisted candidate to "reject", discarding the
//      `stage_missing_evidence:signal_enrichment` reason it had already computed.
//   2. the funnel aliased `staged_count = qualification_rejected`.
//   3. the diagnostic carried PRE-enrichment `missing_fields`, so the timing
//      classifier never saw the real (post-enrichment) gap.
//
// This module is the SINGLE reducer that turns everything already decided upstream
// (source gate, evidence sufficiency, company enrichment outcome, Aria/persistence)
// into exactly ONE mutually exclusive final state. It does not re-decide policy and
// it never loosens persistence: `qualify_now` is returned only when the canonical
// persistence decision already said persist.
//
// Core principle (inherited from evidenceSufficiency): MISSING EVIDENCE IS NOT
// REJECTION. `reject` is reserved for genuine contradictions — unverified identity,
// artifact mismatch, hard evidence violations, ICP contradictions, or a
// threshold/Aria refusal on a candidate whose evidence is COMPLETE.

import type { EvidenceCategory } from "./evidenceContract.ts";
import type { SufficiencyDecision } from "./evidenceSufficiency.ts";

/** The only three final states a candidate may end in. Mutually exclusive. */
export type FinalCandidateState = "qualify_now" | "stage_missing_evidence" | "reject";

/** Why a candidate is staged (never a rejection cause). */
export type StageReason =
  | "missing_company_evidence"
  | "missing_timing_signal"
  | "missing_official_proof"
  | "incomplete_identity"
  | "company_no_result"
  | "company_timeout"
  | "company_deadline_skipped"
  | "awaiting_qualification"
  | "unfillable_gap"
  | "not_accepted";

/** The cheapest stage that could close the gap. */
export type NextAction =
  | "company_enrichment"
  | "signal_enrichment"
  | "web_verification"
  | "manual_review"
  | "qualification"
  | null;

/** Genuine contradiction classes. Never a container for missing evidence. */
export type FinalRejectionClass =
  | "hard_source"
  | "icp_mismatch"
  | "qualification_threshold"
  | null;

/** Company-enrichment outcome as the orchestrator classified it, per candidate. */
export type CompanyEnrichmentOutcomeForCandidate =
  | "enriched"
  | "no_result"
  | "failed"
  | "timeout"
  | "skipped_due_deadline"
  | "not_attempted"
  | null;

export interface FinalCandidateStateResult {
  state: FinalCandidateState;
  /** Present only when state === "stage_missing_evidence". */
  stage_reason: StageReason | null;
  /** Present only when state === "reject". Null/absent otherwise. */
  rejection_class: FinalRejectionClass;
  next_action: NextAction;
  reason_code: string;
  /** POLICY: may this candidate become a final persisted lead? Only qualify_now. */
  persist: boolean;
  /**
   * POLICY: may this candidate be treated as an ACCEPTED lead downstream?
   *
   * This is NOT the Aria SCREENING handoff. Aria screens/ranks the whole
   * source-gate-accepted provider pool, so a staged or rejected candidate is still
   * legitimately handed to Aria. Observed screening membership belongs to
   * run-agent's telemetry (`sent_to_downstream_aria` / `aria_screening_handoff`) and
   * must be derived from the real handoff set — never from this field.
   */
  sent_to_downstream_aria: boolean;
}

export interface FinalCandidateStateInput {
  /** Source-gate verdict ("accept" | "reject" | "needs_verification" | ...). */
  sourceGateDecision?: string | null;
  /** Provider provenance validated. Necessary, never sufficient. */
  providerVerified: boolean;
  /** Candidate artifact type matches the requested entity. */
  artifactMatches: boolean;
  /** Hard evidence-invariant violations (see HARD_EVIDENCE_BLOCKERS). */
  hardEvidenceViolation?: string | null;
  /** The candidate's own verified evidence contradicts the ICP. */
  icpContradiction?: boolean;
  /** Post-enrichment sufficiency verdict (authoritative when present). */
  sufficiencyDecision?: SufficiencyDecision | null;
  /** Post-enrichment critical gaps (authoritative when present). */
  missingCritical?: readonly EvidenceCategory[] | null;
  /** How company enrichment ended for this candidate's company. */
  companyOutcome?: CompanyEnrichmentOutcomeForCandidate;
  /** Did qualification/Aria actually evaluate this candidate? */
  ariaEvaluated: boolean;
  /** The canonical persistence verdict already computed upstream. */
  persistDecision: { persist: boolean; reason: string };
  /** Enrichment force-staged this candidate (fit proven, timing still missing). */
  stagedByEnrichment?: boolean;
}

/** Timing/buying-signal categories — a missing one of these is never a reject. */
const SIGNAL_CATS: ReadonlySet<string> = new Set([
  "job_signal", "funding_signal", "launch_signal", "expansion_signal", "founder_activity_signal", "gtm_signal",
]);
/** Firmographic categories structured company enrichment can fill. */
const FIRMOGRAPHIC_CATS: ReadonlySet<string> = new Set([
  "company_identity", "company_website", "company_industry", "company_size", "company_geography",
]);

const stage = (
  stage_reason: StageReason, next_action: NextAction, reason_code: string,
): FinalCandidateStateResult => ({
  state: "stage_missing_evidence", stage_reason, rejection_class: null, next_action,
  reason_code, persist: false, sent_to_downstream_aria: false,
});

const reject = (
  rejection_class: Exclude<FinalRejectionClass, null>, reason_code: string,
): FinalCandidateStateResult => ({
  state: "reject", stage_reason: null, rejection_class, next_action: null,
  reason_code, persist: false, sent_to_downstream_aria: false,
});

/**
 * Reduce every upstream signal to ONE final state.
 *
 * Precedence (first match wins):
 *   1. hard source contradictions           → reject(hard_source)
 *   2. verified ICP contradiction           → reject(icp_mismatch)
 *   3. canonical persistence said persist   → qualify_now
 *   4. company enrichment could not answer  → stage(company_*)
 *   5. sufficiency routes the gap           → stage(missing_*)
 *   6. evidence COMPLETE but refused        → reject(qualification_threshold)
 *   7. anything else                        → stage(not_accepted)
 */
export function resolveFinalCandidateState(input: FinalCandidateStateInput): FinalCandidateStateResult {
  // 1) Hard source contradictions — identity/provenance/artifact are unusable.
  if ((input.sourceGateDecision ?? "").toString().toLowerCase() === "reject") {
    return reject("hard_source", "source_gate_reject");
  }
  if (!input.providerVerified) return reject("hard_source", "unverified_provenance");
  if (!input.artifactMatches) return reject("hard_source", "artifact_mismatch");
  if (input.hardEvidenceViolation) {
    return reject("hard_source", `evidence_violation:${input.hardEvidenceViolation}`);
  }

  // 2) The candidate's own verified evidence contradicts the ICP.
  if (input.icpContradiction === true) return reject("icp_mismatch", "icp_contradiction");

  // 3) The canonical persistence authority already accepted it. Enrichment may only
  //    TIGHTEN, so a force-staged candidate never reaches qualify_now here.
  if (input.persistDecision.persist === true && input.stagedByEnrichment !== true) {
    return {
      state: "qualify_now", stage_reason: null, rejection_class: null, next_action: null,
      reason_code: input.persistDecision.reason || "aria_accepted",
      persist: true, sent_to_downstream_aria: true,
    };
  }

  // 4) Company enrichment could not answer "does the company fit?" — the candidate
  //    is unproven, not contradicted. Stage it truthfully with the honest cause.
  switch (input.companyOutcome) {
    case "no_result":
      return stage("company_no_result", "company_enrichment", "company_no_result");
    case "timeout":
      return stage("company_timeout", "company_enrichment", "company_timeout");
    case "failed":
      return stage("company_no_result", "company_enrichment", "company_provider_error");
    case "skipped_due_deadline":
      return stage("company_deadline_skipped", "company_enrichment", "company_skipped_due_deadline");
  }

  // 5) Route the remaining gap to the cheapest capable stage. `sufficiencyDecision`
  //    is the same verdict the company observability reports, so both agree.
  const missing = (input.missingCritical ?? []).map(String);
  switch (input.sufficiencyDecision) {
    case "structured_company_enrichment":
      return stage("missing_company_evidence", "company_enrichment", "missing_firmographics");
    case "signal_enrichment":
      return stage("missing_timing_signal", "signal_enrichment", "missing_timing_signal");
    case "targeted_web_verification":
      return stage("missing_official_proof", "web_verification", "missing_official_proof");
    case "stage_missing_evidence":
      return stage(
        missing.some((c) => !FIRMOGRAPHIC_CATS.has(c) && !SIGNAL_CATS.has(c)) ? "incomplete_identity" : "unfillable_gap",
        "manual_review", "unfillable_gap",
      );
    case "reject_source":
      return reject("hard_source", "reject_source");
  }

  // 5b) No sufficiency verdict available — fall back to the gap shape itself, so a
  //     missing timing signal still stages instead of masquerading as a threshold.
  if (missing.length) {
    if (missing.some((c) => SIGNAL_CATS.has(c))) {
      return stage("missing_timing_signal", "signal_enrichment", "missing_timing_signal");
    }
    if (missing.some((c) => FIRMOGRAPHIC_CATS.has(c))) {
      return stage("missing_company_evidence", "company_enrichment", "missing_firmographics");
    }
  }

  // Qualification never ran — unproven, never accepted.
  if (!input.ariaEvaluated) return stage("awaiting_qualification", "qualification", "no_qualification");

  // 6) Evidence is COMPLETE and qualification still refused it: a genuine
  //    threshold/ICP contradiction rather than a missing-evidence artifact.
  if (input.sufficiencyDecision === "qualify_now" || missing.length === 0) {
    const reason = input.persistDecision.reason || "below_threshold";
    return reject("qualification_threshold", reason);
  }

  // 7) Held back for review without a routable gap.
  return stage("not_accepted", "manual_review", input.persistDecision.reason || "not_accepted");
}

// ------------------------------------------------------- evidence refresh --

/** Legacy `missing_fields` (leadQuality.scoreLead) → canonical EvidenceCategory. */
const LEGACY_TO_CATEGORY: Readonly<Record<string, string>> = {
  website: "company_website",
  industry: "company_industry",
  location: "company_geography",
  company_size: "company_size",
  size: "company_size",
};

/** Verified firmographics merged onto a candidate after company enrichment. */
export interface CompanyEvidencePatchLike {
  company_website?: string | null;
  company_industries?: string[] | string | null;
  company_employee_count?: number | null;
  company_employee_range?: string | null;
  company_country?: string | null;
  company_country_code?: string | null;
}

const has = (v: unknown): boolean =>
  v != null && v !== "" && !(Array.isArray(v) && v.length === 0);

/**
 * Recompute a candidate's missing-evidence list AFTER company enrichment.
 *
 * `sufficiencyMissingAfter` is authoritative when present — it is recomputed from
 * the updated candidate envelope by evaluateEvidenceSufficiency, so it already
 * reflects merged evidence and it is the SAME list the company observability
 * reports. Only when it is absent (candidate never enriched) do we fall back to
 * refreshing the legacy pre-enrichment array against the verified patch.
 *
 * Only source-backed normalized evidence closes a gap: the patch carries verified
 * provider firmographics. Company Brain values and LLM inference are never inputs.
 */
export function refreshEvidenceMissing(input: {
  staleMissingFields?: readonly string[] | null;
  patch?: CompanyEvidencePatchLike | null;
  sufficiencyMissingAfter?: readonly EvidenceCategory[] | null;
}): string[] {
  if (input.sufficiencyMissingAfter != null) {
    // Authoritative post-enrichment gaps, already in canonical vocabulary. An empty
    // array is meaningful (every gap closed) and must not fall through to the stale list.
    return [...new Set(input.sufficiencyMissingAfter.map(String))];
  }
  const patch = input.patch ?? null;
  const canonical = (input.staleMissingFields ?? [])
    .map((f) => LEGACY_TO_CATEGORY[String(f).toLowerCase()] ?? String(f));
  const closed = new Set<string>();
  if (patch) {
    if (has(patch.company_website)) closed.add("company_website");
    if (has(patch.company_industries)) closed.add("company_industry");
    if (has(patch.company_employee_count) || has(patch.company_employee_range)) closed.add("company_size");
    if (has(patch.company_country) || has(patch.company_country_code)) closed.add("company_geography");
  }
  return [...new Set(canonical.filter((c) => !closed.has(c)))];
}
