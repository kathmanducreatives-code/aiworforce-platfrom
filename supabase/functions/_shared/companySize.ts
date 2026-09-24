// TWO LINKEDIN NUMBERS, TWO DIFFERENT FACTS.
//
// A LinkedIn company record carries two size figures, and they measure
// different things. They are NOT competing estimates of one staff count:
//
//   employeeCountRange  → the company's DECLARED SIZE BAND, set by the page
//                         owner in the About tab ("11-50 employees"). It is the
//                         field LinkedIn's own `companySize` search filter reads
//                         (HarvestAPI input schema: "filters by the company size
//                         specified in the company 'About' tab"), and it uses
//                         LinkedIn's size codes (B 1-10, C 11-50, D 51-200 …).
//                         → `company_size_band`
//
//   employeeCount       → LinkedIn ASSOCIATED MEMBERS: members who selected the
//                         company as a current position on their own profile.
//                         Freelancers, contributors, students, and name
//                         collisions count; staff without a profile do not. The
//                         row's `peopleStats` is a breakdown of the same members.
//                         → `linkedin_associated_member_count`
//
// Audit 2026-09-24 over 112 LinkedIn companies: the member count sat inside the
// declared band for 61, above it for 22 and BELOW it for 28 — a member count,
// not a mis-measured headcount. Braintrust (band 11-50, 390 members, 192 of
// them offering freelance services) is the shape of it.
//
// So a size criterion ("11–50 employees") is answered by the BAND, and only
// the band. The member count is informational: it never passes, fails or
// contests a size claim. An EXACT staff count ("exactly 27 employees") is
// answered by nothing in the catalogue — no source reports staff.
//
// Pure.

import { usableHeadcount } from "./headcountValue.ts";

/** A declared company-size band. `max: null` is open-ended ("10001+"). */
export interface CompanySizeBand {
  min: number;
  max: number | null;
  /** Whose declaration this is. */
  source: "linkedin_declared";
}

/** The band from a LinkedIn company payload's `employeeCountRange`, or null. */
export function linkedInDeclaredSizeBand(raw: Record<string, unknown> | null | undefined): CompanySizeBand | null {
  const er = raw?.employeeCountRange as Record<string, unknown> | undefined;
  if (!er || typeof er !== "object") return null;
  const min = typeof er.start === "number" && Number.isFinite(er.start) ? er.start : null;
  const max = typeof er.end === "number" && Number.isFinite(er.end) ? er.end : null;
  if (min === null) return null;
  if (max !== null && max < min) return null;
  return { min, max, source: "linkedin_declared" };
}

/** The LinkedIn associated-member count, or null. A zero is an absent number. */
export function linkedInAssociatedMemberCount(raw: Record<string, unknown> | null | undefined): number | null {
  return usableHeadcount(raw?.employeeCount);
}

export function sizeBandLabel(b: Pick<CompanySizeBand, "min" | "max">): string {
  return b.max === null ? `${b.min}+` : `${b.min}-${b.max}`;
}

/** Is this value a declared size band? */
export function isSizeBand(v: unknown): v is CompanySizeBand {
  const b = v as CompanySizeBand | null;
  return !!b && typeof b === "object" && typeof b.min === "number" &&
    (b.max === null || typeof b.max === "number");
}

export type BandVerdict = "pass" | "fail" | "unknown";

/**
 * Does a DECLARED band answer a requested employee range?
 *
 *   band fully inside the requested range        → pass
 *   band fully outside it                        → fail
 *   partial overlap (requested 20–80, band 11–50) → unknown: the band cannot
 *                                                   say which side it is on
 *   an exact staff count (min === max)           → unknown: a band never
 *                                                   proves an exact number
 *
 * The member count is not an input. That is the point.
 */
export function bandSatisfies(
  required: { min?: number | null; max?: number | null } | null | undefined,
  band: Pick<CompanySizeBand, "min" | "max">,
): { verdict: BandVerdict; reason: string } {
  const min = required?.min ?? null;
  const max = required?.max ?? null;
  const label = sizeBandLabel(band);
  if (min === null && max === null) return { verdict: "unknown", reason: "no employee range was requested" };
  if (min !== null && max !== null && min === max) {
    return {
      verdict: "unknown",
      reason: `an exact staff count (${min}) is not provable: the declared band ${label} is a range, ` +
        `and no catalogued source reports staff headcount`,
    };
  }
  const want = max === null ? `${min}+` : min === null ? `up to ${max}` : `${min}-${max}`;
  const bandMax = band.max ?? Infinity;
  const inside = (min === null || band.min >= min) && (max === null || bandMax <= max);
  if (inside) return { verdict: "pass", reason: `declared size band ${label} is within ${want}` };
  const outside = (max !== null && band.min > max) || (min !== null && bandMax < min);
  if (outside) return { verdict: "fail", reason: `declared size band ${label} is outside ${want}` };
  return {
    verdict: "unknown",
    reason: `declared size band ${label} only partly overlaps ${want}; the band cannot settle it`,
  };
}
