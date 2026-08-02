// CANONICAL QUALIFIED-LEAD PERSISTENCE — extracted, not reimplemented.
//
// This is the persistence orchestration that lived inline in the run-agent
// request handler, moved out VERBATIM so it can be exercised by a test with an
// isolated client. The SQL, the ordering, the CONTACT invariant and the contact
// writer call are byte-for-byte the same; only the closed-over variables became
// explicit dependencies.
//
// Why bother: the handoff from company-first into persistence was previously
// provable only up to the boundary. A persistence path that has never been run
// in a test is a path whose CONTACT invariant is a comment rather than a fact.
//
// There remains exactly ONE persistence orchestration and ONE contact-enrichment
// path — this module. `run-agent/index.ts` is its only production caller.

import type { CompoundPersistencePlan } from "./runAgentCompoundPersistenceAdapter.ts";
import {
  writeContactWithVerifiedAccount, type ContactPersistenceDb,
} from "./attachContactAccount.ts";

export interface PersistPlanResult {
  ok: boolean;
  accountId: string | null;
  contactId: string | null;
  leadCandidateId: string | null;
  reason?: string;
}

export interface PersistPlanDeps {
  /** The Supabase client. Injected so a test can supply an isolated double. */
  db: {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (c: string, v: unknown) => {
          eq: (c: string, v: unknown) => { maybeSingle: () => Promise<{ data: unknown }> };
        };
      };
      insert: (row: Record<string, unknown>) => {
        select: (cols: string) => { maybeSingle: () => Promise<{ data: unknown }> };
      };
    };
  };
  workspaceId: string;
  planId: string | null;
  /**
   * The contact writer. Defaults to the canonical one — injected only so a test
   * can observe that the handoff happened without a live database.
   */
  writeContact?: typeof writeContactWithVerifiedAccount;
}

/**
 * Build the canonical `persistPlan`.
 *
 * Behaviour preserved exactly from the inline original:
 *   1. resolve-or-insert the account, and ONLY for a verifiable one
 *      (select-then-insert; no upsert constraint dependency)
 *   2. insert the lead_candidate, carrying `contact_eligible`
 *   3. attach the contact through the safe writer, which is also the
 *      contact-enrichment entry point (`companyScopedSearch: true`)
 *
 * THE CONTACT INVARIANT: a CONTACT lead must have a real account_id. Without
 * one `contact_eligible` is false, which is what stops an unverifiable company
 * producing a contactable lead.
 */
export function createPersistPlan(deps: PersistPlanDeps) {
  const supabase = deps.db;
  const workspace_id = deps.workspaceId;
  const plan_id = deps.planId;
  const writeContact = deps.writeContact ?? writeContactWithVerifiedAccount;

  return async function persistPlan(plan: CompoundPersistencePlan): Promise<PersistPlanResult> {
    try {
      // 1) resolve/insert the canonical account (select-then-insert; no upsert
      //    constraint dependency). Only for a verifiable account.
      let accountId: string | null = null;
      if (plan.account && (plan.account.domain || plan.account.linkedinUrl)) {
        const domain = plan.account.domain;
        if (domain) {
          const { data: existing } = await supabase.from("accounts").select("id")
            .eq("workspace_id", workspace_id).eq("domain", domain).maybeSingle();
          accountId = (existing as { id?: string } | null)?.id ?? null;
        }
        if (!accountId) {
          const { data: ins } = await supabase.from("accounts").insert({
            workspace_id, name: plan.account.name, domain: plan.account.domain,
            linkedin_url: plan.account.linkedinUrl, description: plan.account.description,
            source: "compound_company_first",
          }).select("id").maybeSingle();
          accountId = (ins as { id?: string } | null)?.id ?? null;
        }
      }
      // INVARIANT: a CONTACT lead must have a real account_id.
      const contactEligible = plan.verdict === "CONTACT" && !!accountId;
      const { data: lc } = await supabase.from("lead_candidates").insert({
        workspace_id, plan_id: plan_id ?? null, account_id: accountId,
        lead_type: plan.leadCandidate.lead_type, status: "new",
        reason: plan.leadCandidate.reason, next_action: plan.leadCandidate.next_action,
        raw: { ...plan.leadCandidate.raw, contact_eligible: contactEligible },
      }).select("id").maybeSingle();
      const leadCandidateId = (lc as { id?: string } | null)?.id ?? null;
      // 2) attach the contact through the PR #85 safe writer (verified account only).
      if (plan.contact && (plan.contact.name || plan.contact.linkedinUrl) && leadCandidateId) {
        await writeContact({
          db: supabase as unknown as ContactPersistenceDb, mode: "insert",
          identity: {
            workspace_id, full_name: plan.contact.name, title: plan.contact.title,
            linkedin_url: plan.contact.linkedinUrl, email: null,
          },
          rawBase: { source: "compound_company_first", via: "company_first" },
          resolve: {
            workspaceId: workspace_id, leadCandidateId,
            contactLinkedInUrl: plan.contact.linkedinUrl ?? null,
            provenance: { source: "compound_company_first", company_match: contactEligible },
            companyScopedSearch: true,
          },
          linkLeadCandidateId: leadCandidateId,
        } as never);
      }
      return { ok: !!leadCandidateId, accountId, contactId: null, leadCandidateId };
    } catch (e) {
      return { ok: false, accountId: null, contactId: null, leadCandidateId: null,
        reason: (e as Error).message };
    }
  };
}

// ── QUOTA FROM PERSISTED OUTCOMES ──────────────────────────────────────────
//
// The quota the adaptive controller consumes must come from what persistence
// ACTUALLY returned, never from a pre-persistence projection. A plan projected
// as CONTACT that failed to write, or that lost its account and so lost
// `contact_eligible`, is not a lead.

export interface PersistedOutcome {
  /** Stable identity, so the same lead found twice counts once. */
  identity: string;
  verdict: string;
  quotaEligible: boolean;
  result: PersistPlanResult;
}

export interface CompanyFirstQuotaProgress {
  company_first_contact_credit: number;
  legacy_contact_credit: number;
  deduplicated_contact_credit: number;
  contact_pending: number;
  qualified_company: number;
  founder_pending: number;
  rejected: number;
  requested_quota: number;
  remaining_quota: number;
  /** Distinguishes "nothing found" from "work still in flight". */
  pending_work_exists: boolean;
}

/**
 * Compute quota progress from PERSISTED outcomes.
 *
 * `pending_work_exists` is the field that stops a premature fallback: a run with
 * qualified companies awaiting founder or contact work has not failed, and
 * spending on solidcode or a broad job board because of it would be paying to
 * re-answer a question already in flight.
 */
export function computeCompanyFirstQuotaProgress(input: {
  persisted: readonly PersistedOutcome[];
  legacyContactIdentities?: readonly string[];
  requestedQuota: number;
  contactPending?: number;
  qualifiedCompany?: number;
  founderPending?: number;
}): CompanyFirstQuotaProgress {
  const legacy = new Set(input.legacyContactIdentities ?? []);
  const cfContacts = new Set<string>();
  let rejected = 0;

  for (const p of input.persisted) {
    // ONLY a persisted, quota-eligible CONTACT with a real lead_candidate row.
    if (p.verdict === "CONTACT" && p.quotaEligible && p.result.ok && p.result.leadCandidateId) {
      cfContacts.add(p.identity);
    } else if (p.verdict === "REJECT" || p.verdict === "SKIP") {
      rejected++;
    }
  }

  // DEDUPLICATION: the same person reached by both paths is one lead.
  const union = new Set<string>([...legacy, ...cfContacts]);
  const requested = Math.max(0, input.requestedQuota);
  const contactPending = input.contactPending ?? 0;
  const qualified = input.qualifiedCompany ?? 0;
  const founderPending = input.founderPending ?? 0;

  return {
    company_first_contact_credit: cfContacts.size,
    legacy_contact_credit: legacy.size,
    deduplicated_contact_credit: union.size,
    contact_pending: contactPending,
    qualified_company: qualified,
    founder_pending: founderPending,
    rejected,
    requested_quota: requested,
    remaining_quota: Math.max(0, requested - union.size),
    pending_work_exists: contactPending > 0 || founderPending > 0,
  };
}

export type AdaptiveAction =
  | "stop_quota_satisfied"
  | "await_pending_work"
  | "continue_sourcing";

/**
 * The next adaptive action, from persisted progress alone.
 *
 * Order matters: quota is checked first (a satisfied quota ends the run however
 * much else is pending), then pending work (which must not be mistaken for a
 * failed source), and only then more sourcing.
 */
export function nextAdaptiveAction(
  p: CompanyFirstQuotaProgress,
): { action: AdaptiveAction; reason: string } {
  if (p.remaining_quota === 0) {
    return { action: "stop_quota_satisfied", reason: "requested_contact_quota_met" };
  }
  if (p.pending_work_exists) {
    return {
      action: "await_pending_work",
      reason: p.contact_pending > 0
        ? "contact_enrichment_pending_not_a_source_failure"
        : "founder_discovery_pending_not_a_source_failure",
    };
  }
  return { action: "continue_sourcing", reason: "quota_unmet_and_no_pending_work" };
}
