// RUNTIME DIAGNOSTICS → RESULT → WORKBENCH → CSV.
//
// The runtime already produces every field below. They were being dropped at the
// response adapter, so the export could not answer the two questions that matter
// after a disappointing run: what did we actually search for, and why did this
// row not count?
//
// A field is emitted ONLY when the runtime produced it. Nothing is invented, and
// account-only workflows legitimately leave the lead-shaped fields null.
//
// Pure — no React, no network.

export type DiagnosticValue = string | number | boolean | null;

/** The canonical column order, shared by the Workbench drawer and the CSV. */
export const QUALIFIED_LEAD_DIAGNOSTIC_FIELDS = [
  'original_user_query',
  'parsed_intent_summary',
  'workflow_kind',
  'execution_mode',
  'job_family',
  'job_titles',
  'company_vertical',
  'company_stage',
  'requested_person_roles',
  'requested_lead_count',
  'count_entity',
  'quota_policy',
  'provider_query_keywords',
  'provider_query_location',
  'planner_source',
  'planner_status',
  'round_number',
  'terminal_status',
  'quota_eligible',
  'failed_gates',
  'employer_match_status',
  'employer_match_reason',
  'persistence_reason',
  'decision_maker_status',
] as const;

export type QualifiedLeadDiagnosticField = typeof QUALIFIED_LEAD_DIAGNOSTIC_FIELDS[number];
export type QualifiedLeadDiagnostics = Record<QualifiedLeadDiagnosticField, DiagnosticValue>;

/** Run-level context, identical for every row of one run. */
export interface RunDiagnosticsSource {
  original_user_query?: string | null;
  parsed_intent_summary?: string | null;
  workflow_kind?: string | null;
  execution_mode?: string | null;
  job_family?: string | null;
  job_titles?: string[] | null;
  company_vertical?: string | null;
  company_stage?: string | null;
  requested_person_roles?: string[] | null;
  requested_lead_count?: number | null;
  count_entity?: string | null;
  quota_policy?: string | null;
  /** From routing.job_search_spec. */
  provider_query_keywords?: string[] | string | null;
  provider_query_location?: string | null;
  plan_sources?: string[] | null;
  planner_metadata?: Array<{ source?: string | null; status?: string | null; round?: number | null }> | null;
  terminal_status?: string | null;
  rounds_completed?: number | null;
}

/** Per-candidate diagnostics from `company_first.items`, or a persisted row. */
export interface CandidateDiagnosticsSource {
  quotaEligible?: boolean | null;
  quota_eligible?: boolean | null;
  failedGates?: string[] | null;
  failed_gates?: string[] | null;
  employerMatch?: string | null;
  employer_match_status?: string | null;
  employer_match_reason?: string | null;
  persistenceReason?: string | null;
  persistence_reason?: string | null;
  decision_maker_status?: string | null;
  person?: string | null;
  round_number?: number | null;
}

const joinList = (v: unknown): string | null => {
  if (Array.isArray(v)) return v.length ? v.map((x) => String(x)).join(' · ') : null;
  if (typeof v === 'string' && v) return v;
  return null;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Build the diagnostics bag for one row.
 *
 * Account-only workflows pass `count_entity: 'account'` and simply have no
 * qualified-lead fields — they are emitted as null rather than faked.
 */
export function buildQualifiedLeadDiagnostics(
  run: RunDiagnosticsSource | null | undefined,
  candidate?: CandidateDiagnosticsSource | null,
): QualifiedLeadDiagnostics {
  const r = run ?? {};
  const c = candidate ?? {};
  const round = num(c.round_number) ?? num(r.rounds_completed);
  const planner = (r.planner_metadata ?? []).find((m) => m && (round == null || m.round === round))
    ?? (r.planner_metadata ?? [])[0]
    ?? null;

  const quotaEligible = typeof c.quotaEligible === 'boolean'
    ? c.quotaEligible
    : typeof c.quota_eligible === 'boolean' ? c.quota_eligible : null;

  // A verified person is the only thing that makes the decision-maker status
  // "verified"; a blank name is reported as missing, never left empty.
  const dmStatus = str(c.decision_maker_status)
    ?? (candidate ? (c.person ? 'verified' : 'missing') : null);

  return {
    original_user_query: str(r.original_user_query),
    parsed_intent_summary: str(r.parsed_intent_summary),
    workflow_kind: str(r.workflow_kind),
    execution_mode: str(r.execution_mode),
    job_family: str(r.job_family),
    job_titles: joinList(r.job_titles),
    company_vertical: str(r.company_vertical),
    company_stage: str(r.company_stage),
    requested_person_roles: joinList(r.requested_person_roles),
    requested_lead_count: num(r.requested_lead_count),
    count_entity: str(r.count_entity),
    quota_policy: str(r.quota_policy),
    provider_query_keywords: joinList(r.provider_query_keywords),
    provider_query_location: str(r.provider_query_location),
    planner_source: str(planner?.source) ?? joinList(r.plan_sources),
    planner_status: str(planner?.status),
    round_number: round,
    terminal_status: str(r.terminal_status),
    quota_eligible: quotaEligible,
    failed_gates: joinList(c.failedGates ?? c.failed_gates),
    employer_match_status: str(c.employerMatch) ?? str(c.employer_match_status),
    employer_match_reason: str(c.employer_match_reason),
    persistence_reason: str(c.persistenceReason) ?? str(c.persistence_reason),
    decision_maker_status: dmStatus,
  };
}

/**
 * Read the run context out of a company-first response (or a task result's
 * `company_first` block) plus the confirmed contract.
 */
export function runDiagnosticsFromResponse(
  response: Record<string, unknown> | null | undefined,
  contract?: Record<string, unknown> | null,
): RunDiagnosticsSource {
  const res = (response ?? {}) as Record<string, any>;

  // CANONICAL PATH. run-agent now emits one `run_context` built from what the
  // runtime actually did. When it is present it is copied verbatim — the
  // reconstruction below is only for responses that predate it.
  const rc = res.run_context ?? res.qualified_lead_run_context ?? null;
  if (rc && typeof rc === "object") {
    return {
      original_user_query: rc.original_user_query ?? null,
      parsed_intent_summary: rc.parsed_intent_summary ?? null,
      workflow_kind: rc.workflow_kind ?? null,
      execution_mode: rc.execution_mode ?? null,
      job_family: rc.job_family ?? null,
      job_titles: rc.job_titles ?? null,
      company_vertical: rc.company_vertical ?? null,
      company_stage: rc.company_stage ?? null,
      requested_person_roles: rc.requested_person_roles ?? null,
      requested_lead_count: rc.requested_lead_count ?? null,
      count_entity: rc.count_entity ?? null,
      quota_policy: rc.quota_policy ?? null,
      provider_query_keywords: rc.provider_query_keywords ?? null,
      provider_query_location: rc.provider_query_location ?? null,
      // Already resolved by the backend; kept as a single-entry list so the
      // per-round lookup below still finds it.
      planner_metadata: [{ round: rc.round_number ?? null, source: rc.planner_source ?? null, status: rc.planner_status ?? null }],
      plan_sources: rc.planner_source ? [rc.planner_source] : null,
      terminal_status: rc.terminal_status ?? null,
      rounds_completed: rc.round_number ?? null,
    };
  }

  const routing = (res.routing ?? {}) as Record<string, any>;
  const spec = (routing.job_search_spec ?? res.job_search ?? {}) as Record<string, any>;
  const ct = (contract ?? {}) as Record<string, any>;

  return {
    original_user_query: ct.original_instruction ?? routing.original_user_query ?? null,
    parsed_intent_summary: spec.compilation_status ?? null,
    workflow_kind: res.workflow_kind ?? ct.workflow_kind ?? null,
    execution_mode: res.executed_sourcing_mode ?? ct.execution_mode ?? null,
    job_family: ct.job_family ?? null,
    job_titles: ct.job_titles ?? null,
    company_vertical: ct.company_vertical ?? spec.company_vertical ?? null,
    company_stage: ct.company_stage ?? null,
    requested_person_roles: ct.requested_person_roles ?? (routing.requested_person_role ? [routing.requested_person_role] : null),
    requested_lead_count: res.requested_leads ?? ct.requested_lead_count ?? null,
    count_entity: res.count_entity ?? ct.count_entity ?? null,
    quota_policy: res.quota_policy ?? ct.quota_policy ?? null,
    provider_query_keywords: spec.keyword_queries ?? null,
    provider_query_location: spec.location ?? null,
    plan_sources: res.plan_sources ?? null,
    planner_metadata: res.planner_metadata ?? null,
    terminal_status: res.terminal_status ?? null,
    rounds_completed: res.rounds_completed ?? res.rounds_attempted ?? null,
  };
}

// ------------------------------------------------------------ CSV columns ----

/**
 * Diagnostics the lead export ALREADY had columns for. Re-adding them would
 * produce a duplicated CSV header, which readers resolve inconsistently.
 */
export const EXISTING_TRACE_COLUMNS: readonly QualifiedLeadDiagnosticField[] = [
  'original_user_query', 'parsed_intent_summary',
  'provider_query_keywords', 'provider_query_location', 'decision_maker_status',
];

/** The columns the export must ADD, in canonical order. */
export const QUALIFIED_LEAD_EXTRA_COLUMNS: QualifiedLeadDiagnosticField[] =
  QUALIFIED_LEAD_DIAGNOSTIC_FIELDS.filter((f) => !EXISTING_TRACE_COLUMNS.includes(f));

/** Cell values for `QUALIFIED_LEAD_EXTRA_COLUMNS`, in the same order. */
export function qualifiedLeadCells(
  run: RunDiagnosticsSource | null | undefined,
  candidate?: CandidateDiagnosticsSource | null,
): DiagnosticValue[] {
  const d = buildQualifiedLeadDiagnostics(run, candidate);
  return QUALIFIED_LEAD_EXTRA_COLUMNS.map((f) => d[f]);
}

/** Account-only runs: `count_entity: 'account'`, no CONTACT quota claim. */
export function accountOnlyDiagnostics(originalQuery: string | null): QualifiedLeadDiagnostics {
  return buildQualifiedLeadDiagnostics({
    original_user_query: originalQuery,
    workflow_kind: 'account_opportunity_sourcing',
    execution_mode: 'fast',
    count_entity: 'account',
  });
}
