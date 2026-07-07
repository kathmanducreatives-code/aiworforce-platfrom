// Pure Workbench row-action helpers (Part E/F). No React / no `@/` imports, so
// this is unit-testable under Deno like the other src/lib models.
import type { LeadActionKind } from './leadActionRequest';

export type RowActionState = 'running' | 'success' | 'empty' | 'insufficient_context' | 'error';
export interface RowAction { kind: LeadActionKind; state: RowActionState; detail?: string }

/** Minimal shape of a run-agent lead_action response we depend on. */
export interface LeadActionResultLike {
  success: boolean;
  error?: string;
  per_lead?: Array<Record<string, unknown>>;
}

/**
 * Map a single per-lead run-agent result into a row lifecycle state. Honest:
 * no verified decision-maker → empty; blocked/failed enrichment → empty with a
 * reason; insufficient outreach evidence → insufficient_context. Never "success"
 * without a real result.
 */
export function deriveRowAction(kind: LeadActionKind, res: LeadActionResultLike, p: Record<string, unknown>): RowAction {
  if (!res.success && !(res.per_lead && res.per_lead.length)) return { kind, state: 'error', detail: res.error };

  if (kind === 'research_company') {
    const st = p.status as string;
    if (st === 'enriched') {
      const lines = Array.isArray(p.summary_lines) ? p.summary_lines as string[] : [];
      const summary = lines.find((l) => /^Summary/.test(l));
      return { kind, state: 'success', detail: summary ? summary.replace(/^Summary:\s*/, '') : 'Enriched' };
    }
    if (st === 'blocked') return { kind, state: 'empty', detail: /website/i.test(String(p.blocked_reason)) ? 'Blocked: no website' : 'Blocked' };
    if (st === 'needs_verification') return { kind, state: 'empty', detail: 'Needs verification' };
    if (st === 'failed') return { kind, state: 'empty', detail: 'No useful evidence' };
    return { kind, state: 'error', detail: res.error };
  }

  if (kind === 'find_decision_makers') {
    if (p.needs_manual_review) return { kind, state: 'empty' };
    const dms = Array.isArray(p.decision_makers) ? p.decision_makers as Array<Record<string, unknown>> : [];
    const top = dms[0];
    return { kind, state: dms.length ? 'success' : 'empty', detail: top ? `${top.name}${top.title ? ` · ${top.title}` : ''}` : undefined };
  }

  // generate_outreach
  const st = p.status as string;
  if (st === 'draft_needs_approval') return { kind, state: 'success', detail: 'Draft ready for approval' };
  return { kind, state: 'insufficient_context', detail: Array.isArray(p.missing_context) ? (p.missing_context as string[]).join(', ') : undefined };
}

/**
 * Unwrap the persisted lead jsonb. useLeadResults sets LeadTableRow.raw to the
 * whole DB row, so the Apify/analyst payload is one level deeper (raw.raw). This
 * returns the correct object for CSV/detail reads (the raw.raw fallback).
 */
export function unwrapLeadRaw(rowRaw: unknown): Record<string, unknown> {
  const dbRow = (rowRaw && typeof rowRaw === 'object' ? rowRaw : {}) as Record<string, unknown>;
  return (dbRow.raw && typeof dbRow.raw === 'object' ? dbRow.raw : dbRow) as Record<string, unknown>;
}

/**
 * Both company website AND LinkedIn are surfaced (not hidden behind CSV). Returns
 * the clickable link targets + a display host for the Company/Account cell.
 */
export function companyDisplayLinks(row: { website?: string | null; company_linkedin_url?: string | null }): {
  website: string | null; websiteHost: string | null; linkedinUrl: string | null;
} {
  const website = row.website && row.website.trim() ? row.website : null;
  const linkedinUrl = row.company_linkedin_url && row.company_linkedin_url.trim() ? row.company_linkedin_url : null;
  const websiteHost = website ? website.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null;
  return { website, websiteHost, linkedinUrl };
}

/**
 * CSV export target (Part 7): export the SELECTED rows when there's a selection,
 * otherwise the VISIBLE (filtered) rows — never an empty/headers-only file when
 * the Workbench is showing rows.
 */
export function rowsForExport<T>(selected: T[], visible: T[]): T[] {
  return (selected && selected.length > 0) ? selected : (visible ?? []);
}
