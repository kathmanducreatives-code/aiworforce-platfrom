// FILTERING THE ACTIVE WORKBENCH RESULT SET.
//
// ── WHAT THIS IS A FORWARD PORT OF ─────────────────────────────────────────
//
// The Workbench itself never had more than two filters: `Has website` and the
// `Fit 60/75/90` chips, present unchanged since `ada8c9dc`. The richer filter
// UX is the Lead Library's (`components/leads/library/Toolbar.tsx` +
// `FilterBar.tsx`, `10be6305`) — search, decision, lifecycle, fit, buyer,
// industry, source, with a Reset and removable chips. That is a DIFFERENT
// surface over a DIFFERENT row type (`LeadRow`), and it is still live at
// `/leads`. This module brings that filter model to the Workbench's own rows
// without importing any of it, because none of its fields exist here.
//
// ── WHAT DID NOT SURVIVE THE MAPPING, AND WHY ──────────────────────────────
//
//   decision   contact / watch / needs_review / skip
//              OMITTED. The Workbench tabs already are this axis — Qualified /
//              In review / Ruled out / Not reached. A second control saying the
//              same thing could contradict the tab it sits under.
//   lifecycle  research_needed → replied → meeting
//              OMITTED. Those are CRM stages the Library tracks after a lead is
//              saved. A run's rows have not entered that lifecycle yet, and a
//              filter that always matches everything is not a filter.
//   buyer      verified / needs_review / missing
//              KEPT, as `contact` — `contact_status` is the same fact under the
//              name this surface uses for it.
//
// ── AND ONE FILTER THAT IS NOT WHAT ITS NAME MIGHT SUGGEST ─────────────────
//
// `hiring` reads the JOB EVIDENCE ON THE ROW, not the engine's `HiringStage`.
// The stage (`verified` / `evidence_unavailable` / …) lives in the lineage
// checkpoint and is not projected onto a persisted lead row — there is no
// `hiring_status` field on `LeadTableRow` to read. So this filter answers "does
// this row carry a hiring signal we can show you?" and is labelled that way. It
// does not claim the engine verified anything.
//
// Pure — no React, no network, no `@/` alias (these tests run under `deno test`
// with no import map).

/** The subset of a Workbench row this module reads. Structural on purpose. */
export interface FilterableLead {
  company_name?: string | null;
  company_location?: string | null;
  website?: string | null;
  company_linkedin_url?: string | null;
  company_description?: string | null;
  industries?: string[];
  employee_count?: number | null;
  fit_score?: number | null;
  final_overall_fit?: number | null;
  signal_type?: string | null;
  signal_summary?: string | null;
  found_via?: string | null;
  job_title?: string | null;
  job_url?: string | null;
  contact_status?: string | null;
  contact_name?: string | null;
  why_this_lead?: string | null;
  icp_fit_summary?: string | null;
  evidence_summary?: string | null;
}

export type SizeBandId = 'any' | 'micro' | 'smb' | 'mid' | 'large';
export type HiringFilter = 'any' | 'has_signal' | 'no_signal';
export type ContactFilter = 'any' | 'ready' | 'needed';

export interface WorkbenchFilters {
  /** Free text across the fields a reader would actually search by. */
  q: string;
  /** Matched as a case-insensitive substring of `company_location`. */
  location: string | 'any';
  /** One entry of `industries`, matched exactly. */
  industry: string | 'any';
  size: SizeBandId;
  hiring: HiringFilter;
  contact: ContactFilter;
  /** `signal_type` or, absent that, `found_via`. */
  source: string | 'any';
  /** 0 means off. Kept as the existing Fit chips, not a new control. */
  minFit: number;
  /** Kept as the existing `Has website` toggle. */
  hasWebsite: boolean;
}

export const EMPTY_WORKBENCH_FILTERS: Readonly<WorkbenchFilters> = Object.freeze({
  q: '',
  location: 'any',
  industry: 'any',
  size: 'any',
  hiring: 'any',
  contact: 'any',
  source: 'any',
  minFit: 0,
  hasWebsite: false,
});

/**
 * Headcount bands.
 *
 * `20–200` is a band rather than a boundary between two because it is the range
 * the product's own missions are written in — the live B2B SaaS mission carries
 * `employee_range` 20–200 — so the most common question a reader has is
 * expressible in one click instead of two.
 */
export const SIZE_BANDS: ReadonlyArray<{ id: SizeBandId; label: string; min: number; max: number }> =
  Object.freeze([
    { id: 'micro', label: '1–19', min: 1, max: 19 },
    { id: 'smb', label: '20–200', min: 20, max: 200 },
    { id: 'mid', label: '201–1000', min: 201, max: 1000 },
    { id: 'large', label: '1000+', min: 1001, max: Number.MAX_SAFE_INTEGER },
  ]);

export const HIRING_LABEL: Readonly<Record<HiringFilter, string>> = Object.freeze({
  any: 'Any hiring signal',
  has_signal: 'Has hiring signal',
  no_signal: 'No hiring signal',
});

export const CONTACT_LABEL: Readonly<Record<ContactFilter, string>> = Object.freeze({
  any: 'Any contact',
  ready: 'Contact found',
  needed: 'Contact needed',
});

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** A row carries a hiring signal when the job evidence is actually on it. */
export function hasHiringSignal(r: FilterableLead): boolean {
  return !!(text(r.job_title) || text(r.job_url));
}

/** The score a filter compares against — the gate's final answer wins. */
export function effectiveFit(r: FilterableLead): number {
  const final = typeof r.final_overall_fit === 'number' ? r.final_overall_fit : null;
  const base = typeof r.fit_score === 'number' ? r.fit_score : null;
  return final ?? base ?? 0;
}

export function sourceOf(r: FilterableLead): string {
  return text(r.signal_type) || text(r.found_via);
}

/**
 * The country-ish tail of a free-text location.
 *
 * `company_location` arrives as "London, England, United Kingdom". Listing every
 * distinct value gives a menu with one entry per city; the trailing segment is
 * the level a reader filters at. Matching is then a substring, so the option
 * "United Kingdom" selects every UK row whatever precedes it.
 */
export function locationBucket(v: string | null | undefined): string {
  const s = text(v);
  if (!s) return '';
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : s;
}

export interface FilterOptions {
  locations: string[];
  industries: string[];
  sources: string[];
}

/**
 * The option lists, derived from the rows on screen.
 *
 * Never a fixed vocabulary: a run that found no UK companies must not offer a
 * `United Kingdom` filter that can only ever return nothing.
 */
export function filterOptionsFrom(rows: readonly FilterableLead[]): FilterOptions {
  const locations = new Set<string>();
  const industries = new Set<string>();
  const sources = new Set<string>();
  for (const r of rows) {
    const loc = locationBucket(r.company_location);
    if (loc) locations.add(loc);
    for (const i of r.industries ?? []) {
      const s = text(i);
      if (s) industries.add(s);
    }
    const src = sourceOf(r);
    if (src) sources.add(src);
  }
  const sort = (s: Set<string>) => Array.from(s).sort((a, b) => a.localeCompare(b));
  return { locations: sort(locations), industries: sort(industries), sources: sort(sources) };
}

function matchesQuery(r: FilterableLead, q: string): boolean {
  const hay = [
    r.company_name, r.company_location, r.website, r.company_linkedin_url,
    r.company_description, (r.industries ?? []).join(' '),
    r.job_title, r.signal_type, r.signal_summary, r.found_via,
    r.contact_name, r.why_this_lead, r.icp_fit_summary, r.evidence_summary,
  ].filter((v): v is string => typeof v === 'string' && v.length > 0)
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

function matchesSize(r: FilterableLead, band: SizeBandId): boolean {
  if (band === 'any') return true;
  const n = typeof r.employee_count === 'number' ? r.employee_count : null;
  // An UNKNOWN headcount is not a match for a headcount band. Treating it as one
  // would put companies of unknown size inside "20–200" and make the count a
  // claim the data does not support.
  if (n === null) return false;
  const b = SIZE_BANDS.find((x) => x.id === band);
  return !!b && n >= b.min && n <= b.max;
}

/**
 * Apply every active filter. AND across axes, as the toolbar reads.
 *
 * Takes and returns the SAME rows it was given — never a copy with fields
 * added, never a mutation. Nothing here writes.
 */
export function applyWorkbenchFilters<T extends FilterableLead>(
  rows: readonly T[],
  f: WorkbenchFilters,
): T[] {
  const q = f.q.trim().toLowerCase();
  const loc = f.location === 'any' ? '' : f.location.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.hasWebsite && !text(r.website)) return false;
    if (f.minFit > 0 && effectiveFit(r) < f.minFit) return false;
    if (q && !matchesQuery(r, q)) return false;
    if (loc && !text(r.company_location).toLowerCase().includes(loc)) return false;
    if (f.industry !== 'any' && !(r.industries ?? []).some((i) => text(i) === f.industry)) return false;
    if (!matchesSize(r, f.size)) return false;
    if (f.hiring === 'has_signal' && !hasHiringSignal(r)) return false;
    if (f.hiring === 'no_signal' && hasHiringSignal(r)) return false;
    if (f.contact === 'ready' && text(r.contact_status) === 'needs_contact') return false;
    if (f.contact === 'needed' && text(r.contact_status) !== 'needs_contact') return false;
    if (f.source !== 'any' && sourceOf(r) !== f.source) return false;
    return true;
  });
}

/** How many axes are narrowing the view. Drives the badge and the Clear button. */
export function activeFilterCount(f: WorkbenchFilters): number {
  let n = 0;
  if (f.q.trim()) n++;
  if (f.location !== 'any') n++;
  if (f.industry !== 'any') n++;
  if (f.size !== 'any') n++;
  if (f.hiring !== 'any') n++;
  if (f.contact !== 'any') n++;
  if (f.source !== 'any') n++;
  if (f.minFit > 0) n++;
  if (f.hasWebsite) n++;
  return n;
}

export function hasActiveFilters(f: WorkbenchFilters): boolean {
  return activeFilterCount(f) > 0;
}

/** One removable chip per narrowed axis, in the order the toolbar lays them out. */
export interface FilterChip {
  key: keyof WorkbenchFilters;
  label: string;
}

export function filterChips(f: WorkbenchFilters): FilterChip[] {
  const chips: FilterChip[] = [];
  if (f.q.trim()) chips.push({ key: 'q', label: `“${f.q.trim()}”` });
  if (f.location !== 'any') chips.push({ key: 'location', label: f.location });
  if (f.industry !== 'any') chips.push({ key: 'industry', label: f.industry });
  if (f.size !== 'any') {
    const b = SIZE_BANDS.find((x) => x.id === f.size);
    if (b) chips.push({ key: 'size', label: `${b.label} employees` });
  }
  if (f.hiring !== 'any') chips.push({ key: 'hiring', label: HIRING_LABEL[f.hiring] });
  if (f.contact !== 'any') chips.push({ key: 'contact', label: CONTACT_LABEL[f.contact] });
  if (f.source !== 'any') chips.push({ key: 'source', label: f.source });
  if (f.minFit > 0) chips.push({ key: 'minFit', label: `Fit ${f.minFit}+` });
  if (f.hasWebsite) chips.push({ key: 'hasWebsite', label: 'Has website' });
  return chips;
}

/** Reset ONE axis back to its default, leaving the rest alone. */
export function clearFilterKey(f: WorkbenchFilters, key: keyof WorkbenchFilters): WorkbenchFilters {
  return { ...f, [key]: EMPTY_WORKBENCH_FILTERS[key] } as WorkbenchFilters;
}
