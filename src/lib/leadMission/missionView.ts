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
  /**
   * The mission's criteria with their provenance, as pilot-chat derives them
   * after the Company Brain merge (`deriveMissionCriteria`). The card's source
   * of truth for who asked for what; its `criteria_sections` lines are the same
   * criteria as display text. Absent on missions compiled before P1.
   */
  criteria?: MissionCriterionLike[];
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
    /**
     * WHAT THE RUN ESTABLISHES, mirroring `PreflightDryRun` in
     * _shared/leadPaidExecutionPreflight.ts. The capability list says what will
     * RUN; these say what will be PROVEN. WorkflowConfirmationCard already
     * rendered all three — only this type lagged.
     *
     * Optional here, required there: pilot-chat carries the field as `unknown`
     * and missions compiled before these existed have no such key.
     */
    proves?: Array<{ requirement: string; by_capability: string }>;
    will_not_establish?: Array<{ requirement: string; status: string; why: string }>;
    requires_unlock?: Array<{ requirement: string; why: string }>;
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

/**
 * P1 — the card's criteria sections, computed by the backend from the mission
 * (`_shared/missionCriteria.ts`). Rendered verbatim: the frontend never
 * re-derives meaning.
 */
export interface CriteriaSections {
  version?: string;
  hard: string[];
  target: string[];
  opportunity_signals: string[];
  hypotheses: string[];
  time_windows: string[];
  unsupported: string[];
}

export const CRITERIA_SECTION_LABELS: ReadonlyArray<readonly [Exclude<keyof CriteriaSections, 'version'>, string]> = [
  ['hard', 'Hard constraints'],
  ['target', 'Target criteria'],
  ['opportunity_signals', 'Opportunity signals'],
  ['hypotheses', 'Hypotheses / assumptions'],
  ['time_windows', 'Time windows'],
  ['unsupported', 'Unsupported / unprovable'],
];

export function criteriaSectionsOf(payload: unknown): CriteriaSections | null {
  const s = (payload as { criteria_sections?: unknown } | null)?.criteria_sections;
  if (!s || typeof s !== 'object') return null;
  const out = {} as CriteriaSections;
  for (const [key] of CRITERIA_SECTION_LABELS) {
    const v = (s as Record<string, unknown>)[key];
    out[key] = Array.isArray(v) ? v.map(String).filter(Boolean) : [];
  }
  return CRITERIA_SECTION_LABELS.some(([k]) => out[k].length > 0) ? out : null;
}

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

// ── THE CARD'S CRITERIA ──────────────────────────────────────────────────────
//
// WHO ASKED FOR WHAT comes from the mission's own `criteria`, each of which
// carries its `source` — the backend's structured record. The
// `criteria_sections` lines are the same criteria as display text,
// `<label> · <qualifiers / notes…> · <source>`, and supply the wording, the
// signal kind, the windows and any explanation the backend attached.
//
// A line's source is read from ANY segment, not only the last: the backend may
// place an explanation beside it (a Company Brain industry that "also chooses
// which companies are searched"), and that must never erase where the
// criterion came from. Missions compiled before P1 have no structured
// criteria; their lines alone decide, the same way.
//
// A criterion whose source cannot be established is a request detail — never
// the person's own.

export type CriterionOrigin = 'user' | 'added' | 'unspecified';

/** A criterion as the mission carries it (`MissionCriterion`, display fields only). */
export interface MissionCriterionLike {
  id?: string;
  kind?: string;
  dimension?: string;
  label?: string;
  source?: string;
  status?: string;
  time_window?: { days?: number; source?: string };
}

export interface CardCriterion {
  section: Exclude<keyof CriteriaSections, 'version'>;
  /** The line's own words, without its source or notes: "Geography: United States", "Hiring: sales". */
  text: string;
  origin: CriterionOrigin;
  /** The backend's source wording ("you said this", "from your Company Brain", …), when known. */
  source: string | null;
  /** For a signal line: "required" (true) or "target" (false); null otherwise. */
  required: boolean | null;
  /**
   * A signal's time window. Windows are enforced: the hiring verifier drops
   * postings dated outside it, and an undated posting proves nothing (#44).
   */
  window: { days: number; source: string | null } | null;
  /** An explanation the backend attached, shown beside the criterion, not as part of it. */
  note: string | null;
}

const SOURCE_ORIGIN: Record<string, CriterionOrigin> = {
  'you said this': 'user',
  inferred: 'added',
  'Company Brain rule': 'added',
  'from your Company Brain': 'added',
  default: 'added',
};

/** The backend's `CriterionSource` codes, worded as its lines word them. */
const STRUCTURED_SOURCE: Record<string, { label: string; origin: CriterionOrigin }> = {
  user_explicit: { label: 'you said this', origin: 'user' },
  user_inferred: { label: 'inferred', origin: 'added' },
  company_brain_policy: { label: 'Company Brain rule', origin: 'added' },
  company_brain_preference: { label: 'from your Company Brain', origin: 'added' },
  system_default: { label: 'default', origin: 'added' },
};

// Markers the backend appends for a section's meaning; never part of the words.
// "shown, not yet enforced" appears only on cards compiled before #44 — that
// window is enforced now — so it is recognised and dropped.
const RANKS_ONLY = 'can rank, never reject';
const LINE_MARKERS = new Set([RANKS_ONLY, 'to be tested, never required', 'shown, not yet enforced']);

/** Explanations the backend attaches to a criterion (#46): shown beside it. */
const EXPLANATION_RE = /^also chooses which companies are searched\b/i;

function sourceOf(token: string): { label: string; origin: CriterionOrigin } | null {
  if (SOURCE_ORIGIN[token]) return { label: token, origin: SOURCE_ORIGIN[token] };
  if (/^inferred \(confidence [\d.]+\)$/.test(token)) return { label: token, origin: 'added' };
  if (/^default for /.test(token)) return { label: 'default', origin: 'added' };
  return null;
}

/**
 * One backend criteria line, split into its words, source, signal kind, markers
 * and explanation. The first segment is always the criterion itself; every
 * other segment is classified wherever it sits, and anything unrecognised stays
 * with the words.
 */
export function readCriterionLine(line: string): {
  text: string; source: string | null; origin: CriterionOrigin; required: boolean | null;
  notes: string[]; explanation: string | null;
} {
  const [head, ...rest] = String(line ?? '').split(' · ');
  const words: string[] = [head];
  let source: { label: string; origin: CriterionOrigin } | null = null;
  let required: boolean | null = null;
  const notes: string[] = [];
  let explanation: string | null = null;
  for (const seg of rest) {
    const s = !source ? sourceOf(seg) : null;
    if (s) { source = s; continue; }
    if (seg === 'required' || seg === 'target') { required = seg === 'required'; continue; }
    if (LINE_MARKERS.has(seg)) { notes.push(seg); continue; }
    if (!explanation && EXPLANATION_RE.test(seg)) { explanation = seg; continue; }
    words.push(seg);
  }
  return {
    text: words.join(' · '), source: source?.label ?? null, origin: source?.origin ?? 'unspecified',
    required, notes, explanation,
  };
}

const labelOf = (text: string) => text.split(':')[0].trim().toLowerCase();

/** The mission's criterion a line was written from: its exact label, or the label followed by qualifiers. */
function structuredFor(text: string, list: readonly MissionCriterionLike[]): MissionCriterionLike | null {
  const exact = list.find((c) => c.label === text);
  if (exact) return exact;
  return list.find((c) => !!c.label && text.startsWith(`${c.label} · `)) ?? null;
}

/**
 * The card's criteria: what the person asked for, what Agentory added, request
 * details whose source is not known, what only ranks or is assumed, and what
 * cannot be verified — each signal with its window.
 *
 * `structured` is the mission's `criteria`; when a line's criterion is there,
 * its `source` decides the group.
 */
export function cardCriteria(s: CriteriaSections | null, structured: readonly MissionCriterionLike[] | null = null): {
  user: CardCriterion[]; added: CardCriterion[]; details: CardCriterion[]; considered: CardCriterion[]; unsupported: string[];
} {
  const out = {
    user: [] as CardCriterion[], added: [] as CardCriterion[], details: [] as CardCriterion[],
    considered: [] as CardCriterion[], unsupported: [] as string[],
  };
  if (!s) return out;
  const list = Array.isArray(structured) ? structured : [];
  const windows = s.time_windows.map((line) => {
    const r = readCriterionLine(line);
    const m = r.text.match(/^(.*?):\s*last (\d+) days$/);
    return m ? { label: m[1].trim().toLowerCase(), days: Number(m[2]), source: r.source } : null;
  }).filter((w): w is NonNullable<typeof w> => !!w);
  for (const section of ['hard', 'target', 'opportunity_signals', 'hypotheses'] as const) {
    for (const line of s[section]) {
      const r = readCriterionLine(line);
      const sc = section === 'hypotheses' ? null : structuredFor(r.text, list);
      const known = sc?.source ? STRUCTURED_SOURCE[sc.source] : undefined;
      const origin = known?.origin ?? r.origin;
      // Keep the line's own wording ("inferred (confidence 0.80)") when it agrees.
      const source = known ? (r.origin === known.origin && r.source ? r.source : known.label) : r.source;
      let window: CardCriterion['window'] = null;
      if (section === 'opportunity_signals') {
        const w = windows.find((x) => x.label === labelOf(r.text));
        const tw = sc?.time_window;
        window = w ? { days: w.days, source: w.source }
          : tw?.days ? { days: tw.days, source: (tw.source && STRUCTURED_SOURCE[tw.source]?.label) || null } : null;
      }
      const c: CardCriterion = { section, text: r.text, origin, source, required: r.required, window, note: r.explanation };
      if (section === 'hypotheses' || r.notes.includes(RANKS_ONLY)) out.considered.push(c);
      else if (origin === 'unspecified') out.details.push(c);
      else out[origin].push(c);
    }
  }
  out.unsupported = [...s.unsupported];
  return out;
}

/** A backend explanation, worded for the card: "Also chooses which companies are searched (LinkedIn: …)". */
export function criterionNote(c: CardCriterion): string | null {
  if (!c.note) return null;
  const n = c.note.trim();
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : null;
}

/** "last 730 days" as a person says it: 24 months, 3 months, 30 days. */
export function humanWindow(days: number): string {
  if (days >= 365 && days % 365 === 0) return `${(days / 365) * 12} months`;
  if (days >= 60 && days % 30 === 0) return `${days / 30} months`;
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/**
 * A criterion in plain words for the card: a field's value ("United States",
 * "11–50 employees"), a signal with its window ("Hiring sales in the last 30
 * days").
 */
export function criterionPhrase(c: CardCriterion): string {
  if (c.section === 'opportunity_signals') {
    const what = c.text.replace(/:\s*/, ' ');
    return c.window ? `${what} in the last ${humanWindow(c.window.days)}` : what;
  }
  const i = c.text.indexOf(': ');
  return i > 0 && c.section !== 'hypotheses' ? c.text.slice(i + 2) : c.text;
}

/**
 * The backend's generic company title with its count agreeing: "Find 1
 * companies" reads "Find 1 company". Any other title is shown as written.
 */
export function missionTitle(m: MissionLike | null, title: string): string {
  const n = m?.requested_count;
  const t = title.trim();
  // "Find 1 companies" and "Find 1 companies in b2b saas, …" — the backend's
  // title appends the industries the search is scoped to.
  if (m?.target_entity !== 'company' || n !== 1 || !/^Find 1 companies(?: in |$)/.test(t)) return title;
  return t.replace(/^Find 1 companies/, 'Find 1 company');
}
