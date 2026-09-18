// A HEADCOUNT IS A POSITIVE NUMBER, OR IT IS UNKNOWN.
//
// LinkedIn reports `employeeCount: 0` for a company page with no number on it.
// Read as a count, that zero became VERIFIED evidence: canary c584fd77 ruled
// Dime9 ineligible on "headcount 0 is outside 1–150" — a missing value treated
// as a proven contradiction. No company has zero employees; a zero, a negative
// or a non-number is the absence of a count, and absence is never proof.
//
// Applied where a count ENTERS (every normalizer) and again where one DECIDES
// (the evidence registry, the observation, eligibility), so no path can turn a
// missing number into a rejection. Pure.

export function usableHeadcount(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}
