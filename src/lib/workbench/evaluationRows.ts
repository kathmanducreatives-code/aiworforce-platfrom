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
// ── AND NOT EVERY ROW HERE IS A REJECTION ────────────────────────────────────
//
// This table was captioned "evaluated but NOT QUALIFIED" for every row it
// received, including companies the run never spent a cent on. The backend
// projection now distinguishes a judged rejection from a company that was
// deferred by the clock, held for missing evidence, or never investigated at
// all — and `decided` carries that distinction onto each row so this side never
// has to guess it.
//
// READ DEFENSIVELY. A task written by an older build has none of the new fields.
// Such a row degrades to `decided: false` — the safe direction, because the
// failure mode being fixed is calling something a rejection when it is not.
//
// PURE. No React, no network, no database.

export type WorkbenchLifecycle =
  | 'discovered' | 'evaluated' | 'not_investigated' | 'shortlisted'
  | 'identity_unresolved' | 'verifying' | 'deferred' | 'held_for_evidence'
  | 'qualified' | 'not_qualified' | 'contact_ready';

export type TriageRelevance = 'relevant' | 'uncertain' | 'irrelevant';

export type EnrichmentState =
  | 'not_attempted' | 'success' | 'empty' | 'provider_error' | 'deferred';

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
  /** Did anyone actually judge this company? False ⇒ never call it rejected. */
  decided: boolean;
  decision_source: string;
  /** True when resuming the run would continue this company. */
  resumable: boolean;
  triage_relevance: TriageRelevance | null;
  triage_signal_strength: number | null;
  triage_reasons: string[];
  shortlist_exclusion: string | null;
  shortlist_exclusion_explanation: string | null;
  enrichment_state: EnrichmentState;
  enrichment_explanation: string;
  mission_decision: string | null;
  mission_match_score: number | null;
  mission_reasoning: string | null;
  mission_failed_requirements: string[];
}

/** Statuses that mean a company genuinely progressed, for ordering/filtering. */
const ADVANCED: ReadonlySet<WorkbenchLifecycle> = new Set([
  'shortlisted', 'identity_unresolved', 'verifying', 'deferred', 'held_for_evidence',
]);

/** The only statuses that assert anything about the company. */
const DECIDED: ReadonlySet<WorkbenchLifecycle> = new Set([
  'qualified', 'not_qualified', 'contact_ready',
]);

const LIFECYCLES: ReadonlySet<string> = new Set<string>([
  'discovered', 'evaluated', 'not_investigated', 'shortlisted',
  'identity_unresolved', 'verifying', 'deferred', 'held_for_evidence',
  'qualified', 'not_qualified', 'contact_ready',
]);

const ENRICHMENT_STATES: ReadonlySet<string> = new Set<string>([
  'not_attempted', 'success', 'empty', 'provider_error', 'deferred',
]);

const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

export function readEvaluationRows(result: unknown): EvaluationRow[] {
  if (!result || typeof result !== 'object') return [];
  const raw = (result as { workbench_evaluation_rows?: unknown }).workbench_evaluation_rows;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => {
      // AN UNKNOWN STATUS IS NOT A DECISION. A row from a future or corrupted
      // build falls back to `discovered`, which claims nothing.
      const status = (LIFECYCLES.has(String(r.status ?? ''))
        ? String(r.status) : 'discovered') as WorkbenchLifecycle;
      return {
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
        status,
        explanation: String(r.explanation ?? ''),
        reasons: strArr(r.reasons),
        exclusion: typeof r.exclusion === 'string' ? r.exclusion : null,
        // TRUSTED ONLY WHEN THE STATUS AGREES. `decided` is the field that
        // authorises the word "rejected", so it is confirmed against the
        // lifecycle rather than taken on the row's word alone — and an older
        // row that has no `decided` at all falls to the status, which for
        // anything but a real decision is false.
        decided: r.decided === true && DECIDED.has(status),
        decision_source: String(r.decision_source ?? 'not_evaluated'),
        resumable: r.resumable === true,
        triage_relevance: (r.triage_relevance === 'relevant' ||
          r.triage_relevance === 'uncertain' || r.triage_relevance === 'irrelevant')
          ? r.triage_relevance : null,
        triage_signal_strength: typeof r.triage_signal_strength === 'number'
          ? r.triage_signal_strength : null,
        triage_reasons: strArr(r.triage_reasons),
        shortlist_exclusion: typeof r.shortlist_exclusion === 'string' ? r.shortlist_exclusion : null,
        shortlist_exclusion_explanation: typeof r.shortlist_exclusion_explanation === 'string'
          ? r.shortlist_exclusion_explanation : null,
        enrichment_state: (ENRICHMENT_STATES.has(String(r.enrichment_state ?? ''))
          ? String(r.enrichment_state) : 'not_attempted') as EnrichmentState,
        enrichment_explanation: String(r.enrichment_explanation ?? ''),
        mission_decision: typeof r.mission_decision === 'string' ? r.mission_decision : null,
        mission_match_score: typeof r.mission_match_score === 'number' ? r.mission_match_score : null,
        mission_reasoning: typeof r.mission_reasoning === 'string' ? r.mission_reasoning : null,
        mission_failed_requirements: strArr(r.mission_failed_requirements),
      };
    });
}

/**
 * Rows that may be shown as rejected. Nothing else may be.
 *
 * The predicate the table calls instead of assuming every row it was handed is
 * a rejection — which is exactly what it used to do.
 */
export function notQualifiedRows(rows: readonly EvaluationRow[]): EvaluationRow[] {
  return rows.filter((r) => r.decided && r.status === 'not_qualified');
}

/** Rows nobody judged. Never rendered under a rejection heading. */
export function undecidedRows(rows: readonly EvaluationRow[]): EvaluationRow[] {
  return rows.filter((r) => !r.decided);
}

/** Rows the run still owes work on — a resume would continue these. */
export function resumableRows(rows: readonly EvaluationRow[]): EvaluationRow[] {
  return rows.filter((r) => r.resumable);
}

/** Rows excluded before any money was spent on them. */
export function notInvestigatedRows(rows: readonly EvaluationRow[]): EvaluationRow[] {
  return rows.filter((r) => r.status === 'not_investigated');
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
  not_investigated: 'Not investigated',
  shortlisted: 'Shortlisted',
  identity_unresolved: 'Identity unresolved',
  verifying: 'Verifying',
  deferred: 'Deferred',
  held_for_evidence: 'Awaiting evidence',
  qualified: 'Qualified',
  not_qualified: 'Not qualified',
  contact_ready: 'Contact-ready',
});
