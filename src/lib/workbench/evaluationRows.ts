// EVALUATED COMPANIES — visible, explained, and never actionable.
//
// TEST task 42e39fb1 shortlisted six companies with real commercial hiring
// signals inside the size range, resolved none of their LinkedIn identities, and
// showed the user an empty Workbench. The work was done and invisible.
//
// These rows fix the visibility WITHOUT reopening the fail-open hole. They come
// from `tasks.result.workbench_evaluation_rows`, they carry NO
// `lead_candidate_id`, and every action in the product requires one — so they
// cannot be selected, enriched, drafted against, or fed to a paid people search.
// The impossibility is structural, not a rule someone has to remember.
//
// PURE. No React, no network, no database.

export type WorkbenchLifecycle =
  | 'discovered' | 'evaluated' | 'shortlisted' | 'identity_unresolved'
  | 'verifying' | 'qualified' | 'not_qualified' | 'contact_ready';

export interface EvaluationRow {
  company_key: string;
  company_name: string;
  domain: string | null;
  employee_count: number | null;
  strongest_signal: string | null;
  signal_tier: 'A' | 'B' | 'C' | null;
  supporting_job_title: string | null;
  supporting_job_url: string | null;
  prequalification_score: number;
  status: WorkbenchLifecycle;
  explanation: string;
  reasons: string[];
  exclusion: string | null;
}

/** Statuses that mean a company genuinely progressed, for ordering/filtering. */
const ADVANCED: ReadonlySet<WorkbenchLifecycle> = new Set([
  'shortlisted', 'identity_unresolved', 'verifying',
]);

export function readEvaluationRows(result: unknown): EvaluationRow[] {
  if (!result || typeof result !== 'object') return [];
  const raw = (result as { workbench_evaluation_rows?: unknown }).workbench_evaluation_rows;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({
      company_key: String(r.company_key ?? ''),
      company_name: String(r.company_name ?? r.company_key ?? 'Unknown'),
      domain: typeof r.domain === 'string' ? r.domain : null,
      employee_count: typeof r.employee_count === 'number' ? r.employee_count : null,
      strongest_signal: typeof r.strongest_signal === 'string' ? r.strongest_signal : null,
      signal_tier: (r.signal_tier === 'A' || r.signal_tier === 'B' || r.signal_tier === 'C')
        ? r.signal_tier : null,
      supporting_job_title: typeof r.supporting_job_title === 'string' ? r.supporting_job_title : null,
      supporting_job_url: typeof r.supporting_job_url === 'string' ? r.supporting_job_url : null,
      prequalification_score: typeof r.prequalification_score === 'number' ? r.prequalification_score : 0,
      status: String(r.status ?? 'discovered') as WorkbenchLifecycle,
      explanation: String(r.explanation ?? ''),
      reasons: Array.isArray(r.reasons) ? r.reasons.filter((x): x is string => typeof x === 'string') : [],
      exclusion: typeof r.exclusion === 'string' ? r.exclusion : null,
    }));
}

/**
 * An evaluation row is NEVER actionable.
 *
 * A function rather than a convention, so a test can assert the rule directly
 * and a future call site cannot quietly assume otherwise.
 */
export function evaluationRowIsActionable(_row: EvaluationRow): boolean {
  return false;
}

/** Rows a paid people search may run against. Structurally always empty. */
export function peopleSearchEligibleEvaluationRows(rows: readonly EvaluationRow[]): EvaluationRow[] {
  return rows.filter(() => false);
}

/**
 * Rows worth showing prominently: the ones that nearly made it.
 *
 * A company excluded for hiring only engineers is honest record-keeping; a
 * company that was shortlisted and then lost its identity lookup is the story
 * of the run.
 */
export function notableEvaluationRows(rows: readonly EvaluationRow[]): EvaluationRow[] {
  return rows.filter((r) => ADVANCED.has(r.status));
}

/**
 * The funnel, counted from evaluation rows plus the REAL qualified rows.
 *
 * `qualified` and `contactReady` are passed in from the lead table, never
 * derived here — an evaluation row can never contribute to them, which is the
 * whole point of keeping the two projections apart.
 */
export function evaluationFunnel(
  rows: readonly EvaluationRow[],
  qualified: { qualified: number; contactReady: number },
): {
  accountsFound: number; evaluated: number; shortlisted: number;
  identityUnresolved: number; qualified: number; contactReady: number;
} {
  return {
    // Qualified companies leave the evaluation projection, so they are added
    // back for the top-of-funnel count.
    accountsFound: rows.length + qualified.qualified,
    evaluated: rows.filter((r) => r.status !== 'discovered').length + qualified.qualified,
    shortlisted: rows.filter((r) => ADVANCED.has(r.status)).length + qualified.qualified,
    identityUnresolved: rows.filter((r) => r.status === 'identity_unresolved').length,
    qualified: qualified.qualified,
    contactReady: qualified.contactReady,
  };
}

export const LIFECYCLE_LABEL: Readonly<Record<WorkbenchLifecycle, string>> = Object.freeze({
  discovered: 'Discovered',
  evaluated: 'Evaluated',
  shortlisted: 'Shortlisted',
  identity_unresolved: 'Identity unresolved',
  verifying: 'Verifying',
  qualified: 'Qualified',
  not_qualified: 'Not qualified',
  contact_ready: 'Contact-ready',
});
