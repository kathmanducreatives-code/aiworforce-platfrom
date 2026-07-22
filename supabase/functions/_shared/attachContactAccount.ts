// Persistence glue for contact → account association.
//
// TWO GUARANTEES the pre-merge review demanded:
//
//   1. A contact write NEVER carries `account_id` in its insert/upsert payload,
//      so it is IMPOSSIBLE for a rediscovery to null an existing verified
//      association through conflict-update or missing-column-default behaviour.
//      Identity is written first; `account_id` is only ever touched by a SEPARATE
//      guarded UPDATE that runs solely when the resolver decision is `verified`.
//
//   2. That guarded update sets `account_id` only where it is currently null OR
//      already equals the same account, so it can neither overwrite a different
//      existing association (no silent reassignment) nor write null.
//
// The resolver itself is pure (contactAccountAssociation.ts). This module adds
// the two reads it needs (lead_candidate → account) and the two writes.

import {
  resolveContactAccountAssociation,
  type AssociationConfidence,
  type AssociationDecision,
} from "./contactAccountAssociation.ts";
import { extractContactSignals } from "./contactAccountBackfillPlanner.ts";

// ---- the narrow DB surface (real Supabase client is structurally compatible) --

interface Thenable<T> { then: (cb: (v: T) => unknown) => unknown }
interface MaybeSingle<T> { maybeSingle: () => Promise<{ data: T | null }> }
interface SelectChain<T> { select: (cols: string) => MaybeSingle<T> }

export interface ContactPersistenceDb {
  from: (table: string) => {
    select: (cols: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: unknown }> } };
    upsert: (row: Record<string, unknown>, opts: { onConflict: string }) => SelectChain<{ id: string }>;
    insert: (row: Record<string, unknown>) => SelectChain<{ id: string }>;
    update: (row: Record<string, unknown>) => {
      eq: (c: string, v: string) => (Thenable<{ error: unknown }> & { or: (f: string) => Thenable<{ error: unknown }> });
    };
  };
}

/** Read-only slice used by the resolver step (supports chained `.eq`). */
export interface ContactAccountDb {
  from: (table: string) => {
    select: (cols: string) => EqChain;
  };
}
interface EqChain {
  eq: (col: string, val: string) => EqChain;
  maybeSingle: () => Promise<{ data: unknown }>;
}

// ---------------------------------------------------------------- resolve ------

export interface ResolveVerifiedAccountInput {
  workspaceId: string;
  leadCandidateId: string | null | undefined;
  contactLinkedInUrl: string | null;
  provenance: unknown;
  companyScopedSearch?: boolean;
  /** The contact's CURRENT account_id, if it already exists — lets the resolver
   *  surface `reassignment_required` instead of silently proposing a move. */
  existingContactAccountId?: string | null;
}
export interface ResolveVerifiedAccountResult {
  accountId: string | null;
  decision: AssociationDecision | "no_account";
  confidence: AssociationConfidence;
  provenance: Record<string, unknown> | null;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Resolve a VERIFIED account id (or null) for a contact from its lead's account. */
export async function resolveVerifiedAccountIdForContact(
  db: ContactAccountDb,
  input: ResolveVerifiedAccountInput,
): Promise<ResolveVerifiedAccountResult> {
  const none = (decision: ResolveVerifiedAccountResult["decision"]): ResolveVerifiedAccountResult =>
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
      workspace_id: input.workspaceId, linkedin_url: input.contactLinkedInUrl,
      account_id: input.existingContactAccountId ?? null,
      employerDomain: sig.employerDomain, employerLinkedInUrl: sig.employerLinkedInUrl,
      employerName: sig.employerName, providerCompanyId: sig.providerCompanyId,
      currentEmployerVerified: sig.currentEmployerVerified, isHistoricalEmployer: sig.isHistoricalEmployer,
      looksLikeProxy: sig.looksLikeProxy,
    },
    candidateAccount: {
      id: acct.id as string, workspace_id: acct.workspace_id as string,
      name: (acct.name as string) ?? null, domain: (acct.domain as string) ?? null,
      linkedin_url: (acct.linkedin_url as string) ?? null,
      providerCompanyId: (obj(acct.raw).provider_company_id as string) ?? null,
    },
    leadCandidate: { id: lc.id as string, workspace_id: input.workspaceId, account_id: accountId },
    companyScopedSearch: input.companyScopedSearch ?? sig.companyScopedSearch,
  });

  return {
    accountId: result.decision === "verified" ? result.accountId : null,
    decision: result.decision, confidence: result.confidence,
    provenance: { decision: result.decision, confidence: result.confidence, reasons: result.reasons, matched: result.matchedSignals, conflicts: result.conflicts },
  };
}

// ---------------------------------------------------------------- write --------

export interface WriteContactInput {
  db: ContactPersistenceDb;
  /** How to write the IDENTITY row (never includes account_id). */
  mode: "upsert" | "insert";
  onConflict?: string;
  /** Identity + contactable fields ONLY. `account_id` here is ignored/stripped. */
  identity: Record<string, unknown>;
  /** Base of the `raw` jsonb; association provenance is merged in. */
  rawBase: Record<string, unknown>;
  resolve: ResolveVerifiedAccountInput;
  /** When set, `lead_candidates.contact_id` is linked to the written contact. */
  linkLeadCandidateId?: string | null;
}

export interface WriteContactResult {
  contactId: string | null;
  decision: AssociationDecision | "no_account";
  accountIdWritten: string | null;
}

/**
 * Persist a contact and, ONLY when verified, attach its account.
 *
 * Step 1 upserts/inserts identity WITHOUT account_id.
 * Step 2 runs a guarded UPDATE that sets account_id only when the resolver says
 *        `verified` AND the row is currently null or already the same account.
 */
export async function writeContactWithVerifiedAccount(input: WriteContactInput): Promise<WriteContactResult> {
  const { db } = input;

  // Best-effort pre-read of the EXISTING contact's account_id (upsert path), so
  // the resolver can return `reassignment_required` rather than proposing a
  // silent move. The guarded update below is the hard guarantee regardless.
  let existingContactAccountId: string | null = input.resolve.existingContactAccountId ?? null;
  if (!existingContactAccountId && input.mode === "upsert" && input.resolve.contactLinkedInUrl) {
    try {
      const { data } = await (db as unknown as ContactAccountDb).from("contacts")
        .select("id, account_id").eq("workspace_id", input.resolve.workspaceId)
        .eq("linkedin_url", input.resolve.contactLinkedInUrl).maybeSingle();
      const ex = obj(data);
      existingContactAccountId = typeof ex.account_id === "string" ? ex.account_id : null;
    } catch (_e) { /* best-effort */ }
  }

  const resolve = await resolveVerifiedAccountIdForContact(db as unknown as ContactAccountDb, { ...input.resolve, existingContactAccountId });

  // Identity payload — account_id is intentionally absent so no write path can
  // ever null an existing association.
  const identity = { ...input.identity };
  delete (identity as Record<string, unknown>).account_id;
  const row: Record<string, unknown> = {
    ...identity,
    raw: { ...input.rawBase, account_association: resolve.provenance },
  };

  const table = db.from("contacts");
  const { data } = input.mode === "upsert"
    ? await table.upsert(row, { onConflict: input.onConflict ?? "workspace_id,linkedin_url" }).select("id").maybeSingle()
    : await table.insert(row).select("id").maybeSingle();
  const contactId = data?.id ?? null;
  if (!contactId) return { contactId: null, decision: resolve.decision, accountIdWritten: null };

  let accountIdWritten: string | null = null;
  if (resolve.accountId) {
    // Guarded: only where currently null OR already the same account. Never nulls,
    // never silently reassigns a contact from account A to account B.
    await db.from("contacts").update({ account_id: resolve.accountId })
      .eq("id", contactId).or(`account_id.is.null,account_id.eq.${resolve.accountId}`);
    accountIdWritten = resolve.accountId;
  }

  if (input.linkLeadCandidateId) {
    await db.from("lead_candidates").update({ contact_id: contactId }).eq("id", input.linkLeadCandidateId);
  }

  return { contactId, decision: resolve.decision, accountIdWritten };
}
