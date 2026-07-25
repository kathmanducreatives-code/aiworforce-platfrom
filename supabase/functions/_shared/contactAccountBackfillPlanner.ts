// Read-only planner: classify EXISTING contacts for a future account_id backfill.
//
// It never writes. For each contact it derives the candidate account from the
// lead_candidate the contact is already attached to (lead_candidates.contact_id
// → account_id), extracts current-employer signals from the contact's stored
// provenance, and runs the SAME resolver the live persistence paths use. Only
// `verified` contacts become `safe_to_backfill`; everything else is left null
// for manual review, so the backfill can never guess an employer.
//
// Pure — no DB, no network, no model.

import {
  resolveContactAccountAssociation,
  type AssociationAccount,
  type AssociationConfidence,
} from "./contactAccountAssociation.ts";

export type BackfillClass = "safe_to_backfill" | "needs_review" | "rejected" | "already_associated";

/** A `contacts` row as read for planning (raw carries provenance). */
export interface PlannerContact {
  id: string;
  workspace_id: string;
  account_id: string | null;
  linkedin_url: string | null;
  company: string | null;
  raw?: unknown;
}

export interface PlannerLead {
  id: string;
  workspace_id: string;
  account_id: string | null;
}

export interface PlannerInput {
  workspaceId: string;
  contact: PlannerContact;
  /** The lead_candidate this contact is attached to (contact_id link). */
  leadCandidate?: PlannerLead | null;
  /** The account the leadCandidate points at (already workspace-scoped). */
  candidateAccount?: AssociationAccount | null;
}

export interface PlannerRow {
  contactId: string;
  classification: BackfillClass;
  accountId: string | null;
  confidence: AssociationConfidence;
  reasons: string[];
  evidence: Record<string, unknown>;
  /** The backfill guard value: only update a row whose current account_id equals this. */
  expectedCurrentAccountId: string | null;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Best-effort extraction of CURRENT-employer identity signals from a stored
 * contact's provenance. Reads only fields that actually carry employer identity;
 * never invents a domain or provider id.
 */
export function extractContactSignals(raw: unknown): {
  employerDomain: string | null;
  employerLinkedInUrl: string | null;
  employerName: string | null;
  providerCompanyId: string | null;
  currentEmployerVerified: boolean;
  isHistoricalEmployer: boolean;
  looksLikeProxy: boolean;
  companyScopedSearch: boolean;
} {
  const r = isObj(raw) ? raw : {};
  const match = isObj(r.company_match) ? r.company_match : {};
  const prov = isObj(r.provenance) ? r.provenance : {};
  // Current-employer verification can arrive as an explicit flag, a company_match
  // status, or (from decision-maker discovery) a forwarded `verification_status`.
  const verified =
    str(match.status) === "verified" ||
    r.current_employer_verified === true ||
    str(r.verification_status) === "verified";
  return {
    employerDomain: str(r.employer_domain) ?? str(r.company_domain) ?? str((match as Record<string, unknown>).domain) ?? str((prov as Record<string, unknown>).employer_domain),
    employerLinkedInUrl: str(r.company_linkedin_url) ?? str(r.employer_linkedin_url) ?? str((match as Record<string, unknown>).company_linkedin_url),
    employerName: str(r.company) ?? str(r.employer_name) ?? str(r.current_company_name),
    providerCompanyId: str(r.provider_company_id) ?? str((prov as Record<string, unknown>).provider_company_id) ?? str((match as Record<string, unknown>).provider_company_id),
    currentEmployerVerified: verified,
    isHistoricalEmployer: r.is_historical_employer === true,
    looksLikeProxy: r.looks_like_proxy === true || str(r.contact_kind) === "recruiter" || str(r.contact_kind) === "staffing",
    companyScopedSearch: str(r.via) === "contact_discovery" || r.company_scoped_search === true,
  };
}

export function planContactBackfill(input: PlannerInput): PlannerRow {
  const { contact, candidateAccount, leadCandidate } = input;

  const base = (cls: BackfillClass, accountId: string | null, confidence: AssociationConfidence, reasons: string[], evidence: Record<string, unknown>): PlannerRow => ({
    contactId: contact.id, classification: cls, accountId, confidence, reasons, evidence,
    // Backfill only ever targets currently-null rows; the guard is the value we
    // read now, so a concurrent change aborts the update.
    expectedCurrentAccountId: contact.account_id,
  });

  // Already durably associated → nothing to do.
  if (str(contact.account_id)) {
    return base("already_associated", contact.account_id, "high", ["contact_already_has_account_id"], { existing_account_id: contact.account_id });
  }

  // Without a candidate account we cannot verify anything.
  if (!candidateAccount) {
    return base("needs_review", null, "low", ["no_candidate_account_from_lead"], { lead_candidate_id: leadCandidate?.id ?? null });
  }

  const sig = extractContactSignals(contact.raw);
  const result = resolveContactAccountAssociation({
    workspaceId: input.workspaceId,
    contact: {
      id: contact.id, workspace_id: contact.workspace_id, account_id: contact.account_id,
      linkedin_url: contact.linkedin_url,
      employerDomain: sig.employerDomain, employerLinkedInUrl: sig.employerLinkedInUrl,
      employerName: sig.employerName ?? contact.company, providerCompanyId: sig.providerCompanyId,
      currentEmployerVerified: sig.currentEmployerVerified, isHistoricalEmployer: sig.isHistoricalEmployer,
      looksLikeProxy: sig.looksLikeProxy,
    },
    candidateAccount,
    leadCandidate: leadCandidate ? { id: leadCandidate.id, workspace_id: leadCandidate.workspace_id, account_id: leadCandidate.account_id } : null,
    companyScopedSearch: sig.companyScopedSearch,
  });

  const evidence = { signals: result.matchedSignals, conflicts: result.conflicts, provenance: result.provenance };

  switch (result.decision) {
    case "verified":
      return base("safe_to_backfill", result.accountId, result.confidence, result.reasons, evidence);
    case "rejected":
      return base("rejected", null, result.confidence, result.reasons, evidence);
    default: // needs_review | reassignment_required
      return base("needs_review", null, result.confidence, result.reasons, evidence);
  }
}
