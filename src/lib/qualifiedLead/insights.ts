// WORKBENCH INSIGHTS — the frontend projection of company qualification.
//
// The backend records one bounded diagnostic per company the Company Brain
// evaluated, INCLUDING the ones its qualification filter then drops
// (`companyQualificationDiagnostics`, persisted to
// `company_first_state.candidate_diagnostics`). Until now nothing in the app
// read them: a run could evaluate twenty-five companies, qualify none, and show
// an empty Workbench with no way to see which companies those were or why each
// failed.
//
// This module is the read side. It is pure and defensive — the persisted shape
// comes from a checkpoint written by an older or newer backend, so every field
// is treated as unknown until proven otherwise.
//
// WHAT IT MUST NOT DO. It produces no opportunity, no lead and no count that can
// reach quota. Rejected companies are returned in their own list precisely so a
// caller cannot accidentally render them among Opportunities.

/** Mirrors the backend union. Kept as a string union, not an enum, for the wire. */
export type QualificationStatus =
  | 'company_resolved'
  | 'qualification_pending'
  | 'qualified'
  | 'rejected'
  | 'decision_maker_pending'
  | 'decision_maker_unverified'
  | 'contact_enrichment_pending'
  | 'contact_ready';

export type BrainStatus = 'pass' | 'fail' | 'evidence_pending' | 'not_enforced';

export interface CompanyDiagnosticView {
  company_key: string;
  company_name: string;
  company_domain: string;
  hiring_signal_title: string;
  hiring_signal_url: string;
  hiring_signal_date: string;
  title_family: string;
  company_brain_status: BrainStatus;
  failed_gates: string[];
  /** Constraints with no evidence either way. NOT failures. */
  missing_evidence: string[];
  qualification_status: QualificationStatus;
  /** Always false for anything this module returns. */
  quota_eligible: false;
}

export interface QualificationInsightsView {
  companies_evaluated: number;
  companies_qualified: number;
  companies_rejected: number;
  companies_pending: number;
  /** Failed-gate code → how many companies it blocked, most common first. */
  failed_gate_counts: Array<{ gate: string; count: number }>;
  /** The rejected companies. NEVER Opportunities. */
  rejected: CompanyDiagnosticView[];
  /** Companies still awaiting evidence — neither qualified nor rejected. */
  evidence_pending: CompanyDiagnosticView[];

  /** Human-readable summary of why nothing qualified, when nothing did. */
  rejection_summary: string | null;
  /** Present only when there is genuinely nothing to show yet. */
  empty_reason: 'no_companies_evaluated' | null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const raw of v) {
    const s = str(raw);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

const BRAIN_STATUSES: BrainStatus[] = ['pass', 'fail', 'evidence_pending', 'not_enforced'];
const STATUSES: QualificationStatus[] = [
  'company_resolved', 'qualification_pending', 'qualified', 'rejected',
  'decision_maker_pending', 'decision_maker_unverified',
  'contact_enrichment_pending', 'contact_ready',
];

/** Read one persisted diagnostic. Returns null when it is unusable. */
export function readCompanyDiagnostic(raw: unknown): CompanyDiagnosticView | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const key = str(r.company_key);
  if (!key) return null;

  const brain = str(r.company_brain_status) as BrainStatus;
  const status = str(r.qualification_status) as QualificationStatus;

  return {
    company_key: key,
    company_name: str(r.company_name),
    company_domain: str(r.company_domain),
    hiring_signal_title: str(r.hiring_signal_title),
    hiring_signal_url: str(r.hiring_signal_url),
    hiring_signal_date: str(r.hiring_signal_date),
    title_family: str(r.title_family),
    company_brain_status: BRAIN_STATUSES.includes(brain) ? brain : 'not_enforced',
    failed_gates: strList(r.failed_gates),
    missing_evidence: strList(r.missing_evidence),
    qualification_status: STATUSES.includes(status) ? status : 'company_resolved',
    // Hard-coded, never read from the wire: a diagnostic can never count.
    quota_eligible: false,
  };
}

/** Pull the diagnostics out of a persisted task result, wherever they live. */
export function readDiagnosticsFromResult(result: unknown): CompanyDiagnosticView[] {
  if (!result || typeof result !== 'object') return [];
  const r = result as Record<string, any>;
  const raw = r.company_first_state?.candidate_diagnostics
    ?? r.candidate_diagnostics
    ?? null;
  if (!Array.isArray(raw)) return [];
  const out: CompanyDiagnosticView[] = [];
  for (const item of raw) {
    const d = readCompanyDiagnostic(item);
    if (d) out.push(d);
  }
  return out;
}

/** Turn a gate code into something a person can read. */
export function gateLabel(gate: string): string {
  const known: Record<string, string> = {
    employee_count: 'Employee count outside the target range',
    business_model: 'Business model does not match the ICP',
    company_vertical: 'Industry does not match the ICP',
    company_stage: 'Company stage outside the target range',
    allowed_stages: 'Company stage outside the target range',
    positive_industries: 'Industry does not match the ICP',
    negative_industries: 'Industry is on the avoid list',
    excluded_company_types: 'Company type is on the avoid list',
    require_founder_led: 'Not founder-led',
    geography: 'Location outside the requested geography',
  };
  if (known[gate]) return known[gate];
  // Unknown codes are shown as-is rather than hidden — an unexplained rejection
  // is still more useful than a silent one.
  return gate.replace(/_/g, ' ');
}

/**
 * Project the Insights surface.
 *
 * `companies_qualified` counts diagnostics that PASSED the Brain. It is not the
 * opportunity count — an opportunity also needs a persisted account row — so the
 * two are deliberately not conflated here.
 */
export function buildQualificationInsightsView(
  diagnostics: readonly CompanyDiagnosticView[],
): QualificationInsightsView {
  const rejected = diagnostics.filter(
    (d) => d.qualification_status === 'rejected' || d.company_brain_status === 'fail',
  );
  const pending = diagnostics.filter(
    (d) => d.company_brain_status === 'evidence_pending' || d.qualification_status === 'qualification_pending',
  );
  const qualified = diagnostics.filter(
    (d) => d.company_brain_status === 'pass' && d.qualification_status !== 'rejected',
  );

  const counts = new Map<string, number>();
  for (const d of rejected) {
    for (const g of d.failed_gates) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  const failed_gate_counts = [...counts.entries()]
    .map(([gate, count]) => ({ gate, count }))
    .sort((a, b) => b.count - a.count || a.gate.localeCompare(b.gate));

  let rejection_summary: string | null = null;
  if (diagnostics.length > 0 && qualified.length === 0 && rejected.length > 0) {
    const top = failed_gate_counts.slice(0, 2).map((g) => gateLabel(g.gate).toLowerCase());
    rejection_summary = top.length > 0
      ? `${rejected.length} ${rejected.length === 1 ? 'company was' : 'companies were'} evaluated and none matched the ICP — most often: ${top.join('; ')}.`
      : `${rejected.length} ${rejected.length === 1 ? 'company was' : 'companies were'} evaluated and none matched the ICP.`;
  }

  return {
    evidence_pending: pending,
    companies_evaluated: diagnostics.length,
    companies_qualified: qualified.length,
    companies_rejected: rejected.length,
    companies_pending: pending.length,
    failed_gate_counts,
    rejected,
    rejection_summary,
    empty_reason: diagnostics.length === 0 ? 'no_companies_evaluated' : null,
  };
}

/** Convenience: straight from a persisted task result to the Insights view. */
export function insightsFromResult(result: unknown): QualificationInsightsView {
  return buildQualificationInsightsView(readDiagnosticsFromResult(result));
}

/**
 * The truthful processing state, so a Workbench with pending work never renders a
 * terminal empty message.
 *
 * `null` means "nothing is in flight" — only then may a caller show a terminal
 * empty state.
 */
export function processingState(input: {
  insights: QualificationInsightsView;
  contactReady: number;
  requested: number;
  /** True while the run can still do valid work. */
  workRemains: boolean;
}): string | null {
  if (!input.workRemains) return null;
  if (input.contactReady >= input.requested && input.requested > 0) return null;

  const { companies_evaluated, companies_qualified } = input.insights;
  if (companies_evaluated === 0) return 'Collecting and validating hiring signals…';
  if (companies_qualified === 0) return 'Qualifying companies against your Company Brain…';
  return `${companies_qualified} ${companies_qualified === 1 ? 'company' : 'companies'} qualified. Finding current founders and CEOs…`;
}
