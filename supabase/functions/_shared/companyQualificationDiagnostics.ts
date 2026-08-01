// PER-COMPANY QUALIFICATION DIAGNOSTICS.
//
// THE DEFECT THIS FIXES. `companyFirstSourcingState.candidate_diagnostics` has
// existed as a declared, initialized-to-`[]` field with NO WRITER anywhere in the
// codebase. Every company the Company Brain evaluated and rejected was counted —
// `companyBrain.evaluated`, `hardFail`, `rejectReasons` all increment — and then
// dropped by the qualification filter in `compoundSourcingPipeline` without
// leaving a single per-company record. The run could report "25 companies
// evaluated, 0 qualified" and show an empty Workbench with no way to see WHICH
// companies those were or WHY each failed.
//
// This module builds one bounded, deduplicated diagnostic per evaluated company.
// It is diagnostics ONLY: nothing here persists an account, qualifies anything,
// or touches quota. A rejected company remains non-CONTACT, quota-ineligible and
// absent from Opportunities — it simply becomes visible under Insights.
//
// Pure. No provider, model, network or database access.

export const COMPANY_DIAGNOSTIC_VERSION = "company-qualification-diagnostic-1.0.0";

/**
 * Progressive qualification state.
 *
 * Ordered by how far the company actually got. `rejected` is terminal for this
 * run; every other value describes work that may still continue.
 */
export type QualificationStatus =
  | "company_resolved"
  | "qualification_pending"
  | "qualified"
  | "rejected"
  | "decision_maker_pending"
  | "decision_maker_unverified"
  | "contact_enrichment_pending"
  | "contact_ready";

export const QUALIFICATION_STATUSES: readonly QualificationStatus[] = [
  "company_resolved", "qualification_pending", "qualified", "rejected",
  "decision_maker_pending", "decision_maker_unverified",
  "contact_enrichment_pending", "contact_ready",
];

/** Whether the company's identity was resolved well enough to act on. */
export type IdentityStatus = "resolved" | "partial" | "unresolved";

/** The Brain's own verdict, in its own vocabulary. */
export type BrainStatus = "pass" | "fail" | "evidence_pending" | "not_enforced";

export interface CompanyQualificationDiagnostic {
  company_key: string;
  company_name: string;
  company_domain: string;
  company_linkedin_url: string;
  hiring_signal_title: string;
  hiring_signal_url: string;
  hiring_signal_date: string;
  source_capabilities: string[];
  title_family: string;
  title_confidence: string;
  company_identity_status: IdentityStatus;
  company_brain_status: BrainStatus;
  /** Constraints the Brain EVALUATED and rejected. Never free text. */
  failed_gates: string[];
  /**
   * Constraints with no evidence either way.
   *
   * Kept apart from `failed_gates` because the remedies are opposite: a failed
   * gate means this company is wrong for the ICP, while missing evidence means
   * nobody has looked yet. Collapsing them reported ten companies as rejected on
   * four gates when only one was a real mismatch.
   */
  missing_evidence: string[];
  qualification_status: QualificationStatus;
  decision_maker_eligibility: boolean;
  quota_eligible: boolean;
}

export const DIAGNOSTIC_BOUNDS = {
  /** Per task. Beyond this the tail is dropped rather than growing the checkpoint. */
  maxDiagnostics: 200,
  maxTextChars: 160,
  maxUrlChars: 400,
  maxGates: 12,
  maxCapabilities: 6,
} as const;

const str = (v: unknown, max: number = DIAGNOSTIC_BOUNDS.maxTextChars): string => {
  const s = String(v ?? "").trim();
  return s.length > max ? s.slice(0, max) : s;
};

function strList(v: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const raw of v) {
    const s = str(raw, maxChars);
    if (!s || out.some((x) => x.toLowerCase() === s.toLowerCase())) continue;
    out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** What one evaluated company looked like at the moment the gate ran. */
export interface EvaluatedCompanyInput {
  companyKey: string;
  name?: string | null;
  domain?: string | null;
  linkedinUrl?: string | null;
  /** The hiring signal that surfaced this company. */
  signalTitle?: string | null;
  signalUrl?: string | null;
  signalDate?: string | null;
  sourceCapabilities?: readonly string[];
  titleFamily?: string | null;
  titleConfidence?: string | null;
  brainStatus: BrainStatus;
  /** Constraints the Brain evaluated and rejected. */
  failedGates?: readonly string[];
  /** Constraints with no evidence either way. Not failures. */
  missingEvidence?: readonly string[];
}

/**
 * Identity is what decides whether a company can be ACTED on.
 *
 * A name alone is not an identity: people search needs a domain or a LinkedIn
 * company URL to scope to. `partial` is therefore honest rather than generous —
 * it says "we know who this is, but not well enough to search yet".
 */
export function identityStatusFor(input: EvaluatedCompanyInput): IdentityStatus {
  const hasStrong = !!str(input.domain) || !!str(input.linkedinUrl);
  const hasName = !!str(input.name);
  if (hasStrong && hasName) return "resolved";
  if (hasName || hasStrong) return "partial";
  return "unresolved";
}

/**
 * Build one diagnostic.
 *
 * `quota_eligible` is hard-coded false and there is no parameter to change it:
 * only a CONTACT-ready PERSON counts, and no diagnostic — however far its company
 * progressed — may ever contribute to quota.
 */
export function buildCompanyDiagnostic(
  input: EvaluatedCompanyInput,
): CompanyQualificationDiagnostic {
  const identity = identityStatusFor(input);
  const failed = strList(input.failedGates, DIAGNOSTIC_BOUNDS.maxGates, 60);
  const missing = strList(input.missingEvidence, DIAGNOSTIC_BOUNDS.maxGates, 60);

  // Status follows the furthest stage actually reached, not the best case.
  let status: QualificationStatus;
  if (input.brainStatus === "fail") status = "rejected";
  else if (input.brainStatus === "evidence_pending") status = "qualification_pending";
  else if (identity === "unresolved") status = "company_resolved";
  else status = "qualified";

  // Only a company that PASSED and can be scoped is worth a people call.
  const dmEligible = status === "qualified" && identity === "resolved";

  return {
    company_key: str(input.companyKey, 200),
    company_name: str(input.name),
    company_domain: str(input.domain),
    company_linkedin_url: str(input.linkedinUrl, DIAGNOSTIC_BOUNDS.maxUrlChars),
    hiring_signal_title: str(input.signalTitle),
    hiring_signal_url: str(input.signalUrl, DIAGNOSTIC_BOUNDS.maxUrlChars),
    hiring_signal_date: str(input.signalDate, 40),
    source_capabilities: strList(input.sourceCapabilities, DIAGNOSTIC_BOUNDS.maxCapabilities, 60),
    title_family: str(input.titleFamily, 60),
    title_confidence: str(input.titleConfidence, 40),
    company_identity_status: identity,
    company_brain_status: input.brainStatus,
    failed_gates: failed,
    missing_evidence: missing,
    qualification_status: status,
    decision_maker_eligibility: dmEligible,
    quota_eligible: false,       // ALWAYS. Only a CONTACT-ready person counts.
  };
}

/**
 * Merge new diagnostics into the carried set, keyed by `company_key`.
 *
 * Deduplicates across providers, rounds, continuation and resumed runs. When the
 * same company is seen twice the LATER observation wins only if it represents
 * progress — so a resumed round cannot demote a company that already qualified,
 * and a second provider returning the same company cannot overwrite a richer
 * identity with a thinner one.
 */
export function mergeCompanyDiagnostics(
  existing: readonly CompanyQualificationDiagnostic[],
  incoming: readonly CompanyQualificationDiagnostic[],
): CompanyQualificationDiagnostic[] {
  const rank = (s: QualificationStatus): number => QUALIFICATION_STATUSES.indexOf(s);
  // Progress order for merging: later stages outrank earlier ones, and `rejected`
  // is deliberately LOW so a pass observed elsewhere is not lost to a rejection.
  const progress: Record<QualificationStatus, number> = {
    rejected: 0,
    company_resolved: 1,
    qualification_pending: 2,
    qualified: 3,
    decision_maker_pending: 4,
    decision_maker_unverified: 5,
    contact_enrichment_pending: 6,
    contact_ready: 7,
  };

  const byKey = new Map<string, CompanyQualificationDiagnostic>();
  for (const d of existing) if (d.company_key) byKey.set(d.company_key, d);

  for (const d of incoming) {
    if (!d.company_key) continue;
    const prior = byKey.get(d.company_key);
    if (!prior) { byKey.set(d.company_key, d); continue; }
    if (progress[d.qualification_status] > progress[prior.qualification_status]) {
      byKey.set(d.company_key, d);
      continue;
    }
    if (progress[d.qualification_status] === progress[prior.qualification_status]) {
      // Same stage: keep the richer identity and the union of failed gates, so a
      // second source's evidence adds to the picture rather than replacing it.
      byKey.set(d.company_key, {
        ...prior,
        company_domain: prior.company_domain || d.company_domain,
        company_linkedin_url: prior.company_linkedin_url || d.company_linkedin_url,
        hiring_signal_url: prior.hiring_signal_url || d.hiring_signal_url,
        hiring_signal_date: prior.hiring_signal_date || d.hiring_signal_date,
        source_capabilities: [...new Set([...prior.source_capabilities, ...d.source_capabilities])]
          .slice(0, DIAGNOSTIC_BOUNDS.maxCapabilities),
        failed_gates: [...new Set([...prior.failed_gates, ...d.failed_gates])]
          .slice(0, DIAGNOSTIC_BOUNDS.maxGates),
        missing_evidence: [...new Set([...prior.missing_evidence, ...d.missing_evidence])]
          .slice(0, DIAGNOSTIC_BOUNDS.maxGates),
      });
    }
    // A strictly-lower-progress observation is ignored entirely.
    void rank;
  }

  return [...byKey.values()].slice(0, DIAGNOSTIC_BOUNDS.maxDiagnostics);
}

// ------------------------------------------------------------- projection ----

export interface QualificationInsights {
  companies_evaluated: number;
  companies_qualified: number;
  companies_rejected: number;
  companies_pending: number;
  /** Failed-gate counts across every rejected company. Codes only. */
  failed_gate_counts: Record<string, number>;
  /** The rejected companies, for the Insights surface. Never Opportunities. */
  rejected: CompanyQualificationDiagnostic[];
  /** Qualified companies that can be scoped to a people search right now. */
  decision_maker_ready: CompanyQualificationDiagnostic[];
}

/**
 * Project diagnostics for the Workbench Insights surface.
 *
 * Rejected companies are returned in their OWN list. Nothing here can place a
 * rejected company among Opportunities, because Opportunities is fed from
 * persisted account rows and this projection produces none.
 */
export function buildQualificationInsights(
  diagnostics: readonly CompanyQualificationDiagnostic[],
): QualificationInsights {
  const rejected = diagnostics.filter((d) => d.qualification_status === "rejected");
  const qualified = diagnostics.filter((d) =>
    d.qualification_status !== "rejected" && d.qualification_status !== "qualification_pending" &&
    d.company_brain_status !== "fail" && d.qualification_status !== "company_resolved");
  const pending = diagnostics.filter((d) => d.qualification_status === "qualification_pending");

  const failed_gate_counts: Record<string, number> = {};
  for (const d of rejected) {
    for (const g of d.failed_gates) failed_gate_counts[g] = (failed_gate_counts[g] ?? 0) + 1;
  }

  return {
    companies_evaluated: diagnostics.length,
    companies_qualified: qualified.length,
    companies_rejected: rejected.length,
    companies_pending: pending.length,
    failed_gate_counts,
    rejected,
    decision_maker_ready: diagnostics.filter((d) => d.decision_maker_eligibility),
  };
}

/**
 * Assert a diagnostic set carries nothing that could be mistaken for a lead.
 *
 * Used by tests: the whole safety property of this module is that visibility is
 * added without any row becoming quota-eligible.
 */
export function diagnosticsAreQuotaInert(
  diagnostics: readonly CompanyQualificationDiagnostic[],
): boolean {
  return diagnostics.every((d) => d.quota_eligible === false);
}
