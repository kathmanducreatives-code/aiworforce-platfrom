// READING `lead_enrichments` AS IT ACTUALLY IS.
//
// The Leads/Workbench join and the dashboard checklist asked for columns this
// table has never had in production — `status` and `personalization_angles` —
// so every read answered HTTP 400 (Postgres 42703) and was swallowed: 416
// research rows in production were never shown, and "Enrich companies" counted
// 0 forever (local readiness audit, 2026-10-01).
//
// THE AUTHORITY is the production schema (information_schema, 2026-10-01),
// mirrored by `src/integrations/supabase/types.ts`:
//
//   id, workspace_id, lead_candidate_id, account_id, source_url, summary,
//   pain_hypothesis, trigger, outreach_angle, raw, created_at
//
// There is no status column: a row EXISTS when research was done, so a row is
// the enrichment. The only writer (`memoryWriter.ts`) always sets `account_id`
// and only sometimes `lead_candidate_id`, so a lead is matched by either.
// Angles are read from the real `outreach_angle` column — today it is empty on
// every row, and an empty list is the truthful answer, never an invented one.

/** Exactly the columns the UI reads — each one exists in production. */
export const LEAD_ENRICHMENT_COLUMNS =
  'id, lead_candidate_id, account_id, summary, outreach_angle, created_at';

export interface LeadEnrichmentRow {
  id: string;
  lead_candidate_id: string | null;
  account_id: string | null;
  summary: string | null;
  outreach_angle: string | null;
  created_at: string | null;
}

export interface EnrichmentIndex {
  byLead: Map<string, LeadEnrichmentRow>;
  byAccount: Map<string, LeadEnrichmentRow>;
}

/** Newest row wins per key, so a re-research replaces the older summary. */
export function indexLeadEnrichments(rows: readonly LeadEnrichmentRow[] | null | undefined): EnrichmentIndex {
  const byLead = new Map<string, LeadEnrichmentRow>();
  const byAccount = new Map<string, LeadEnrichmentRow>();
  const newer = (a: LeadEnrichmentRow, b: LeadEnrichmentRow | undefined) =>
    !b || String(a.created_at ?? '') > String(b.created_at ?? '');
  for (const r of rows ?? []) {
    if (r.lead_candidate_id && newer(r, byLead.get(r.lead_candidate_id))) byLead.set(r.lead_candidate_id, r);
    if (r.account_id && newer(r, byAccount.get(r.account_id))) byAccount.set(r.account_id, r);
  }
  return { byLead, byAccount };
}

/** The enrichment for one lead: its own row first, else its account's. */
export function enrichmentForLead(
  index: EnrichmentIndex,
  lead: { id: string; account_id?: string | null },
): LeadEnrichmentRow | null {
  return index.byLead.get(lead.id) ?? (lead.account_id ? index.byAccount.get(lead.account_id) ?? null : null);
}

/** Personalization angles, from the real column only. */
export function personalizationAnglesOf(row: LeadEnrichmentRow | null): string[] {
  const a = row?.outreach_angle?.trim();
  return a ? [a] : [];
}

/** How many of these leads have research — leads, not rows. */
export function countEnrichedLeads(
  leads: ReadonlyArray<{ id: string; account_id?: string | null }>,
  rows: readonly LeadEnrichmentRow[] | null | undefined,
): number {
  const index = indexLeadEnrichments(rows);
  return leads.filter((l) => enrichmentForLead(index, l) !== null).length;
}

/** The PostgREST `or` filter that finds a lead's rows by either key. */
export function enrichmentLookupFilter(leadIds: readonly string[], accountIds: readonly string[]): string | null {
  const parts = [
    leadIds.length ? `lead_candidate_id.in.(${leadIds.join(',')})` : null,
    accountIds.length ? `account_id.in.(${accountIds.join(',')})` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(',') : null;
}
