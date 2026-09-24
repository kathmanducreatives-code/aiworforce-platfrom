// COMPANY SIZE, AS THE WORKBENCH SHOWS IT.
//
// Mirrors `supabase/functions/_shared/companySize.ts`. A LinkedIn company
// record carries two figures that measure DIFFERENT things:
//
//   employeeCountRange → the company's DECLARED size band ("11-50") — the
//                        figure a mission's "N–M employees" is about;
//   employeeCount      → LinkedIn ASSOCIATED MEMBERS — people who list the
//                        company on their own profile. Freelancers, students
//                        and alumni count; staff without a profile do not.
//
// So the Workbench shows the band as the company's size, and the member count
// only ever as "LinkedIn members" — never as employees, never as headcount.
//
// Rows persisted before 2026-09-24 carry a single `employee_count` that was
// usually the member count. It is shown as a REPORTED figure, labelled as
// unverified, and never offered as the company's size.

export interface DeclaredBand {
  min: number;
  max: number | null;
}

export interface CompanySizeFacts {
  /** The company's DECLARED LinkedIn size band. */
  declared_band: DeclaredBand | null;
  /** LinkedIn associated members — NOT a staff count. */
  linkedin_members: number | null;
  /** A YC directory's self-reported team size. */
  self_reported_team_size: number | null;
  /** A pre-2026-09-24 row's single `employee_count`: a reported figure of unknown kind. */
  legacy_reported_count: number | null;
}

export const LINKEDIN_MEMBERS_HINT =
  'People who list this company on their LinkedIn profile (including freelancers and alumni) — not a staff count.';

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;

/** A declared band from `{min,max}`, LinkedIn's `{start,end}`, or a "11-50" / "10001+" label. */
export function parseDeclaredBand(v: unknown): DeclaredBand | null {
  if (typeof v === 'string') {
    const t = v.trim();
    let m = /^(\d[\d,]*)\s*[-–]\s*(\d[\d,]*)$/.exec(t);
    if (m) {
      const min = Number(m[1].replace(/,/g, ''));
      const max = Number(m[2].replace(/,/g, ''));
      return max >= min ? { min, max } : null;
    }
    m = /^(\d[\d,]*)\s*\+$/.exec(t);
    return m ? { min: Number(m[1].replace(/,/g, '')), max: null } : null;
  }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const min = typeof o.min === 'number' ? o.min : typeof o.start === 'number' ? o.start : null;
  const rawMax = 'max' in o ? o.max : o.end;
  const max = typeof rawMax === 'number' ? rawMax : null;
  if (min === null || !Number.isFinite(min)) return null;
  if (max !== null && max < min) return null;
  return { min, max };
}

export function bandLabel(b: DeclaredBand): string {
  return b.max === null ? `${b.min.toLocaleString()}+` : `${b.min.toLocaleString()}–${b.max.toLocaleString()}`;
}

/** The company's size, as text — the declared band first. Null when nothing is known. */
export function companySizeText(f: CompanySizeFacts): string | null {
  if (f.declared_band) return `${bandLabel(f.declared_band)} employees (declared)`;
  if (f.self_reported_team_size !== null) return `~${f.self_reported_team_size.toLocaleString()} (YC self-reported)`;
  if (f.legacy_reported_count !== null) return `${f.legacy_reported_count.toLocaleString()} reported (unverified)`;
  return null;
}

export function linkedinMembersText(n: number | null): string | null {
  return n === null ? null : `${n.toLocaleString()} LinkedIn members`;
}

/**
 * Read the size facts off any row shape the Workbench receives: an evaluation
 * row (`company_size_band` label), a persisted candidate's raw payload (the
 * enrichment evidence projection), or a legacy row with only `employee_count`.
 */
export function readCompanySizeFacts(r: Record<string, unknown> | null | undefined): CompanySizeFacts {
  const row = r ?? {};
  const ee = (row.enrichment_evidence && typeof row.enrichment_evidence === 'object')
    ? row.enrichment_evidence as Record<string, unknown> : {};
  const declared = parseDeclaredBand(row.company_size_band) ?? parseDeclaredBand(ee.company_size_band);
  const members = num(row.linkedin_associated_members) ?? num(row.linkedin_associated_member_count) ??
    num(ee.linkedin_associated_member_count);
  const newShape = declared !== null || members !== null ||
    'company_size_band' in row || 'linkedin_associated_members' in row || 'company_size_band' in ee;
  return {
    declared_band: declared,
    linkedin_members: members,
    self_reported_team_size: num(row.self_reported_team_size),
    // A row that already carries the split names it; only a row from BEFORE the
    // split has a bare `employee_count` to fall back on.
    legacy_reported_count: num(row.legacy_reported_count) ?? (newShape ? null : num(row.employee_count)),
  };
}

/**
 * Is the declared band wholly inside [lo, hi]? A partial overlap is not a match.
 * An `hi` of MAX_SAFE_INTEGER or more is open-ended, so "10001+" sits inside it.
 */
export function declaredBandWithin(b: DeclaredBand | null, lo: number, hi: number): boolean {
  if (!b) return false;
  if (b.min < lo) return false;
  if (hi >= Number.MAX_SAFE_INTEGER) return true;
  return b.max !== null && b.max <= hi;
}
