// Canonical lead decision + contact-ready contract. Pure / import-free.
//
// Root cause it fixes: contradictory decision fields (match_tier / gate_decision
// / fit_tier / analyst_verdict / contact_status) let a lead be shown as
// "contact-ready" while it still needed verification. This module derives ONE
// canonical decision from verified facts, blocks impossible field combinations,
// and defines the strict contact-ready contract every UI/CSV/counter must use.

export type CanonicalDecision = "contact" | "watch" | "needs_review" | "skip";

export interface LeadFacts {
  /** A brain/explicit hard disqualifier was hit (overrides everything). */
  hard_disqualifier_hit: boolean;
  /** Verified company name AND (website/domain or authoritative company profile). */
  company_identity_verified: boolean;
  /** A real company-level signal backed by valid, non-identity evidence. */
  company_signal_verified: boolean;
  /** Active Company Brain ICP fit. */
  brain_fit: boolean;
  /** Signal recency / "why now" strength is strong (else the account only watches). */
  timing_strong: boolean;
  /** Target decision maker verified WITH a profile URL. */
  decision_maker_verified: boolean;
  confidence: number;       // 0..1
  min_confidence?: number;  // default 0.6
}

/**
 * The one canonical decision. Precedence (highest first):
 *   1 hard disqualifier            → skip
 *   2 no company identity          → needs_review
 *   3 no real signal/evidence      → needs_review
 *   4 off-ICP (not a fit)          → needs_review
 *   5 valid account, weak timing   → watch
 *   6 valid account+signal, no person → watch
 *   7 below confidence floor       → needs_review
 *   8 everything verified          → contact
 */
export function decideCanonical(f: LeadFacts): CanonicalDecision {
  if (f.hard_disqualifier_hit) return "skip";
  if (!f.company_identity_verified) return "needs_review";
  if (!f.company_signal_verified) return "needs_review";
  if (!f.brain_fit) return "needs_review";
  if (!f.timing_strong) return "watch";
  if (!f.decision_maker_verified) return "watch";
  if (f.confidence < (f.min_confidence ?? 0.6)) return "needs_review";
  return "contact";
}

// -------------------------------------------------------- contact-ready ------

export interface ContactReadyExtras {
  why_this_company?: string | null;
  why_now?: string | null;
  evidence_url?: string | null;
  decision_maker_profile_url?: string | null;
}

export interface ContactReadyResult {
  ready: boolean;
  missing: string[];
}

const meaningful = (s: unknown): boolean => typeof s === "string" && s.trim().length >= 8;
const hasUrl = (s: unknown): boolean => typeof s === "string" && /^https?:\/\/\S+/i.test(s.trim());

/**
 * The contact-ready contract. contact_ready is true ONLY when the canonical
 * decision is `contact` AND every required artefact is present. A profile-only
 * record, or a company without a verified person, can never be contact-ready.
 * Returns the exact missing requirements so the UI can show them.
 */
export function contactReady(f: LeadFacts, x: ContactReadyExtras): ContactReadyResult {
  const missing: string[] = [];
  if (f.hard_disqualifier_hit) missing.push("hard disqualifier hit");
  if (!f.company_identity_verified) missing.push("verified company name + website/domain");
  if (!f.brain_fit) missing.push("active Company Brain fit");
  if (!f.company_signal_verified) missing.push("verified company-level signal");
  if (!hasUrl(x.evidence_url)) missing.push("valid evidence URL");
  if (!meaningful(x.why_this_company)) missing.push("meaningful why_this_company");
  if (!meaningful(x.why_now)) missing.push("meaningful why_now");
  if (!f.decision_maker_verified) missing.push("verified target decision maker");
  if (!hasUrl(x.decision_maker_profile_url)) missing.push("decision-maker profile URL");
  if (f.confidence < (f.min_confidence ?? 0.6)) missing.push("minimum confidence");

  const decision = decideCanonical(f);
  const ready = decision === "contact" && missing.length === 0;
  return { ready, missing };
}

// ------------------------------------------------ legacy consistency guard ---

export interface LegacyDecisionFields {
  match_tier?: string | null;      // strict | secondary | reject
  gate_decision?: string | null;   // accept | reject | needs_review
  fit_tier?: string | null;        // e.g. rejected | qualified
  analyst_verdict?: string | null; // verified | needs_verification | rejected
}

/**
 * Detect an impossible legacy combination, e.g. fit_tier=rejected + match_tier=
 * reject + gate_decision=accept. Returns a reason string, or null when consistent.
 */
export function detectContradiction(legacy: LegacyDecisionFields): string | null {
  const rejects = [
    /reject/i.test(legacy.match_tier ?? ""),
    /reject/i.test(legacy.fit_tier ?? ""),
    /reject/i.test(legacy.analyst_verdict ?? ""),
  ].some(Boolean);
  const accepts = /accept/i.test(legacy.gate_decision ?? "");
  if (rejects && accepts) return "A reject in match_tier/fit_tier/analyst_verdict cannot co-exist with gate_decision=accept.";
  return null;
}

/**
 * Reconcile legacy fields with the canonical decision. Any hard reject forces a
 * non-contact canonical outcome — a high score can never overturn a disqualifier.
 */
export function reconcile(f: LeadFacts, legacy: LegacyDecisionFields): { decision: CanonicalDecision; blocked: string | null } {
  const contradiction = detectContradiction(legacy);
  let decision = decideCanonical(f);
  const anyReject =
    /reject/i.test(legacy.match_tier ?? "") || /reject/i.test(legacy.fit_tier ?? "") || /reject/i.test(legacy.analyst_verdict ?? "");
  if (anyReject && decision === "contact") decision = "needs_review"; // never contact over a reject
  if (f.hard_disqualifier_hit) decision = "skip";
  return { decision, blocked: contradiction };
}
