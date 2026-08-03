// THE PREVIEW READS THE MISSION — the same object run-agent executes.
//
// The confirmation card used to render `original_instruction` while the backend
// routed from a rewritten `instruction`. Both were "the request", they came from
// different layers, and on TEST task 8af17651-5fa2-48e2-af87-4bc923146243 they
// disagreed: the card said "SaaS startups", the backend resolved a general
// company route and swept LinkedIn Jobs. Nothing in the product could show that.
//
// This module projects the mission for display. It DERIVES nothing the backend
// would derive differently — `required_capabilities` is read straight off the
// mission, because pilot-chat filled it from the same capability graph run-agent
// builds. If this file ever needs to compute what will run, the mission is
// underspecified and the fix belongs upstream.
//
// PURE. No network, no imports from the edge runtime.

export interface MissionLike {
  version?: string;
  original_user_query?: string;
  mission_type?: string;
  target_entity?: string;
  requested_output?: string;
  requested_count?: number;
  company_profile?: {
    business_models?: string[];
    verticals?: string[];
    stages?: string[];
    locations?: string[];
    employee_range?: { min?: number; max?: number };
    known_companies?: string[];
  };
  required_signals?: Array<{ type?: string; role_families?: string[]; timeframe_days?: number }>;
  decision_makers?: { roles?: string[]; current_employment_required?: boolean };
  required_capabilities?: string[];
  prohibited_capabilities?: string[];
  field_provenance?: Record<string, string>;
  confidence?: number;
  brain_rejected_broadening?: Array<{ field?: string; values?: string[]; reason?: string }>;
  preflight_dry_run?: {
    mission_summary?: string;
    capability_order?: string[];
    first_provider?: string | null;
    input_summary?: string;
    estimated_cost_units?: number;
    ok?: boolean;
    blocked_reasons?: string[];
  };
}

/**
 * The preflight the BACKEND will run, carried on the mission.
 *
 * Read, never recomputed. This is the record that gates spending; showing a
 * separately-derived preview is how the card came to promise a plan the backend
 * had never seen.
 */
export function missionDryRun(m: MissionLike) {
  return m.preflight_dry_run ?? null;
}

export const LEAD_MISSION_VERSION = 'lead-mission-v1';

export function isMission(x: unknown): x is MissionLike {
  return !!x && typeof x === 'object' &&
    (x as MissionLike).version === LEAD_MISSION_VERSION &&
    typeof (x as MissionLike).original_user_query === 'string';
}

/** One labelled row on the card, with where the value came from. */
export interface MissionRow {
  key: string;
  label: string;
  value: string;
  /** Provenance code, when the field carries one. Rendered as a small tag. */
  provenance: string | null;
}

const PROVENANCE_LABEL: Record<string, string> = {
  explicit_user_request: 'you asked for this',
  workflow_edit: 'you edited this',
  company_brain: 'from your Company Brain',
  system_default: 'default',
  gpt_inference: 'inferred',
};

export function provenanceLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return PROVENANCE_LABEL[code] ?? code.replace(/_/g, ' ');
}

/** Turn a capability id into something a person reads. */
export function capabilityLabel(id: string): string {
  const known: Record<string, string> = {
    startup_company_discovery: 'Find startup companies',
    general_company_discovery: 'Find companies by profile',
    known_company_resolution: 'Use the companies you supplied',
    job_discovery: 'Find job postings',
    funding_signal_discovery: 'Find recently funded companies',
    expansion_signal_discovery: 'Find expanding companies',
    company_identity_resolution: 'Resolve company identity',
    company_enrichment: 'Enrich company data',
    hiring_verification: 'Verify the hiring signal',
    expansion_signal_verification: 'Verify the expansion signal',
    company_brain_qualification: 'Qualify against your Company Brain',
    founder_discovery: 'Find decision-makers',
    employer_verification: 'Verify current employer',
    contact_enrichment: 'Find a contact method',
    job_deduplication: 'Remove duplicate postings',
    persistence: 'Save to Workbench',
  };
  if (known[id]) return known[id];
  const w = id.replace(/_/g, ' ').trim();
  return w ? `${w.charAt(0).toUpperCase()}${w.slice(1)}` : id;
}

function list(xs: string[] | undefined): string {
  return (xs ?? []).filter(Boolean).join(', ');
}

/**
 * Project the mission into the card's rows.
 *
 * Fields the mission left empty are OMITTED rather than shown as "any" — a blank
 * row reads as a constraint the user forgot, and this card is the last place
 * they can correct one before money is spent.
 */
export function missionRows(m: MissionLike): MissionRow[] {
  const prov = m.field_provenance ?? {};
  const cp = m.company_profile ?? {};
  const rows: MissionRow[] = [];
  const push = (key: string, label: string, value: string, provKey?: string) => {
    if (!value) return;
    rows.push({ key, label, value, provenance: provKey ? (prov[provKey] ?? null) : null });
  };

  if ((cp.known_companies ?? []).length) {
    push('known', 'Companies you supplied', list(cp.known_companies), 'company_profile.known_companies');
  } else {
    const target = [list(cp.verticals), list(cp.stages)].filter(Boolean).join(' · ');
    push('target', 'Target companies', target || 'any', 'company_profile.verticals');
  }

  const signals = (m.required_signals ?? []).map((s) => {
    const fams = list(s.role_families);
    return fams ? `${s.type} (${fams})` : String(s.type ?? '');
  }).filter(Boolean);
  push('signal', 'Required signal', signals.join(', '), 'required_signals');

  const hiring = (m.required_signals ?? []).find((s) => s.type === 'hiring');
  push('role_family', 'Hiring role family', list(hiring?.role_families), 'required_signals');

  push('dm', 'Decision-makers', list(m.decision_makers?.roles), 'decision_makers.roles');
  push('geo', 'Geography', list(cp.locations), 'company_profile.locations');

  const er = cp.employee_range;
  if (er && (er.min != null || er.max != null)) {
    push('size', 'Employee range',
      `${er.min ?? 0}–${er.max ?? '∞'}`, 'company_profile.employee_range');
  }

  push('count', 'Requested leads', m.requested_count != null ? String(m.requested_count) : '', 'requested_count');

  return rows;
}

/** The capability chain, in execution order, for display. */
export function missionCapabilities(m: MissionLike): string[] {
  return (m.required_capabilities ?? []).map(capabilityLabel);
}

/**
 * Brain values that were NOT applied because they would widen the request.
 *
 * Surfaced deliberately: the user asked for SaaS startups and their Brain also
 * targets Recruiting Agencies. Silently adding it corrupts the list; silently
 * dropping it hides a real option. The card states it and lets them choose.
 */
export function missionRejectedBroadening(m: MissionLike): string[] {
  return (m.brain_rejected_broadening ?? [])
    .map((r) => {
      const vals = (r.values ?? []).filter(Boolean).join(', ');
      return vals ? `${vals} (${r.reason ?? 'outside your request'})` : '';
    })
    .filter(Boolean);
}
