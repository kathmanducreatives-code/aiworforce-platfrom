// Explainable lead scoring. Pure / import-free.
//
// Root cause it fixes: flat/template scores gave materially different records
// identical numbers, and a 30/100 profile-only record could show as a
// three-star contact-ready lead. This produces component scores, a final score,
// a breakdown and a human explanation — with hard rules: a disqualifier caps the
// score near zero (a high score can never overcome it), exact role evidence
// outranks adjacent sales hiring, and missing evidence cuts both score and
// confidence.

import type { RoleExactness } from "./roleFamilyMatcher.ts";

export interface ScoreInputs {
  company_icp_fit: boolean;
  industry_fit: boolean;
  business_model_fit: boolean;
  company_size_fit: boolean;
  geography_fit: boolean;
  requested_role_exactness: RoleExactness;   // exact | adjacent | unrelated
  signal_relevant: boolean;                  // a real, relevant company-level signal
  evidence_quality: "primary" | "secondary" | "weak" | "none";
  evidence_recent: boolean;
  decision_maker_complete: boolean;          // person verified + profile URL
  hard_disqualifier_hit: boolean;
  missing_evidence_count: number;
  profile_only: boolean;                     // record is a person profile with no verified company
}

export interface ScoreBreakdown {
  company_icp_fit: number;
  industry_fit: number;
  business_model_fit: number;
  company_size_fit: number;
  geography_fit: number;
  requested_role_exactness: number;
  signal_relevance: number;
  evidence_quality: number;
  evidence_recency: number;
  decision_maker_completeness: number;
  disqualifier_penalty: number;
  missing_evidence_penalty: number;
}

export interface ScoreResult {
  final_score: number;        // 0..100
  confidence: number;         // 0..1
  score_breakdown: ScoreBreakdown;
  score_explanation: string;
}

// Positive component weights (sum = 100 before penalties).
const W = {
  company_icp_fit: 16,
  industry_fit: 10,
  business_model_fit: 8,
  company_size_fit: 8,
  geography_fit: 8,
  requested_role_exactness: 20, // the single biggest lever — exact role dominates
  signal_relevance: 14,
  evidence_quality: 8,
  evidence_recency: 4,
  decision_maker_completeness: 4,
};

const roleScore = (e: RoleExactness): number => (e === "exact" ? W.requested_role_exactness : e === "adjacent" ? W.requested_role_exactness * 0.25 : 0);
const evidenceScore = (q: ScoreInputs["evidence_quality"]): number =>
  q === "primary" ? W.evidence_quality : q === "secondary" ? W.evidence_quality * 0.6 : q === "weak" ? W.evidence_quality * 0.25 : 0;

export function scoreLead(inp: ScoreInputs): ScoreResult {
  const b: ScoreBreakdown = {
    company_icp_fit: inp.company_icp_fit ? W.company_icp_fit : 0,
    industry_fit: inp.industry_fit ? W.industry_fit : 0,
    business_model_fit: inp.business_model_fit ? W.business_model_fit : 0,
    company_size_fit: inp.company_size_fit ? W.company_size_fit : 0,
    geography_fit: inp.geography_fit ? W.geography_fit : 0,
    requested_role_exactness: roleScore(inp.requested_role_exactness),
    signal_relevance: inp.signal_relevant ? W.signal_relevance : 0,
    evidence_quality: evidenceScore(inp.evidence_quality),
    evidence_recency: inp.evidence_recent ? W.evidence_recency : 0,
    decision_maker_completeness: inp.decision_maker_complete ? W.decision_maker_completeness : 0,
    disqualifier_penalty: 0,
    missing_evidence_penalty: 0,
  };

  let raw =
    b.company_icp_fit + b.industry_fit + b.business_model_fit + b.company_size_fit + b.geography_fit +
    b.requested_role_exactness + b.signal_relevance + b.evidence_quality + b.evidence_recency + b.decision_maker_completeness;

  // Missing evidence penalty (bounded), reduces score AND confidence.
  const missPenalty = Math.min(30, Math.max(0, inp.missing_evidence_count) * 6);
  b.missing_evidence_penalty = -missPenalty;
  raw -= missPenalty;

  // Profile-only records cannot score well (no verified company).
  if (inp.profile_only) raw = Math.min(raw, 25);

  const reasons: string[] = [];
  // Hard disqualifier caps the score near zero — never overcome by a high score.
  if (inp.hard_disqualifier_hit) {
    b.disqualifier_penalty = -100;
    raw = Math.min(raw, 5);
    reasons.push("hard disqualifier → capped near zero");
  }
  if (inp.requested_role_exactness === "exact") reasons.push("exact requested-role evidence");
  else if (inp.requested_role_exactness === "adjacent") reasons.push("adjacent sales role only (watch)");
  else reasons.push("no requested-role match");
  if (inp.profile_only) reasons.push("profile-only (no verified company)");
  if (inp.signal_relevant) reasons.push("relevant company signal"); else reasons.push("no verified company signal");
  if (missPenalty > 0) reasons.push(`${inp.missing_evidence_count} missing-evidence penalty`);

  const final_score = Math.max(0, Math.min(100, Math.round(raw)));

  // Confidence tracks evidence completeness + fit, dampened by missing evidence
  // and profile-only. A disqualifier or profile-only never reads as confident.
  let confidence = 0.35
    + (inp.company_icp_fit ? 0.15 : 0)
    + (inp.signal_relevant ? 0.2 : 0)
    + (inp.evidence_quality === "primary" ? 0.2 : inp.evidence_quality === "secondary" ? 0.1 : 0)
    + (inp.decision_maker_complete ? 0.1 : 0);
  confidence -= Math.min(0.3, inp.missing_evidence_count * 0.08);
  if (inp.profile_only) confidence = Math.min(confidence, 0.4);
  if (inp.hard_disqualifier_hit) confidence = Math.min(confidence, 0.2);
  confidence = Math.max(0, Math.min(1, Number(confidence.toFixed(2))));

  return { final_score, confidence, score_breakdown: b, score_explanation: reasons.join("; ") };
}
