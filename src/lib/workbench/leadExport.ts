// THE BUSINESS-FACING EXPORT.
//
// ── WHAT REGRESSED ─────────────────────────────────────────────────────────
//
// Export CSV lived in the Workbench's always-rendered action bar from
// `ada8c9dc` until `2ba36cfc` ("the hero said 11 qualified beside a Qualified 0
// tab"), which folded that bar into a selection toolbar gated on
// `selectedRows.length > 0`. The button was never removed and its handler still
// works — it just became unreachable until you tick a checkbox, and nothing on
// screen said so. `rowsForExport(selected, filtered)` still encodes the old
// intent exactly: selection if there is one, otherwise everything visible.
//
// ── WHY THIS IS NOT `leadTable/csv.ts` ─────────────────────────────────────
//
// That export is the DIAGNOSTIC one: ~110 columns including `provider_job_id`,
// `provider_ref_id`, `tracking_id`, `input_url`, `scout_penalties`,
// `relaxation_step_used` and the whole qualified-lead run trace. It exists so a
// run can be audited and it should keep existing. It is the wrong thing to hand
// someone who asked for their leads. This module is the short, legible one; the
// diagnostic export stays exactly where it is, reachable from the same menu.
//
// Column headers are written for a human opening a spreadsheet; the values come
// from the current field names and the CURRENT authoritative resolver, so a row
// labelled Qualified here is the same row the Qualified tab counted.
//
// Pure — no React, no network, no `@/` alias.

import { resolveQualification, type QualificationRecord } from '../qualifiedLead/qualification.ts';
import { qualificationFromRow, type QualifiableRow } from '../qualifiedLead/rowQualification.ts';
import { effectiveFit, hasHiringSignal, sourceOf, type FilterableLead } from './leadFilters.ts';

export type ExportableLead = FilterableLead & QualifiableRow & {
  signal_source_url?: string | null;
};

export type ExportScope = 'current_view' | 'qualified';

export const EXPORT_SCOPE_LABEL: Readonly<Record<ExportScope, string>> = Object.freeze({
  current_view: 'Export current view',
  qualified: 'Export qualified leads',
});

/**
 * What each scope means, said in the menu rather than discovered afterwards.
 *
 * The old button was ambiguous by design — one control whose scope depended on
 * whether anything happened to be ticked. Two named controls cost one line of
 * chrome and remove the guess.
 */
export const EXPORT_SCOPE_HINT: Readonly<Record<ExportScope, string>> = Object.freeze({
  current_view: 'Every row showing under the current tab and filters.',
  qualified: 'Every qualified lead in this run, whatever tab or filter is set.',
});

/** Words for a level, for someone who has never read the codebase. */
const STATUS_LABEL: Readonly<Record<string, string>> = Object.freeze({
  contact_ready: 'Qualified — contact ready',
  needs_decision_maker: 'In review — needs a decision-maker',
  needs_verification: 'In review — needs verification',
  not_qualified: 'Ruled out',
  not_evaluated: 'Not evaluated',
});

export function qualificationOf(row: ExportableLead) {
  const rec: QualificationRecord = qualificationFromRow(row as QualifiableRow);
  return resolveQualification(rec);
}

function statusText(row: ExportableLead): string {
  const q = qualificationOf(row);
  return STATUS_LABEL[q.level] ?? q.level;
}

/**
 * Why the row is where it is.
 *
 * `displayLines` is the resolver's own human explanation and is preferred over
 * anything reconstructed here; `decidedBy` names the field that decided when
 * there is no sentence. Never blank for a row that was actually judged.
 */
function reasonText(row: ExportableLead): string {
  const q = qualificationOf(row);
  const line = q.displayLines.find((l) => !!l && l.trim().length > 0);
  if (line) return line;
  if (row.why_this_lead) return row.why_this_lead;
  if (row.icp_fit_summary) return row.icp_fit_summary;
  if (!q.evaluated) return 'Not evaluated';
  return q.decidedBy ? `Decided by ${q.decidedBy}` : '';
}

type Cell = string | number | null | undefined;

/**
 * The columns, external header first.
 *
 * Business-facing only. No provider ids, no tracking ids, no planner internals,
 * no prompt or model trace — the diagnostic export owns all of that.
 */
export const WORKBENCH_EXPORT_COLUMNS: ReadonlyArray<
  readonly [header: string, field: string, get: (r: ExportableLead) => Cell]
> = Object.freeze([
  ['Company', 'company_name', (r) => r.company_name],
  ['Website', 'website', (r) => r.website],
  ['LinkedIn', 'company_linkedin_url', (r) => r.company_linkedin_url],
  ['Location', 'company_location', (r) => r.company_location],
  ['Employees', 'employee_count', (r) => r.employee_count],
  ['Industry', 'industries', (r) => (r.industries ?? []).join(' · ')],
  ['Hiring status', 'job_title', (r) => (hasHiringSignal(r) ? (r.job_title || 'Hiring signal found') : 'No hiring signal')],
  ['Hiring evidence', 'job_url', (r) => r.job_url || r.signal_source_url || ''],
  ['Source', 'signal_type', (r) => sourceOf(r)],
  ['Qualification status', 'qualification.level', (r) => statusText(r)],
  ['Qualification score', 'final_overall_fit', (r) => {
    const n = effectiveFit(r);
    // A zero here means "no score was recorded", not "scored zero". Blank says
    // that; 0 would be read as a judgement nobody made.
    return n > 0 ? n : '';
  }],
  ['Qualification reason', 'qualification.displayLines', (r) => reasonText(r)],
]);

/**
 * RFC 4180 escaping.
 *
 * Quotes double up; anything containing a comma, a quote, CR or LF is wrapped.
 * A lone CR matters as much as an LF — a cell holding one and not the other
 * still splits the row in Excel.
 */
export function csvEscape(v: Cell): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s === '') return '';
  const q = s.replace(/"/g, '""');
  return /[",\r\n]/.test(q) ? `"${q}"` : q;
}

/** UTF-8 byte-order mark. Without it Excel reads the file as the local codepage. */
export const CSV_BOM = '\uFEFF';

export function workbenchCsvHeader(): string {
  return WORKBENCH_EXPORT_COLUMNS.map(([h]) => csvEscape(h)).join(',');
}

/**
 * Rows to CSV text.
 *
 * CRLF line endings, because that is what every spreadsheet expects and what
 * the escaping above is written against. An empty row list still produces the
 * header — a file with column names and nothing under them is a truthful answer
 * to "export this empty view", and an empty file is not.
 */
export function workbenchRowsToCsv(rows: readonly ExportableLead[]): string {
  const lines = [workbenchCsvHeader()];
  for (const r of rows) {
    lines.push(WORKBENCH_EXPORT_COLUMNS.map(([, , get]) => csvEscape(get(r))).join(','));
  }
  return CSV_BOM + lines.join('\r\n') + '\r\n';
}

/**
 * The rows a scope covers.
 *
 * `current_view` is handed what is on screen and passes it through unchanged —
 * the tab and the filters already decided it, and re-deciding here is how the
 * export and the table start disagreeing. `qualified` reads the FULL row set
 * and re-asks the resolver, so it is unaffected by whatever tab or filter
 * happens to be set.
 */
export function rowsForScope<T extends ExportableLead>(
  scope: ExportScope,
  input: { visible: readonly T[]; all: readonly T[] },
): T[] {
  if (scope === 'qualified') return input.all.filter((r) => qualificationOf(r).qualified);
  return [...input.visible];
}

/** `leads-<scope>-<run>.csv`, with nothing in it that needs escaping. */
export function exportFilename(scope: ExportScope, runRef: string | null | undefined): string {
  const ref = (runRef ?? '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
  const base = scope === 'qualified' ? 'qualified-leads' : 'leads-current-view';
  return ref ? `${base}-${ref}.csv` : `${base}.csv`;
}
