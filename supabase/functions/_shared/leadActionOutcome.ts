// Canonical direct-action outcome vocabulary. Pure + dependency-free.
//
// The executor's per_lead rows use action-specific shapes (`status: "enriched"`,
// `needs_manual_review`, `decision_makers: []`, `blocked_reasons`, …). Classifying
// them HERE — once, on the backend — means the Workbench renders a status it was
// given rather than re-deriving one from provider-shaped fields, which is how the
// UI drifted into reporting a pre-execution rejection as "0/4 succeeded".

export type LeadOutcomeStatus =
  | "succeeded"
  | "no_match"
  | "unavailable"
  | "missing_company_identity"
  | "needs_manual_review"
  | "timed_out"
  | "blocked"
  | "failed";

export interface ClassifiedLeadOutcome {
  lead_candidate_id: string | null;
  status: LeadOutcomeStatus;
  reason_code: string;
  retryable: boolean;
}

export type DirectActionSummary = Record<LeadOutcomeStatus | "requested", number>;

/** Outcomes worth retrying: transient provider/infra conditions only. */
const RETRYABLE: ReadonlySet<LeadOutcomeStatus> = new Set<LeadOutcomeStatus>(["timed_out", "failed"]);

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function classifyResearch(p: Record<string, unknown>): { status: LeadOutcomeStatus; reason_code: string } {
  const status = str(p.status);
  if (status === "enriched") return { status: "succeeded", reason_code: "company_enriched" };
  if (status === "blocked") {
    const reason = str(p.blocked_reason);
    if (/website|domain|linkedin|identity/i.test(reason)) {
      return { status: "missing_company_identity", reason_code: "company_domain_missing" };
    }
    return { status: "blocked", reason_code: reason || "research_blocked" };
  }
  if (status === "needs_verification") return { status: "needs_manual_review", reason_code: "evidence_needs_verification" };
  if (status === "timed_out") return { status: "timed_out", reason_code: "provider_timed_out" };
  if (status === "unavailable") return { status: "unavailable", reason_code: "provider_disabled" };
  if (status === "failed") return { status: "no_match", reason_code: "provider_no_results" };
  return { status: "failed", reason_code: "provider_failed" };
}

function defaultReasonFor(status: string): string {
  switch (status) {
    case "succeeded": return "decision_maker_found";
    case "no_match": return "provider_no_results";
    case "unavailable": return "people_search_disabled";
    case "missing_company_identity": return "company_domain_missing";
    case "needs_manual_review": return "employment_unverified";
    case "timed_out": return "provider_timed_out";
    default: return "provider_failed";
  }
}

/** The canonical vocabulary the decision-maker pipeline already emits. */
const CANONICAL_STATUSES = new Set<string>([
  "succeeded", "no_match", "unavailable", "missing_company_identity",
  "needs_manual_review", "timed_out", "failed",
]);

function classifyDecisionMakers(p: Record<string, unknown>): { status: LeadOutcomeStatus; reason_code: string } {
  const explicit = str(p.status);

  // The pipeline is authoritative: when it has already classified the row, carry
  // its status and reason_code through verbatim. Re-deriving status from
  // decision_makers.length here is what turned "provider disabled" and
  // "missing_company_identity" into a generic no_match.
  if (CANONICAL_STATUSES.has(explicit)) {
    const reason = str(p.reason_code);
    return {
      status: explicit as LeadOutcomeStatus,
      reason_code: reason || defaultReasonFor(explicit),
    };
  }

  // ---- Legacy rows (pre-integration shape) --------------------------------
  if (explicit === "unavailable" || p.people_search_disabled === true) {
    return { status: "unavailable", reason_code: "people_search_disabled" };
  }
  if (explicit === "timed_out") return { status: "timed_out", reason_code: "provider_timed_out" };
  if (explicit === "failed") return { status: "failed", reason_code: "provider_failed" };
  if (explicit === "persistence_failed") return { status: "failed", reason_code: "persistence_failed" };

  if (p.missing_company_identity === true) {
    return { status: "missing_company_identity", reason_code: "company_linkedin_url_missing" };
  }
  // Profiles surfaced but current employment could not be verified — deliberately
  // NOT "no_match": there is something for a human to look at.
  if (p.needs_manual_review === true) {
    return { status: "needs_manual_review", reason_code: "employment_unverified" };
  }
  const dms = Array.isArray(p.decision_makers) ? p.decision_makers : [];
  if (dms.length > 0) return { status: "succeeded", reason_code: "decision_maker_found" };

  // Rejected-but-found is a match-quality failure, not an empty provider result.
  const rejected = typeof p.rejected_count === "number" ? p.rejected_count : 0;
  if (rejected > 0) return { status: "no_match", reason_code: "company_match_failed" };
  return { status: "no_match", reason_code: "provider_no_results" };
}

function classifyOutreach(p: Record<string, unknown>): { status: LeadOutcomeStatus; reason_code: string } {
  const status = str(p.status);
  if (status === "draft_needs_approval") return { status: "succeeded", reason_code: "draft_ready_for_approval" };
  if (status === "blocked_draft_gate") {
    const reasons = Array.isArray(p.blocked_reasons) ? p.blocked_reasons.map(str) : [];
    const joined = reasons.join(" ");
    if (/decision[_ ]?maker|contact|recipient/i.test(joined)) {
      return { status: "blocked", reason_code: "verified_decision_maker_required" };
    }
    return { status: "blocked", reason_code: reasons[0] || "draft_gate_blocked" };
  }
  if (status === "insufficient_context") return { status: "blocked", reason_code: "evidence_required" };
  if (status === "timed_out") return { status: "timed_out", reason_code: "provider_timed_out" };
  return { status: "failed", reason_code: "provider_failed" };
}

export function classifyLeadOutcome(
  action: "research_company" | "find_decision_makers" | "generate_outreach",
  row: Record<string, unknown>,
): ClassifiedLeadOutcome {
  const base =
    action === "research_company" ? classifyResearch(row)
    : action === "find_decision_makers" ? classifyDecisionMakers(row)
    : classifyOutreach(row);

  return {
    lead_candidate_id: typeof row.lead_candidate_id === "string" ? row.lead_candidate_id : null,
    status: base.status,
    reason_code: base.reason_code,
    retryable: RETRYABLE.has(base.status),
  };
}

export function emptyDirectActionSummary(requested = 0): DirectActionSummary {
  return {
    requested,
    succeeded: 0,
    no_match: 0,
    unavailable: 0,
    missing_company_identity: 0,
    needs_manual_review: 0,
    timed_out: 0,
    blocked: 0,
    failed: 0,
  };
}

/**
 * Category counts for the batch banner. `requested` is the number of rows the
 * caller asked for, which can exceed the sum of the per-lead categories when the
 * executor dropped a row — surfacing that gap is the point.
 */
export function summarizeDirectAction(
  outcomes: ClassifiedLeadOutcome[],
  requested = outcomes.length,
): DirectActionSummary {
  const summary = emptyDirectActionSummary(requested);
  for (const o of outcomes) summary[o.status] += 1;
  return summary;
}
