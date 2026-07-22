// Thin persistence glue: from a contact being written (attached to a
// lead_candidate) decide whether it may carry a durable `account_id`.
//
// It resolves the candidate account from the lead_candidate the contact was
// found for, extracts current-employer signals from the contact's provenance,
// and runs the pure `resolveContactAccountAssociation`. It returns an account_id
// ONLY when the association is `verified` — otherwise null, so a contact write
// leaves account_id untouched (needs_review) rather than guessing an employer.
//
// This is the single place the null-producing write paths call, so
// decision-maker discovery, contact discovery and future paths stay consistent.

import {
  resolveContactAccountAssociation,
  type AssociationConfidence,
  type AssociationDecision,
} from "./contactAccountAssociation.ts";
import { extractContactSignals } from "./contactAccountBackfillPlanner.ts";

/** The narrow slice of a Supabase admin client this helper needs. */
export interface ContactAccountDb {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => { maybeSingle: () => Promise<{ data: unknown }> };
    };
  };
}

export interface AttachContactAccountInput {
  workspaceId: string;
  /** The lead_candidate the contact is being attached to. */
  leadCandidateId: string | null | undefined;
  contactLinkedInUrl: string | null;
  /** The contact's stored provenance (company_match, employer identity, …). */
  provenance: unknown;
  /**
   * True when the contact came from a search scoped to this lead's company
   * (e.g. decision-maker discovery), which is itself a company-scoping signal.
   */
  companyScopedSearch?: boolean;
}

export interface AttachContactAccountResult {
  /** Non-null ONLY when the association is verified — safe to write. */
  accountId: string | null;
  decision: AssociationDecision | "no_account";
  confidence: AssociationConfidence;
  provenance: Record<string, unknown> | null;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * Resolve a verified `account_id` for a contact, or null. Best-effort and
 * side-effect-free beyond two reads; callers must never block a contact write on
 * it, and must only set account_id when a non-null id is returned.
 */
export async function resolveVerifiedAccountIdForContact(
  db: ContactAccountDb,
  input: AttachContactAccountInput,
): Promise<AttachContactAccountResult> {
  const none = (decision: AttachContactAccountResult["decision"]): AttachContactAccountResult =>
    ({ accountId: null, decision, confidence: "low", provenance: null });

  if (!input.leadCandidateId) return none("no_account");

  const { data: lcData } = await db.from("lead_candidates")
    .select("id, workspace_id, account_id").eq("id", input.leadCandidateId).maybeSingle();
  const lc = obj(lcData);
  const accountId = typeof lc.account_id === "string" ? lc.account_id : null;
  if (!accountId || lc.workspace_id !== input.workspaceId) return none("no_account");

  const { data: acctData } = await db.from("accounts")
    .select("id, workspace_id, name, domain, linkedin_url, raw").eq("id", accountId).maybeSingle();
  const acct = obj(acctData);
  if (!acct.id || acct.workspace_id !== input.workspaceId) return none("no_account");

  const sig = extractContactSignals(input.provenance);
  const result = resolveContactAccountAssociation({
    workspaceId: input.workspaceId,
    contact: {
      workspace_id: input.workspaceId,
      linkedin_url: input.contactLinkedInUrl,
      employerDomain: sig.employerDomain,
      employerLinkedInUrl: sig.employerLinkedInUrl,
      employerName: sig.employerName,
      providerCompanyId: sig.providerCompanyId,
      currentEmployerVerified: sig.currentEmployerVerified,
      isHistoricalEmployer: sig.isHistoricalEmployer,
      looksLikeProxy: sig.looksLikeProxy,
    },
    candidateAccount: {
      id: acct.id as string,
      workspace_id: acct.workspace_id as string,
      name: (acct.name as string) ?? null,
      domain: (acct.domain as string) ?? null,
      linkedin_url: (acct.linkedin_url as string) ?? null,
      providerCompanyId: (obj(acct.raw).provider_company_id as string) ?? null,
    },
    leadCandidate: { id: lc.id as string, workspace_id: input.workspaceId, account_id: accountId },
    companyScopedSearch: input.companyScopedSearch ?? sig.companyScopedSearch,
  });

  return {
    accountId: result.decision === "verified" ? result.accountId : null,
    decision: result.decision,
    confidence: result.confidence,
    provenance: { decision: result.decision, confidence: result.confidence, reasons: result.reasons, matched: result.matchedSignals, conflicts: result.conflicts },
  };
}
