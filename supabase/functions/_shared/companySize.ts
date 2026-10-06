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

/**
 * EVERY SIZE BAND A COMPANY CAN DECLARE ON LINKEDIN — the only size evidence any
 * catalogued source returns (`employeeCountRange`). LinkedIn's codes B–I; some
 * actors report the smallest band as 1–10 and others as 2–10, so both appear.
 */
export const DECLARED_SIZE_BANDS: ReadonlyArray<Pick<CompanySizeBand, "min" | "max">> = Object.freeze([
  { min: 1, max: 10 }, { min: 2, max: 10 }, { min: 11, max: 50 }, { min: 51, max: 200 },
  { min: 201, max: 500 }, { min: 501, max: 1000 }, { min: 1001, max: 5000 },
  { min: 5001, max: 10000 }, { min: 10001, max: null },
]);

/**
 * CAN ANY DECLARED BAND PROVE THIS RANGE?
 *
 * A requested range is provable when at least one band lies inside it, because
 * only then can a company's declared band PASS it. "20–100", "25–75", "11–15"
 * and an exact count ("exactly 17") cut across bands: a company inside them
 * declares a band that only partly overlaps, so every candidate stays unknown
 * forever. `overlapping` names the bands the user could choose instead — never
 * applied silently.
 */
export function sizeRangeProvable(
  required: { min?: number | null; max?: number | null } | null | undefined,
): { provable: boolean; overlapping: string[] } {
  const min = required?.min ?? null, max = required?.max ?? null;
  // Overlap is geometric: an exact count's verdict is "unknown" for EVERY band.
  const overlaps = (b: Pick<CompanySizeBand, "min" | "max">) =>
    (max === null || b.min <= max) && (min === null || (b.max ?? Infinity) >= min);
  const overlapping = DECLARED_SIZE_BANDS.filter(overlaps).map(sizeBandLabel);
  return {
    provable: DECLARED_SIZE_BANDS.some((b) => bandSatisfies(required, b).verdict === "pass"),
    // 1–10 and 2–10 are the same LinkedIn band under two spellings; name it once.
    overlapping: overlapping.filter((l) => !(l === "2-10" && overlapping.includes("1-10"))),
  };
}
