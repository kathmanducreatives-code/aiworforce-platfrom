// DETERMINISTIC FUNNEL SUMMARY + BOTTLENECK CLASSIFIER.
//
// Round selection used to be `round === 2`. That cannot tell "we found no relevant
// jobs" from "we found plenty of companies but no people". The next action is now
// chosen from a MEASURED funnel, so widening targets the actual constriction.

export type BottleneckKind =
  | "insufficient_raw_jobs" | "title_coverage" | "company_qualification" | "company_identity"
  | "people_coverage" | "person_role_precision" | "employer_verification"
  | "duplicate_saturation" | "budget" | "quota_reached" | "search_exhausted";

export interface FunnelSummary {
  raw_jobs: number;
  unique_jobs: number;
  job_family_pass: number;
  job_family_fail: number;
  companies_qualified: number;
  companies_rejected: number;
  companies_missing_identity: number;
  people_calls: number;
  profiles_returned: number;
  person_role_pass: number;
  employer_verified: number;
  employer_ambiguous: number;
  contact: number;
  watch: number;
  reject: number;
  duplicates_removed: number;
  rejection_reason_counts: Record<string, number>;
}

export function emptyFunnelSummary(): FunnelSummary {
  return {
    raw_jobs: 0, unique_jobs: 0, job_family_pass: 0, job_family_fail: 0,
    companies_qualified: 0, companies_rejected: 0, companies_missing_identity: 0,
    people_calls: 0, profiles_returned: 0, person_role_pass: 0,
    employer_verified: 0, employer_ambiguous: 0, contact: 0, watch: 0, reject: 0,
    duplicates_removed: 0, rejection_reason_counts: {},
  };
}

export interface BottleneckResult { kind: BottleneckKind; reason: string; }

/**
 * Pick the FIRST constriction in funnel order — fixing a later stage is pointless
 * while an earlier one is starving it.
 */
export function classifyBottleneck(
  f: FunnelSummary,
  ctx: { remainingQuota: number; budgetRemaining: number; expansionAvailable: boolean },
): BottleneckResult {
  if (ctx.remainingQuota <= 0) return { kind: "quota_reached", reason: "requested quota satisfied" };
  if (ctx.budgetRemaining <= 0) return { kind: "budget", reason: "no budget left for another round" };

  if (f.raw_jobs === 0) return { kind: "insufficient_raw_jobs", reason: "the jobs actor returned nothing" };
  if (f.unique_jobs > 0 && f.duplicates_removed / Math.max(1, f.unique_jobs + f.duplicates_removed) > 0.6) {
    return { kind: "duplicate_saturation", reason: "most results repeat earlier rounds — widen coverage, not titles" };
  }
  if (f.job_family_pass === 0) {
    return { kind: "title_coverage", reason: "no returned job matched the requested family — title coverage is too narrow" };
  }
  if (f.companies_qualified === 0) {
    return { kind: "company_qualification", reason: "relevant jobs found but no company passed the vertical gate" };
  }
  if (f.companies_missing_identity > f.companies_qualified / 2) {
    return { kind: "company_identity", reason: "most qualified companies lack a resolvable LinkedIn/domain identity" };
  }
  if (f.people_calls === 0 || f.profiles_returned === 0) {
    return { kind: "people_coverage", reason: "qualified companies exist but produced no profiles" };
  }
  if (f.person_role_pass === 0) {
    return { kind: "person_role_precision", reason: "profiles returned but none held the requested role" };
  }
  if (f.employer_verified === 0 && f.employer_ambiguous > 0) {
    return { kind: "employer_verification", reason: "roles match but current-employer identity could not be verified" };
  }
  if (!ctx.expansionAvailable) return { kind: "search_exhausted", reason: "no approved expansion remains" };
  return { kind: "title_coverage", reason: "quota unmet; widen approved title coverage" };
}

/** The remedy for a bottleneck — never a gate change, only search-space widening. */
export function remedyFor(kind: BottleneckKind): string {
  switch (kind) {
    case "insufficient_raw_jobs": case "title_coverage": return "expand approved title coverage";
    case "company_qualification": return "widen company coverage within the same vertical";
    case "company_identity": return "resolve company identity before people lookup";
    case "people_coverage": return "increase company-scoped people coverage";
    case "person_role_precision": return "increase people-per-company within approved roles";
    case "employer_verification": return "improve company identity corroboration";
    case "duplicate_saturation": return "expand page/source coverage";
    default: return "stop and report honestly";
  }
}
