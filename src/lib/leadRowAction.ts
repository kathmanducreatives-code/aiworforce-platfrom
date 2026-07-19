// Pure Workbench row-action helpers (Part E/F). No React / no `@/` imports, so
// this is unit-testable under Deno like the other src/lib models.
import type { LeadActionKind } from './leadActionRequest';
import {
  LEAD_OUTCOME_STATUSES,
  ROW_STATUS_COPY,
  type LeadOutcomeStatus,
  type RowDisplayStatus,
} from './leadActionOutcome';
import {
  buildDecisionMakerRowView,
  titleCompanyLine,
  type DecisionMakerRowView,
} from './decisionMakerDisplay';

export interface RowAction {
  kind: LeadActionKind;
  status: RowDisplayStatus;
  /** Canonical backend reason, for the drawer / retry logic. */
  reason_code?: string;
  /** Row-specific extra context (e.g. the person found), appended to the copy. */
  detail?: string;
  /**
   * Structured decision-maker view. Components render THIS rather than parsing
   * prose, so ranks 2 and 3 are no longer discarded.
   */
  decisionMakers?: DecisionMakerRowView;
}

/** Minimal shape of a run-agent lead_action response we depend on. */
export interface LeadActionResultLike {
  success: boolean;
  error?: string;
  message?: string;
  requestError?: boolean;
  per_lead?: Array<Record<string, unknown>>;
}

function isOutcomeStatus(v: unknown): v is LeadOutcomeStatus {
  return typeof v === 'string' && (LEAD_OUTCOME_STATUSES as readonly string[]).includes(v);
}

/**
 * Map a single per-lead run-agent result into a row state.
 *
 * The backend already classified each row into the canonical vocabulary, so this
 * reads that status rather than re-deriving one. Crucially, a request that was
 * rejected BEFORE execution becomes `request_error` — not `failed` — so the row
 * says "rejected before execution" instead of implying the lead was examined.
 */
export function deriveRowAction(
  kind: LeadActionKind,
  res: LeadActionResultLike,
  p: Record<string, unknown>,
): RowAction {
  // Nothing was executed: a contract/auth rejection, not a business outcome.
  if (res.requestError || (!res.success && !(res.per_lead && res.per_lead.length))) {
    return { kind, status: 'request_error', reason_code: res.error, detail: res.message };
  }

  const status = isOutcomeStatus(p.status) ? p.status : 'failed';
  const reason_code = typeof p.reason_code === 'string' ? p.reason_code : undefined;

  if (kind === 'find_decision_makers') {
    const view = buildDecisionMakerRowView(p);
    // A "succeeded" payload with nothing displayable must NOT render as success:
    // that is how the row printed "…found: undefined".
    if (view.status === 'contract_error') {
      return {
        kind,
        status: 'failed',
        reason_code: view.contract_error_reason ?? 'decision_maker_display_contract_invalid',
        decisionMakers: view,
      };
    }
    return { kind, status, reason_code, detail: rowDetail(kind, status, p), decisionMakers: view };
  }

  return { kind, status, reason_code, detail: rowDetail(kind, status, p) };
}

/** Optional extra context appended after the canonical copy. */
function rowDetail(kind: LeadActionKind, status: LeadOutcomeStatus, p: Record<string, unknown>): string | undefined {
  if (status !== 'succeeded') return undefined;

  if (kind === 'find_decision_makers') {
    // Canonical DTO only. Reading `top.name` here interpolated the literal
    // string "undefined" whenever the payload used canonical field names.
    const view = buildDecisionMakerRowView(p);
    const dm = view.primary_decision_maker;
    if (!dm) return undefined;
    const line = titleCompanyLine(dm);
    return line ? `${dm.full_name} · ${line}` : dm.full_name;
  }
  if (kind === 'research_company') {
    const lines = Array.isArray(p.summary_lines) ? (p.summary_lines as string[]) : [];
    const summary = lines.find((l) => /^Summary/.test(l));
    return summary ? summary.replace(/^Summary:\s*/, '') : undefined;
  }
  return 'Draft ready for approval';
}

/**
 * Row copy. `find_decision_makers` owns the canonical phrasing; the other two
 * actions reuse the same statuses but need action-appropriate wording for the
 * cases where "decision-maker" would be nonsense.
 */
export function rowActionCopy(a: RowAction): string {
  if (a.kind !== 'find_decision_makers') {
    if (a.status === 'succeeded') {
      return a.kind === 'research_company' ? 'Company enriched' : 'Draft ready for approval';
    }
    if (a.status === 'no_match') return 'No useful evidence found';
    if (a.status === 'unavailable') return 'This provider is disabled in this environment';
    if (a.status === 'timed_out') return 'The request timed out';
  }
  return ROW_STATUS_COPY[a.status];
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
