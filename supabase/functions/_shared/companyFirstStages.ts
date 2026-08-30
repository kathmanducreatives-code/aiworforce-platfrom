// STAGE AND STATUS SEMANTICS FOR THE COMPANY-FIRST FUNNEL.
//
// The failure this prevents: counting the wrong thing as a lead. A company that
// fits the ICP is not a lead. A company that is hiring is not a lead. A verified
// founder is not a lead. Only a CONTACT-ready record with quota_eligible=true is,
// and every earlier stage has to stay VISIBLE rather than being folded into a
// single pass/fail that flatters the numbers.
//
// The stages are non-overlapping and ordered: a record occupies exactly one, and
// `advance` may only move it forward or to a terminal state.
//
// Pure. No I/O.

import {
  attributionOnlyStatus, extractAggregatorEvidence,
  type AggregatorEvidence, type AggregatorStatus,
} from "./companyAggregatorEvidence.ts";

export type CompanyStage =
  | "candidate_discovered"
  | "identity_pending"
  | "enrichment_pending"
  | "enrichment_complete"
  | "company_fit_pass"
  | "company_fit_reject"
  | "company_fit_pending"
  | "hiring_pending"
  | "hiring_verified"
  | "hiring_not_verified"
  | "qualified_company"
  | "founder_pending"
  | "founder_verified"
  | "founder_mismatch"
  | "contact_pending";

export type LeadVerdict = "CONTACT" | "WATCH" | "NEEDS_REVIEW" | "REJECT" | "SKIP";

export const COMPANY_STAGE_ORDER: readonly CompanyStage[] = [
  "candidate_discovered", "identity_pending", "enrichment_pending", "enrichment_complete",
  "company_fit_pending", "company_fit_pass", "hiring_pending", "hiring_verified",
  "qualified_company", "founder_pending", "founder_verified", "contact_pending",
];

/** Stages a record cannot progress out of within a round. */
export const TERMINAL_STAGES: readonly CompanyStage[] =
  ["company_fit_reject", "hiring_not_verified", "founder_mismatch"];

/**
 * ONLY THIS COUNTS. Every other stage is progress, not a lead.
 *
 * Stated as a function rather than a constant because the temptation — and the
 * historical bug — is to count `qualified_company` or `founder_verified` when
 * the CONTACT number looks disappointing.
 */
export function countsTowardQuota(
  verdict: LeadVerdict | null | undefined, quotaEligible: boolean,
): boolean {
  return verdict === "CONTACT" && quotaEligible === true;
}

export interface CompanyRecordState {
  company_key: string;
  stage: CompanyStage;
  /** Why the record is where it is. Kept for rejects, not just passes. */
  stage_reason: string;
  failed_gates: string[];
  missing_evidence: string[];
  aggregator: AggregatorEvidence | null;
  verdict: LeadVerdict | null;
  quota_eligible: boolean;
  history: Array<{ stage: CompanyStage; reason: string }>;
}

export function newCompanyRecord(company_key: string): CompanyRecordState {
  return {
    company_key, stage: "candidate_discovered", stage_reason: "discovered",
    failed_gates: [], missing_evidence: [], aggregator: null,
    verdict: null, quota_eligible: false,
    history: [{ stage: "candidate_discovered", reason: "discovered" }],
  };
}

/** Move a record forward. Backwards moves are rejected, not silently applied. */
export function advance(
  rec: CompanyRecordState, to: CompanyStage, reason: string,
): CompanyRecordState {
  const isTerminalTarget = TERMINAL_STAGES.includes(to);
  const from = COMPANY_STAGE_ORDER.indexOf(rec.stage);
  const next = COMPANY_STAGE_ORDER.indexOf(to);
  if (!isTerminalTarget && from >= 0 && next >= 0 && next < from) {
    return { ...rec, stage_reason: `refused_backwards_transition:${rec.stage}->${to}` };
  }
  return {
    ...rec, stage: to, stage_reason: reason,
    history: [...rec.history, { stage: to, reason }],
  };
}

// ── COMPANY-FIT GATE ─────────────────────────────────────────────────────────

export interface CompanyFitInput {
  company_key: string;
  /**
   * The DISPLAY name. Distinct from `company_key`, which is an internal
   * namespaced id — passing the key here made the aggregator detector see a
   * name/domain mismatch on every company and hold real ones as pending.
   */
  company_name?: string | null;
  identity_status: "verified_match" | "ambiguous" | "mismatch" | "unresolved";
  enrichment_complete: boolean;
  /** Enriched exact headcount. The ONLY value the size gate may read. */
  employee_count: number | null;
  /** Advisory only — present so a diagnostic can show it was ignored. */
  employee_range_advisory: string | null;
  employee_min?: number | null;
  employee_max?: number | null;
  industry_ids: Array<{ id: string; name: string; hierarchy?: string | null }>;
  positive_industries?: string[];
  excluded_industries?: string[];
  geography?: string | null;
  required_geography?: string | null;
  description?: string | null;
  provider_industry?: string | null;
  canonical_domain?: string | null;
  postings?: Array<{ job_id?: string | null; title?: string | null; description?: string | null }>;
  /**
   * Does the MISSION ask for intermediaries?
   *
   * Changes exactly one thing: being a staffing or recruiting business stops
   * being a rejection, because it is then the thing that was requested. Postings
   * that belong to somebody else still reject — see `attributionOnlyStatus`.
   * Omitted, behaviour is exactly as before.
   */
  mission_targets_intermediaries?: boolean;
}

export interface CompanyFitResult {
  stage: "company_fit_pass" | "company_fit_reject" | "company_fit_pending";
  reason: string;
  failed_gates: string[];
  missing_evidence: string[];
  aggregator: AggregatorEvidence;
}

/**
 * The preliminary company-fit gate.
 *
 * Two rules carry most of the weight:
 *   * Missing evidence is PENDING, never a rejection. A company we failed to
 *     enrich is unknown, not unsuitable, and hard-rejecting it destroys a real
 *     lead permanently while looking like precision.
 *   * The size gate reads `employee_count` ONLY. `employee_range_advisory`
 *     contradicted it by up to 23x in the live benchmark.
 */
export function evaluateCompanyFit(i: CompanyFitInput): CompanyFitResult {
  const failed: string[] = [];
  const missing: string[] = [];

  const aggregator = extractAggregatorEvidence({
    company_name: i.company_name ?? null, industry_ids: i.industry_ids,
    provider_industry: i.provider_industry, description: i.description,
    canonical_domain: i.canonical_domain, postings: i.postings,
  });

  // IDENTITY. Ambiguous/unresolved is pending — never a reject, and never sent
  // on to founder search where it would spend money on the wrong company.
  if (i.identity_status === "mismatch") {
    failed.push("identity_mismatch");
    return { stage: "company_fit_reject", reason: "identity_mismatch", failed_gates: failed, missing_evidence: missing, aggregator };
  }
  if (i.identity_status !== "verified_match") {
    missing.push(`identity_${i.identity_status}`);
  }

  if (!i.enrichment_complete) missing.push("enrichment_incomplete");

  // ── STAFFING / AGGREGATOR ──────────────────────────────────────────────
  //
  // THE MISSION DECIDES WHICH HALF OF THIS EVIDENCE IS A FINDING.
  //
  // On 2026-08-30 a live run for "5 recruiting or staffing companies … hiring
  // sales roles" verified hiring at Storm4, Talentoma and Storm3 and then
  // rejected all three here, `staffing_or_aggregator`, before the Company Brain
  // ran — because this gate could not see that staffing firms were the ICP. The
  // request and the exclusion named the same category, so the mission could not
  // return a single lead no matter what else worked.
  //
  // When the mission targets intermediaries, "is an intermediary" is a match,
  // not a fault. What survives is the other question the evidence answers:
  // whether these postings are this company's own hiring. A staffing firm
  // advertising a client's role is still not evidence that IT is hiring, and
  // that half rejects for every mission alike.
  const aggregatorFinding: AggregatorStatus = i.mission_targets_intermediaries
    ? attributionOnlyStatus(aggregator)
    : aggregator.status;
  if (aggregatorFinding === "supported") {
    failed.push("staffing_or_aggregator");
    return { stage: "company_fit_reject", reason: "staffing_or_aggregator", failed_gates: failed, missing_evidence: missing, aggregator };
  }
  if (aggregatorFinding === "possible") missing.push("aggregator_evidence_inconclusive");

  // SIZE — exact count only.
  if (i.employee_min != null || i.employee_max != null) {
    if (i.employee_count === null) {
      missing.push("employee_count_unknown" +
        (i.employee_range_advisory ? `:advisory_range_present_but_untrusted` : ""));
    } else {
      if (i.employee_min != null && i.employee_count < i.employee_min) failed.push("employee_count_below_min");
      if (i.employee_max != null && i.employee_count > i.employee_max) failed.push("employee_count_above_max");
    }
  }

  // INDUSTRY — enriched ids and hierarchy, never the provider label.
  const names = i.industry_ids.flatMap((x) => [x.name, x.hierarchy ?? ""])
    .join(" ").toLowerCase();
  if ((i.excluded_industries ?? []).some((x) => x && names.includes(x.toLowerCase()))) {
    failed.push("excluded_industry");
  }
  // INDUSTRY IS NEVER A HARD REJECTION ON WORDING.
  //
  // This used to `failed.push("industry_not_in_icp")` when the enriched industry
  // names did not literally contain an ICP phrase. LinkedIn's vocabulary has no
  // "B2B SaaS" — it has "Software Development", "Technology, Information and
  // Internet", "IT Services and IT Consulting" — so every company in the audited
  // run would have hard-failed on wording alone, including one whose YC one-liner
  // describes a product sold to engineering organisations.
  //
  // A label mismatch is now MISSING EVIDENCE, which makes the stage
  // `company_fit_pending` and routes the company to the structured semantic
  // assessment that can actually read the product and the customer. It is not a
  // loosening: the label alone cannot pass a company either, and
  // `excluded_industries` above still rejects outright.
  if ((i.positive_industries ?? []).length > 0) {
    if (i.industry_ids.length === 0) missing.push("industry_evidence_absent");
    else if (!(i.positive_industries ?? []).some((x) => x && names.includes(x.toLowerCase()))) {
      missing.push("industry_label_not_in_icp_wording");
    }
  }

  // GEOGRAPHY.
  if (i.required_geography) {
    if (!i.geography) missing.push("geography_unknown");
    else if (!i.geography.toLowerCase().includes(i.required_geography.toLowerCase())) {
      failed.push("geography_mismatch");
    }
  }

  if (failed.length > 0) {
    return { stage: "company_fit_reject", reason: failed[0], failed_gates: failed, missing_evidence: missing, aggregator };
  }
  if (missing.length > 0) {
    return { stage: "company_fit_pending", reason: missing[0], failed_gates: failed, missing_evidence: missing, aggregator };
  }
  return { stage: "company_fit_pass", reason: "all_gates_passed", failed_gates: [], missing_evidence: [], aggregator };
}

// ── FUNNEL COUNTERS (the Workbench contract) ────────────────────────────────

export interface FunnelCounts {
  candidates_discovered: number;
  identity_pending: number;
  enrichment_pending: number;
  enrichment_complete: number;
  company_fit_evaluated: number;
  company_fit_pass: number;
  company_fit_reject: number;
  company_fit_pending: number;
  hiring_checked: number;
  hiring_verified: number;
  hiring_not_verified: number;
  qualified_companies: number;
  founder_searched: number;
  founder_verified: number;
  founder_mismatch: number;
  contact_ready: number;
  quota_counted: number;
}

/**
 * Project the funnel for the Workbench.
 *
 * Every stage is reported separately so a run that found 9 qualified companies
 * and 0 contacts reads as exactly that, instead of as "0 leads" with the work
 * invisible. Qualified companies stay visible while founder search is pending.
 */
export function projectFunnel(records: readonly CompanyRecordState[]): FunnelCounts {
  const at = (s: CompanyStage) => records.filter((r) => r.stage === s).length;
  const reached = (s: CompanyStage) =>
    records.filter((r) => r.history.some((h) => h.stage === s)).length;
  return {
    candidates_discovered: records.length,
    identity_pending: at("identity_pending"),
    enrichment_pending: at("enrichment_pending"),
    enrichment_complete: reached("enrichment_complete"),
    company_fit_evaluated: reached("company_fit_pass") + reached("company_fit_reject") + reached("company_fit_pending"),
    company_fit_pass: reached("company_fit_pass"),
    company_fit_reject: reached("company_fit_reject"),
    company_fit_pending: at("company_fit_pending"),
    hiring_checked: reached("hiring_pending"),
    hiring_verified: reached("hiring_verified"),
    hiring_not_verified: reached("hiring_not_verified"),
    qualified_companies: reached("qualified_company"),
    founder_searched: reached("founder_pending"),
    founder_verified: reached("founder_verified"),
    founder_mismatch: reached("founder_mismatch"),
    contact_ready: records.filter((r) => r.verdict === "CONTACT").length,
    quota_counted: records.filter((r) => countsTowardQuota(r.verdict, r.quota_eligible)).length,
  };
}

/** Companies eligible for founder search. Nothing else may spend that credit. */
export function foundersSearchable(records: readonly CompanyRecordState[]): CompanyRecordState[] {
  return records.filter((r) =>
    r.stage === "qualified_company" || r.history.some((h) => h.stage === "qualified_company"));
}
