// Existing Agentory records → the exclusion index (exclusions.ts).
//
// Read from the tables the platform already has (schema read 2026-10-31 on the
// TEST project):
//
//   accounts / contacts / lead_candidates   workspace-scoped Leads: they keep
//                                           their ids (existing, not new)
//   outreach_leads                          legacy outreach CRM (no workspace
//                                           column): status lead_status
//   outreach_activities                     sent touches (lead_id → outreach_leads)
//   call_attempts                           dialled calls (lead_id → outreach_leads)
//
// Workspace isolation: workspace tables give Lead ids. The legacy outreach
// tables carry no workspace, so they contribute HOLDS ONLY (leadId null) — they
// protect a person from a second touch without revealing another workspace's
// record. A hold blocks outreach; it never changes qualification.

import type { ExistingRecord, HoldReason } from "./exclusions.ts";

export const RECENT_CONTACT_DAYS = 90;
const DAY = 86_400_000;

export interface AccountRow { id: string; domain: string | null; linkedin_url: string | null; stage?: string | null; raw?: Record<string, unknown> | null }
export interface ContactRow { id: string; account_id: string | null; linkedin_url: string | null; raw?: Record<string, unknown> | null }
export interface LeadCandidateRow { id: string; account_id: string | null; contact_id: string | null; status: string | null }
export interface OutreachLeadRow { id: string; linkedin_url: string | null; linkedin_slug?: string | null; status: string | null; last_touch_date: string | null }
export interface TouchRow { lead_id: string | null; at: string | null }

const CRM_STAGE: Record<string, ExistingRecord["crmRelationship"]> = { customer: "customer", partner: "partner", opportunity: "open_deal", open_deal: "open_deal", former_customer: "former_customer", churned: "former_customer" };

function providerIds(raw: Record<string, unknown> | null | undefined, kind: "company" | "person"): string[] {
  const d = (raw?.agentory_discovery ?? null) as { providers?: { provider?: string; record_id?: string }[] } | null;
  return (d?.providers ?? []).filter((p) => p.record_id).map((p) => (kind === "company" ? String(p.record_id) : String(p.record_id)));
}

/** Workspace Leads: ids kept; an account stage that names a CRM relationship blocks outreach. */
export function recordsFromWorkspace(accounts: AccountRow[], contacts: ContactRow[], candidates: LeadCandidateRow[]): ExistingRecord[] {
  const leadOfAccount = new Map<string, string>();
  const leadOfContact = new Map<string, string>();
  for (const c of candidates) {
    if (c.account_id && !leadOfAccount.has(c.account_id)) leadOfAccount.set(c.account_id, c.id);
    if (c.contact_id && !leadOfContact.has(c.contact_id)) leadOfContact.set(c.contact_id, c.id);
  }
  const out: ExistingRecord[] = [];
  for (const a of accounts) {
    out.push({ leadId: leadOfAccount.get(a.id) ?? a.id, kind: "account", companyDomain: a.domain, companyLinkedinUrl: a.linkedin_url,
      providerCompanyIds: providerIds(a.raw, "company"), crmRelationship: a.stage ? CRM_STAGE[a.stage.toLowerCase()] ?? null : null });
  }
  for (const c of contacts) {
    out.push({ leadId: leadOfContact.get(c.id) ?? c.id, kind: "contact", personLinkedinUrl: c.linkedin_url, providerPersonIds: providerIds(c.raw, "person") });
  }
  return out;
}

/** Legacy outreach: holds only. */
export function holdsFromOutreach(leads: OutreachLeadRow[], touches: TouchRow[], now: Date): ExistingRecord[] {
  const lastTouch = new Map<string, number>();
  for (const t of touches) {
    if (!t.lead_id || !t.at) continue;
    const ms = Date.parse(t.at);
    if (Number.isFinite(ms)) lastTouch.set(t.lead_id, Math.max(lastTouch.get(t.lead_id) ?? 0, ms));
  }
  const out: ExistingRecord[] = [];
  for (const l of leads) {
    const url = l.linkedin_url ?? (l.linkedin_slug ? `https://www.linkedin.com/in/${l.linkedin_slug}` : null);
    if (!url) continue;
    const touched = Math.max(lastTouch.get(l.id) ?? 0, l.last_touch_date ? Date.parse(l.last_touch_date) || 0 : 0);
    const status = (l.status ?? "").toLowerCase();
    let hold: { reason: HoldReason; until: string | null; note: string } | null = null;
    let crm: ExistingRecord["crmRelationship"] = null;
    if (status === "replied" || status === "meeting_booked") crm = "open_deal";
    else if (status === "closed" || status === "dead") hold = { reason: "other", until: null, note: `legacy outreach status ${status}` };
    else if (status === "in_sequence") hold = { reason: "recently_contacted", until: null, note: "in an active sequence" };
    if (!hold && touched && now.getTime() - touched < RECENT_CONTACT_DAYS * DAY) {
      hold = { reason: "recently_contacted", until: new Date(touched + RECENT_CONTACT_DAYS * DAY).toISOString(), note: "touched within the last 90 days" };
    }
    if (hold || crm) out.push({ leadId: null, kind: "contact", personLinkedinUrl: url, crmRelationship: crm, hold });
  }
  return out;
}

/** Load every record for one workspace. `admin` is a service-role client; reads only. */
// deno-lint-ignore no-explicit-any
export async function loadExistingRecords(admin: any, workspaceId: string, now: Date): Promise<ExistingRecord[]> {
  const page = async <T>(q: () => Promise<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> => {
    const { data, error } = await q();
    if (error) throw new Error(`history read failed: ${error.message}`);
    return data ?? [];
  };
  const [accounts, contacts, candidates, oLeads, acts, calls] = await Promise.all([
    page<AccountRow>(() => admin.from("accounts").select("id, domain, linkedin_url, stage, raw").eq("workspace_id", workspaceId).limit(20000)),
    page<ContactRow>(() => admin.from("contacts").select("id, account_id, linkedin_url, raw").eq("workspace_id", workspaceId).limit(50000)),
    page<LeadCandidateRow>(() => admin.from("lead_candidates").select("id, account_id, contact_id, status").eq("workspace_id", workspaceId).limit(50000)),
    page<OutreachLeadRow>(() => admin.from("outreach_leads").select("id, linkedin_url, linkedin_slug, status, last_touch_date").limit(50000)),
    page<{ lead_id: string | null; executed_date: string | null }>(() => admin.from("outreach_activities").select("lead_id, executed_date").not("executed_date", "is", null).limit(100000)),
    page<{ lead_id: string | null; started_at: string | null }>(() => admin.from("call_attempts").select("lead_id, started_at").limit(100000)),
  ]);
  return [
    ...recordsFromWorkspace(accounts, contacts, candidates),
    ...holdsFromOutreach(oLeads, [...acts.map((a) => ({ lead_id: a.lead_id, at: a.executed_date })), ...calls.map((c) => ({ lead_id: c.lead_id, at: c.started_at }))], now),
  ];
}
