// THE one resolver for "may this contact be attached to this account?"
//
// WHY THIS EXISTS
//   Production evidence (Agentory workspace, 2026-07-21): all 9 canonical
//   contacts have `account_id = null`. Root cause: every contact write path that
//   produced them (decision_maker_discovery in leadActionExecutor, contact
//   discovery in run-agent, the people paths in memoryWriter) builds the contact
//   row WITHOUT an `account_id`, even though the account is known. Contacts were
//   attached only to a plan-scoped `lead_candidate` (via `lead_candidates.
//   contact_id`), never to the durable account.
//
//   A contact must be attached to `workspace_id + account_id` — but ONLY when the
//   association is genuinely verified. A wrong or guessed employer is worse than
//   a null: it would surface the wrong buyer on the wrong company. So this
//   resolver attaches automatically only on a STRONG current-employer identity
//   signal, defers on weak/name-only evidence, and rejects conflicts. It never
//   silently moves a contact between accounts.
//
// Pure — no DB, no network, no model.

export type AssociationDecision =
  | "verified"
  | "needs_review"
  | "rejected"
  | "reassignment_required";

export type AssociationConfidence = "high" | "medium" | "low";

export interface AssociationAccount {
  id: string;
  workspace_id: string;
  name?: string | null;
  domain?: string | null;
  linkedin_url?: string | null;
  /** Provider company id if the account was sourced from a provider. */
  providerCompanyId?: string | null;
}

export interface AssociationContact {
  id?: string | null;
  workspace_id: string;
  /** Existing association, if the contact already has one. */
  account_id?: string | null;
  linkedin_url?: string | null;
  /** CURRENT-employer identity signals (never historical). */
  employerDomain?: string | null;
  employerLinkedInUrl?: string | null;
  employerName?: string | null;
  providerCompanyId?: string | null;
  /** True only when the provider independently verified current employment. */
  currentEmployerVerified?: boolean;
  /** True when the target account is a PAST employer of this contact. */
  isHistoricalEmployer?: boolean;
  /** True when the person looks like a recruiter/staffing/consultant proxy. */
  looksLikeProxy?: boolean;
}

export interface AssociationLeadCandidate {
  id?: string | null;
  workspace_id: string;
  account_id?: string | null;
}

export interface ResolveContactAccountInput {
  workspaceId: string;
  contact: AssociationContact;
  candidateAccount: AssociationAccount;
  leadCandidate?: AssociationLeadCandidate | null;
  /** The contact came from a company-scoped people search for this account. */
  companyScopedSearch?: boolean;
  now?: string;
}

export interface AssociationMatchedSignals {
  exactCompanyDomain: boolean;
  exactCompanyLinkedIn: boolean;
  exactProviderCompanyId: boolean;
  normalizedEmployerName: boolean;
  leadCandidateAccountMatch: boolean;
  currentEmployerVerified: boolean;
}

export interface AssociationResult {
  decision: AssociationDecision;
  /** Non-null ONLY for `verified`; null for review/rejected/reassignment. */
  accountId: string | null;
  confidence: AssociationConfidence;
  reasons: string[];
  matchedSignals: AssociationMatchedSignals;
  conflicts: string[];
  verifiedAt: string | null;
  provenance: Record<string, unknown>;
}

// ------------------------------------------------------------- primitives -----

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function normName(v: unknown): string | null {
  const s = str(v);
  return s ? (s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() || null) : null;
}
function normDomain(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  let h = s.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^www\./, "");
  h = h.split("/")[0].split("?")[0].split("#")[0].replace(/\.$/, "").replace(/:\d+$/, "");
  return h || null;
}

// --------------------------------------------------------------- resolver -----

export function resolveContactAccountAssociation(input: ResolveContactAccountInput): AssociationResult {
  const { workspaceId, contact, candidateAccount, leadCandidate } = input;
  const now = input.now ?? new Date().toISOString();
  const reasons: string[] = [];
  const conflicts: string[] = [];

  const empty: AssociationMatchedSignals = {
    exactCompanyDomain: false, exactCompanyLinkedIn: false, exactProviderCompanyId: false,
    normalizedEmployerName: false, leadCandidateAccountMatch: false, currentEmployerVerified: false,
  };

  const provenanceBase = () => ({
    contact_id: contact.id ?? null,
    account_id: candidateAccount.id,
    lead_candidate_id: leadCandidate?.id ?? null,
    contact_linkedin_url: str(contact.linkedin_url),
    employer_domain: normDomain(contact.employerDomain),
    employer_linkedin_url: str(contact.employerLinkedInUrl),
    employer_name: str(contact.employerName),
    provider_company_id: str(contact.providerCompanyId),
    company_scoped_search: !!input.companyScopedSearch,
    resolved_at: now,
  });

  const reject = (reason: string): AssociationResult => {
    conflicts.push(reason);
    return { decision: "rejected", accountId: null, confidence: "low", reasons: [reason], matchedSignals: empty, conflicts, verifiedAt: null, provenance: { ...provenanceBase(), decision: "rejected", reasons: [reason] } };
  };

  // ---- hard tenancy guards (never attach across workspaces) ------------------
  if (contact.workspace_id !== workspaceId) return reject("contact_workspace_mismatch");
  if (candidateAccount.workspace_id !== workspaceId) return reject("account_workspace_mismatch");
  if (leadCandidate && leadCandidate.workspace_id !== workspaceId) return reject("lead_candidate_workspace_mismatch");
  if (leadCandidate && leadCandidate.account_id && leadCandidate.account_id !== candidateAccount.id) {
    return reject("lead_candidate_account_mismatch");
  }

  // ---- proxy / non-employee → never an account contact -----------------------
  if (contact.looksLikeProxy) return reject("contact_is_proxy_or_non_employee");

  // ---- compute identity signals ----------------------------------------------
  const cDomain = normDomain(contact.employerDomain);
  const aDomain = normDomain(candidateAccount.domain);
  const cLinkedIn = normDomain(contact.employerLinkedInUrl);
  const aLinkedIn = normDomain(candidateAccount.linkedin_url);
  const cProvId = str(contact.providerCompanyId);
  const aProvId = str(candidateAccount.providerCompanyId);
  const cName = normName(contact.employerName);
  const aName = normName(candidateAccount.name);
  const verified = contact.currentEmployerVerified === true;

  const signals: AssociationMatchedSignals = {
    exactCompanyDomain: !!(cDomain && aDomain && cDomain === aDomain),
    exactCompanyLinkedIn: !!(cLinkedIn && aLinkedIn && cLinkedIn === aLinkedIn),
    exactProviderCompanyId: !!(cProvId && aProvId && cProvId === aProvId),
    normalizedEmployerName: !!(cName && aName && cName === aName),
    leadCandidateAccountMatch: !!(leadCandidate?.account_id && leadCandidate.account_id === candidateAccount.id),
    currentEmployerVerified: verified,
  };

  // ---- strong current-employer CONFLICTS (wrong company) ---------------------
  if (cProvId && aProvId && cProvId !== aProvId) conflicts.push("provider_company_id_conflict");
  if (cDomain && aDomain && cDomain !== aDomain) conflicts.push("employer_domain_conflict");
  if (cLinkedIn && aLinkedIn && cLinkedIn !== aLinkedIn) conflicts.push("employer_linkedin_conflict");

  // A VERIFIED current employer that is a different company is a hard reject.
  if (conflicts.length > 0 && verified) return reject(conflicts[0]);

  // The target account is a PAST employer → never attach as current.
  if (contact.isHistoricalEmployer) {
    reasons.push("target_account_is_historical_employer");
    return { decision: "needs_review", accountId: null, confidence: "low", reasons, matchedSignals: signals, conflicts, verifiedAt: null, provenance: { ...provenanceBase(), decision: "needs_review", reasons } };
  }

  // A strong identity match with a same-domain/linkedin/provider signal.
  const hasStrong =
    signals.exactProviderCompanyId ||
    signals.exactCompanyDomain ||
    signals.exactCompanyLinkedIn ||
    (input.companyScopedSearch === true && verified) ||
    (signals.leadCandidateAccountMatch && verified);

  // ---- existing association handling (§6 reassignment safety) -----------------
  if (str(contact.account_id)) {
    if (contact.account_id === candidateAccount.id) {
      reasons.push("existing_association_confirmed");
      return { decision: "verified", accountId: candidateAccount.id, confidence: hasStrong ? "high" : "medium", reasons, matchedSignals: signals, conflicts, verifiedAt: now, provenance: { ...provenanceBase(), decision: "verified", reasons } };
    }
    // Different existing account. Only a STRONG, verified new-employer signal may
    // request a reassignment — and even then never silently.
    if (hasStrong && verified) {
      reasons.push("strong_new_employer_evidence_vs_existing_account");
      return { decision: "reassignment_required", accountId: null, confidence: "high", reasons, matchedSignals: signals, conflicts, verifiedAt: null, provenance: { ...provenanceBase(), decision: "reassignment_required", existing_account_id: contact.account_id, reasons } };
    }
    // Weak/conflicting evidence never overwrites the current association.
    reasons.push("existing_association_preserved_weak_new_evidence");
    return { decision: "verified", accountId: contact.account_id!, confidence: "low", reasons, matchedSignals: signals, conflicts, verifiedAt: null, provenance: { ...provenanceBase(), decision: "verified", preserved_existing: true, reasons } };
  }

  // ---- fresh association decision ---------------------------------------------
  if (hasStrong) {
    if (signals.exactProviderCompanyId) reasons.push("provider_company_id_match");
    if (signals.exactCompanyDomain) reasons.push("employer_domain_match");
    if (signals.exactCompanyLinkedIn) reasons.push("employer_linkedin_match");
    if (input.companyScopedSearch && verified) reasons.push("company_scoped_search_verified_employer");
    if (signals.leadCandidateAccountMatch && verified) reasons.push("lead_candidate_account_verified");

    const strongCount = [signals.exactProviderCompanyId, signals.exactCompanyDomain, signals.exactCompanyLinkedIn].filter(Boolean).length;
    const confidence: AssociationConfidence = strongCount >= 2 || (strongCount >= 1 && verified) ? "high" : "medium";
    return { decision: "verified", accountId: candidateAccount.id, confidence, reasons, matchedSignals: signals, conflicts, verifiedAt: now, provenance: { ...provenanceBase(), decision: "verified", reasons } };
  }

  // Name-only, missing employer, or unverified single-source → needs review.
  if (signals.normalizedEmployerName) reasons.push("employer_name_match_only");
  else reasons.push("no_strong_current_employer_signal");
  return { decision: "needs_review", accountId: null, confidence: "low", reasons, matchedSignals: signals, conflicts, verifiedAt: null, provenance: { ...provenanceBase(), decision: "needs_review", reasons } };
}
