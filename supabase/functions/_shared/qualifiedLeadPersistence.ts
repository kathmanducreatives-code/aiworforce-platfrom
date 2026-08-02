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


// ── LEGACY CONTACT IDENTITIES ──────────────────────────────────────────────
//
// The legacy company-first controller returns one item per candidate. Only a
// PERSISTED, quota-eligible CONTACT with a real lead_candidate row is a lead, so
// only those contribute an identity.
//
// Identity strength order matters: two paths finding the same person must
// collide, and two different people must not. A display name or a vanity URL
// does neither reliably, so neither is ever used alone.

export type IdentityStrategy =
  | "canonical_lead_candidate_id"
  | "stable_profile_id"
  | "person_and_company_identity"
  | "none";

export interface LegacyLeadItem {
  verdict?: string | null;
  quotaEligible?: boolean | null;
  leadCandidateId?: string | null;
  accountId?: string | null;
  leadKey?: string | null;
  personProfileUrl?: string | null;
  person?: string | null;
  company?: string | null;
}

export interface CollectedIdentities {
  identities: string[];
  strategy: IdentityStrategy;
  /** Counted but unusable — a CONTACT we cannot identify safely. */
  unidentifiable: number;
}

/**
 * Strongest available stable identity for one persisted lead.
 *
 * Returns null when nothing stable exists. A CONTACT with no stable identity is
 * NOT given a name-based one: a false collision silently deletes a real lead
 * from the quota, and a false split silently double-counts one.
 */
export function leadIdentity(item: LegacyLeadItem): { id: string; strategy: IdentityStrategy } | null {
  if (item.leadCandidateId) {
    return { id: `lc:${item.leadCandidateId}`, strategy: "canonical_lead_candidate_id" };
  }
  // `leadKey` is the controller's own stable person+company key.
  if (item.leadKey) {
    return { id: `lk:${item.leadKey}`, strategy: "stable_profile_id" };
  }
  // Person + CANONICAL COMPANY identity. The account id is canonical; a company
  // NAME alone would collide across the many companies that share one.
  if (item.person && item.accountId) {
    return { id: `pc:${item.accountId}:${item.person}`, strategy: "person_and_company_identity" };
  }
  return null;
}

/** Collect identities from persisted, quota-eligible legacy CONTACT items only. */
export function collectLegacyContactIdentities(
  items: readonly LegacyLeadItem[],
): CollectedIdentities {
  const identities: string[] = [];
  let strategy: IdentityStrategy = "none";
  let unidentifiable = 0;
  const rank: Record<IdentityStrategy, number> = {
    canonical_lead_candidate_id: 3, stable_profile_id: 2,
    person_and_company_identity: 1, none: 0,
  };
  for (const it of items) {
    // WATCH, NEEDS_REVIEW, REJECT, SKIP, contact_pending and anything that did
    // not persist are excluded here, not filtered downstream.
    if (it.verdict !== "CONTACT") continue;
    if (it.quotaEligible !== true) continue;
    if (!it.leadCandidateId) { unidentifiable++; continue; }
    const id = leadIdentity(it);
    if (!id) { unidentifiable++; continue; }
    if (!identities.includes(id.id)) identities.push(id.id);
    if (rank[id.strategy] > rank[strategy]) strategy = id.strategy;
  }
  return { identities, strategy, unidentifiable };
}

/** Company-first identities, from the same persisted-outcome rule. */
export function collectCompanyFirstContactIdentities(
  outcomes: readonly PersistedOutcome[],
): CollectedIdentities {
  const identities: string[] = [];
  let unidentifiable = 0;
  for (const o of outcomes) {
    if (o.verdict !== "CONTACT" || !o.quotaEligible) continue;
    if (!o.result.ok || !o.result.leadCandidateId) { unidentifiable++; continue; }
    const id = `lc:${o.result.leadCandidateId}`;
    if (!identities.includes(id)) identities.push(id);
  }
  return { identities, strategy: "canonical_lead_candidate_id", unidentifiable };
}

/** A bounded, non-reversible reference. Diagnostics never carry raw identities. */
export function identityDigest(id: string): string {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export interface CombinedQuotaDiagnostics {
  legacy_contact_count_raw: number;
  company_first_contact_count_raw: number;
  duplicate_contact_count: number;
  deduplicated_contact_count: number;
  remaining_quota: number;
  identity_strategy: IdentityStrategy;
  unidentifiable_contacts: number;
  /** Digests only — never a raw lead, contact or profile identifier. */
  identity_digests: string[];
}

/** Combine both paths' identities into one deduplicated quota view. */
export function combineContactIdentities(
  legacy: CollectedIdentities, companyFirst: CollectedIdentities, requestedQuota: number,
): CombinedQuotaDiagnostics {
  const union = new Set([...legacy.identities, ...companyFirst.identities]);
  const dupes = legacy.identities.filter((x) => companyFirst.identities.includes(x)).length;
  const rank: Record<IdentityStrategy, number> = {
    canonical_lead_candidate_id: 3, stable_profile_id: 2,
    person_and_company_identity: 1, none: 0,
  };
  return {
    legacy_contact_count_raw: legacy.identities.length,
    company_first_contact_count_raw: companyFirst.identities.length,
    duplicate_contact_count: dupes,
    deduplicated_contact_count: union.size,
    remaining_quota: Math.max(0, requestedQuota - union.size),
    identity_strategy: rank[legacy.strategy] >= rank[companyFirst.strategy]
      ? legacy.strategy : companyFirst.strategy,
    unidentifiable_contacts: legacy.unidentifiable + companyFirst.unidentifiable,
    identity_digests: [...union].map(identityDigest),
  };
}


// ── RESUME: PRIOR CONTACT QUOTA FROM CANONICAL PERSISTED STATE ─────────────
//
// A resumed task must know what it already paid for BEFORE it spends again.
// Previously this came from a request field no caller sent, so a resume could
// re-source leads it had already produced.
//
// The source of truth is the `lead_candidates` table the canonical persistPlan
// writes. `raw.contact_eligible` is set there ONLY when the verdict is CONTACT
// AND a real account id exists — which is precisely "CONTACT + quota_eligible +
// successfully persisted". So the flag already encodes the rule; this reads it
// rather than restating it.
//
// A caller-supplied list is never authoritative. It can only ever narrow.

export interface PriorContactScope {
  workspaceId: string;
  planId: string | null;
  taskId: string;
}

export interface PriorContactState {
  identities: string[];
  /** Rows that matched the scope but could not be identified stably. */
  unidentifiable: number;
  /** Digests only — diagnostics never carry a raw lead or contact id. */
  identity_digests: string[];
  scanned_rows: number;
  source: "canonical_persisted_state";
  error: string | null;
}

/** A minimal list-query surface. The real Supabase builder satisfies it. */
export interface PriorContactDb {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (c: string, v: unknown) => {
        eq: (c: string, v: unknown) => PromiseLike<{ data: unknown; error?: unknown }>;
      };
    };
  };
}

const EMPTY_PRIOR: PriorContactState = {
  identities: [], unidentifiable: 0, identity_digests: [],
  scanned_rows: 0, source: "canonical_persisted_state", error: null,
};

/**
 * Load CONTACT identities already persisted for this task.
 *
 * Scope is enforced twice: the query filters workspace and plan, and the row
 * filter re-checks `raw.task_id`. A row from another workspace, plan or task
 * contributes nothing — quota is per-mission, and a leak across scopes would let
 * one task's work silently satisfy another's.
 *
 * Never throws: a lookup failure yields zero prior credit, which is the SAFE
 * direction (the task sources again rather than stopping on a phantom quota).
 */
export async function loadPriorContactIdentities(
  db: PriorContactDb, scope: PriorContactScope,
): Promise<PriorContactState> {
  try {
    const res = await db.from("lead_candidates")
      .select("id, account_id, lead_type, plan_id, raw")
      .eq("workspace_id", scope.workspaceId)
      .eq("plan_id", scope.planId);
    const rows = Array.isArray((res as { data?: unknown }).data)
      ? (res as { data: Record<string, unknown>[] }).data : [];

    const identities: string[] = [];
    let unidentifiable = 0;
    for (const r of rows) {
      const raw = (r.raw ?? {}) as Record<string, unknown>;
      // CONTACT + quota_eligible + persisted, all encoded by this one flag.
      if (raw.contact_eligible !== true) continue;
      // Scope re-check: the plan filter alone would let a sibling task through.
      if (String(raw.task_id ?? "") !== scope.taskId) continue;
      // Person leads only. An account-level record is progress, never a lead.
      if (r.lead_type !== "person") continue;
      const id = leadIdentity({
        verdict: "CONTACT", quotaEligible: true,
        leadCandidateId: typeof r.id === "string" ? r.id : null,
        accountId: typeof r.account_id === "string" ? r.account_id : null,
        person: typeof (raw.person as Record<string, unknown>)?.source_profile_id === "string"
          ? String((raw.person as Record<string, unknown>).source_profile_id)
          : null,
      });
      if (!id) { unidentifiable++; continue; }
      if (!identities.includes(id.id)) identities.push(id.id);
    }
    return {
      identities, unidentifiable,
      identity_digests: identities.map(identityDigest),
      scanned_rows: rows.length,
      source: "canonical_persisted_state", error: null,
    };
  } catch (e) {
    // Fail toward sourcing again, never toward a phantom satisfied quota.
    return { ...EMPTY_PRIOR, error: (e as Error).message };
  }
}

/**
 * Reconcile persisted state with any caller-supplied hint.
 *
 * Persisted state WINS. A request list may only narrow the set, never extend it,
 * so a stale or hostile body cannot inflate quota and stop a task early.
 */
export function reconcilePriorIdentities(
  persisted: PriorContactState, requestHint?: readonly string[] | null,
): { identities: string[]; ignored_request_identities: number } {
  if (!requestHint || requestHint.length === 0) {
    return { identities: persisted.identities, ignored_request_identities: 0 };
  }
  const known = new Set(persisted.identities);
  const ignored = requestHint.filter((x) => !known.has(x)).length;
  return { identities: persisted.identities, ignored_request_identities: ignored };
}
