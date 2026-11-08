// PERSISTING PIPELINE LEADS — idempotent per company, never a second row for one company
// (MRLE Phase 0, audit 2026-11-07 X3 / X8).
//
// The previous `persist()` inserted sequentially with no lookups beyond an account's domain:
//   * a second run for the same company inserted a second `lead_candidates` row;
//   * `accounts (workspace_id, name)` is UNIQUE, so a same-named company with another domain
//     threw mid-loop — after the provider spend, leaving earlier rows written;
//   * `contacts (workspace_id, linkedin_url)` is UNIQUE, so a person seen before threw too.
//
// Now, per row:
//   account  by canonical domain; else by exact name when that account has no domain or the
//            same one (it gains the domain); else inserted — under a disambiguated name when
//            the name belongs to a different company ("Acme (acme.io)")
//   contact  by LinkedIn URL when there is one (reused, attribution added); else inserted
//   lead     the existing Lead (history match) or this workspace's pipeline lead for the
//            account keeps its id, status and stage — only `raw.agentory_pipeline` is replaced;
//            otherwise inserted. A unique-violation on insert (a concurrent writer, or the held
//            index 20261108120000) is answered by reading the winner and updating it.
//
// One row's failure never stops the others: each result is reported. With the held migration
// applied, `transactional` writes each row in ONE database transaction (RPC
// `lead_pipeline_persist_lead`). The store is injected, so this is testable offline.

import type { PipelineRow } from "./projection.ts";
import { canonicalDomain } from "./identity.ts";

export type Inserted = { id: string } | { conflict: true };

export interface LeadStore {
  findAccountByDomain(workspaceId: string, domain: string): Promise<{ id: string; raw: Record<string, unknown> | null } | null>;
  findAccountByName(workspaceId: string, name: string): Promise<{ id: string; domain: string | null; raw: Record<string, unknown> | null } | null>;
  insertAccount(row: Record<string, unknown>): Promise<Inserted>;
  updateAccount(id: string, patch: Record<string, unknown>): Promise<void>;
  findContactByLinkedin(workspaceId: string, linkedinUrl: string): Promise<{ id: string; raw: Record<string, unknown> | null } | null>;
  insertContact(row: Record<string, unknown>): Promise<Inserted>;
  updateContact(id: string, patch: Record<string, unknown>): Promise<void>;
  findLeadById(workspaceId: string, id: string): Promise<{ id: string; raw: Record<string, unknown> | null } | null>;
  findPipelineLeadForAccount(workspaceId: string, accountId: string, leadType: string): Promise<{ id: string; raw: Record<string, unknown> | null } | null>;
  insertLead(row: Record<string, unknown>): Promise<Inserted>;
  updateLead(id: string, patch: Record<string, unknown>): Promise<void>;
  /** One transaction per row (held migration). Absent = the idempotent step-by-step path. */
  persistLeadTx?(row: PipelineRow): Promise<{ accountId: string; contactId: string | null; leadId: string; created: boolean }>;
}

export interface PersistResult {
  written: number; updated: number; failed: number;
  rows: { name: string | null; accountId: string | null; leadId: string | null; action: "inserted" | "updated" | "failed"; error?: string }[];
}

export async function persistRows(store: LeadStore, rows: readonly PipelineRow[], now: () => Date = () => new Date()): Promise<PersistResult> {
  const out: PersistResult = { written: 0, updated: 0, failed: 0, rows: [] };
  for (const r of rows) {
    try {
      if (store.persistLeadTx) {
        const t = await store.persistLeadTx(r);
        out[t.created ? "written" : "updated"]++;
        out.rows.push({ name: r.account.name, accountId: t.accountId, leadId: t.leadId, action: t.created ? "inserted" : "updated" });
        continue;
      }
      const at = now().toISOString();
      const pipelineRaw = { agentory_pipeline: r.lead_candidate.raw.agentory_pipeline };
      const accountId = await upsertAccount(store, r, at);
      const contactId = r.contact ? await upsertContact(store, r, accountId, at) : null;
      const existing = r.existingLeadId ? await store.findLeadById(r.lead_candidate.workspace_id, r.existingLeadId)
        : await store.findPipelineLeadForAccount(r.lead_candidate.workspace_id, accountId, r.lead_candidate.lead_type);
      if (existing) {
        // An existing Lead keeps its id, status and stage: only the pipeline's own attribution is replaced.
        await store.updateLead(existing.id, { raw: { ...(existing.raw ?? {}), ...pipelineRaw }, updated_at: at });
        out.updated++; out.rows.push({ name: r.account.name, accountId, leadId: existing.id, action: "updated" });
        continue;
      }
      const ins = await store.insertLead({ ...r.lead_candidate, account_id: accountId, contact_id: contactId });
      if ("conflict" in ins) {
        const winner = await store.findPipelineLeadForAccount(r.lead_candidate.workspace_id, accountId, r.lead_candidate.lead_type);
        if (!winner) throw new Error("lead insert conflicted and no existing lead was found");
        await store.updateLead(winner.id, { raw: { ...(winner.raw ?? {}), ...pipelineRaw }, updated_at: at });
        out.updated++; out.rows.push({ name: r.account.name, accountId, leadId: winner.id, action: "updated" });
        continue;
      }
      out.written++; out.rows.push({ name: r.account.name, accountId, leadId: ins.id, action: "inserted" });
    } catch (e) {
      out.failed++; out.rows.push({ name: r.account.name, accountId: null, leadId: null, action: "failed", error: String((e as Error)?.message ?? e).slice(0, 200) });
    }
  }
  return out;
}

async function upsertAccount(store: LeadStore, r: PipelineRow, at: string): Promise<string> {
  const ws = r.account.workspace_id;
  const domain = canonicalDomain(r.account.domain);
  const attribution = { agentory_pipeline: r.account.raw.agentory_pipeline };
  if (domain) {
    const byDomain = await store.findAccountByDomain(ws, domain) ?? (r.account.domain && r.account.domain !== domain ? await store.findAccountByDomain(ws, r.account.domain) : null);
    if (byDomain) { await store.updateAccount(byDomain.id, { raw: { ...(byDomain.raw ?? {}), ...attribution }, updated_at: at }); return byDomain.id; }
  }
  const byName = r.account.name ? await store.findAccountByName(ws, r.account.name) : null;
  // THE NAME IS NOT AN IDENTITY: reuse a same-named account only when it has no domain or the same one.
  if (byName && (!byName.domain || !domain || canonicalDomain(byName.domain) === domain)) {
    await store.updateAccount(byName.id, { raw: { ...(byName.raw ?? {}), ...attribution }, ...(domain && !byName.domain ? { domain } : {}), updated_at: at });
    return byName.id;
  }
  const name = byName ? `${r.account.name} (${domain ?? "unknown domain"})` : r.account.name;
  const ins = await store.insertAccount({ ...r.account, name, ...(domain ? { domain } : {}) });
  if ("conflict" in ins) {
    // A concurrent writer created it: read the winner by the same keys.
    const again = (domain ? await store.findAccountByDomain(ws, domain) : null) ?? (name ? await store.findAccountByName(ws, name) : null);
    if (!again) throw new Error("account insert conflicted and no existing account was found");
    return again.id;
  }
  return ins.id;
}

async function upsertContact(store: LeadStore, r: PipelineRow, accountId: string, at: string): Promise<string> {
  const c = r.contact!;
  const ws = r.account.workspace_id;
  const li = typeof c.linkedin_url === "string" && c.linkedin_url.trim() ? c.linkedin_url.trim() : null;
  if (li) {
    const hit = await store.findContactByLinkedin(ws, li);
    if (hit) { await store.updateContact(hit.id, { raw: { ...(hit.raw ?? {}), ...((c.raw ?? {}) as Record<string, unknown>) }, updated_at: at }); return hit.id; }
  }
  const ins = await store.insertContact({ ...c, account_id: accountId });
  if ("conflict" in ins) {
    const again = li ? await store.findContactByLinkedin(ws, li) : null;
    if (!again) throw new Error("contact insert conflicted and no existing contact was found");
    return again.id;
  }
  return ins.id;
}

/** The Supabase implementation of the store (service role, this workspace's rows only). */
// deno-lint-ignore no-explicit-any
export function supabaseLeadStore(admin: any, opts: { transactional?: boolean } = {}): LeadStore {
  const one = async (q: PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data as never;
  };
  const insert = async (table: string, row: Record<string, unknown>): Promise<Inserted> => {
    const { data, error } = await admin.from(table).insert(row).select("id").single();
    if (error) { if ((error as { code?: string }).code === "23505") return { conflict: true }; throw new Error(`${table} insert: ${error.message}`); }
    return { id: data.id };
  };
  const update = async (table: string, id: string, patch: Record<string, unknown>) => { await one(admin.from(table).update(patch).eq("id", id)); };
  return {
    findAccountByDomain: (ws, d) => one(admin.from("accounts").select("id, raw").eq("workspace_id", ws).eq("domain", d).limit(1).maybeSingle()),
    findAccountByName: (ws, n) => one(admin.from("accounts").select("id, domain, raw").eq("workspace_id", ws).eq("name", n).limit(1).maybeSingle()),
    insertAccount: (row) => insert("accounts", row),
    updateAccount: (id, p) => update("accounts", id, p),
    findContactByLinkedin: (ws, u) => one(admin.from("contacts").select("id, raw").eq("workspace_id", ws).eq("linkedin_url", u).limit(1).maybeSingle()),
    insertContact: (row) => insert("contacts", row),
    updateContact: (id, p) => update("contacts", id, p),
    findLeadById: (ws, id) => one(admin.from("lead_candidates").select("id, raw").eq("workspace_id", ws).eq("id", id).maybeSingle()),
    findPipelineLeadForAccount: (ws, a, t) => one(admin.from("lead_candidates").select("id, raw").eq("workspace_id", ws).eq("account_id", a).eq("lead_type", t).order("created_at", { ascending: true }).limit(1).maybeSingle()),
    insertLead: (row) => insert("lead_candidates", row),
    updateLead: (id, p) => update("lead_candidates", id, p),
    ...(opts.transactional ? {
      persistLeadTx: async (row: PipelineRow) => {
        const { data, error } = await admin.rpc("lead_pipeline_persist_lead", {
          p_workspace_id: row.lead_candidate.workspace_id, p_account: { ...row.account, domain: canonicalDomain(row.account.domain) },
          p_contact: row.contact ?? null, p_lead: row.lead_candidate, p_existing_lead_id: row.existingLeadId,
        });
        if (error) throw new Error(`lead_pipeline_persist_lead: ${error.message}`);
        const d = data as { account_id: string; contact_id: string | null; lead_id: string; created: boolean };
        return { accountId: d.account_id, contactId: d.contact_id, leadId: d.lead_id, created: d.created };
      },
    } : {}),
  };
}
