// Company-size-aware ranking of verified decision-makers. Pure.
//
// Returns score COMPONENTS, not just a number: a bare score can't be argued with
// in review, and "why is this person first" is the question a user actually asks.

import type { DecisionMakerRoleFamily } from "./roleFamily.ts";
import type { EmployerVerificationStatus } from "./employerVerification.ts";

export type CompanySizeBand = "small" | "large" | "unknown";

/**
 * Derive a size band from employee count. Unknown stays unknown — a fabricated
 * size silently reorders every result.
 */
export function companySizeBand(employeeCount: unknown): CompanySizeBand {
  if (typeof employeeCount !== "number" || !Number.isFinite(employeeCount) || employeeCount <= 0) {
    return "unknown";
  }
  return employeeCount <= 50 ? "small" : "large";
}

/** Founder-led companies: the founder IS the buyer. */
const SMALL_PRIORITY: Record<DecisionMakerRoleFamily, number> = {
  founder: 100,
  executive_revenue: 80,
  sales_leadership: 65,
  growth_leadership: 55,
  revenue_operations: 45,
  sales_operations: 40,
  other: 0,
};

/** At scale the founder is usually too far from the purchase. */
const LARGE_PRIORITY: Record<DecisionMakerRoleFamily, number> = {
  executive_revenue: 100,
  sales_leadership: 85,
  growth_leadership: 75,
  revenue_operations: 65,
  sales_operations: 55,
  founder: 40,
  other: 0,
};

/** Balanced midpoint used when size is genuinely unknown. */
const UNKNOWN_PRIORITY: Record<DecisionMakerRoleFamily, number> = {
  founder: 85,
  executive_revenue: 90,
  sales_leadership: 75,
  growth_leadership: 65,
  revenue_operations: 55,
  sales_operations: 48,
  other: 0,
};

const SENIORITY_BONUS: Record<string, number> = {
  founder: 20, c_level: 18, vp: 14, head: 12, director: 8, manager: 3, ic: 0, unknown: 0,
};

/** Verification dominates: a probable match must never outrank a verified one. */
const VERIFICATION_WEIGHT: Record<EmployerVerificationStatus, number> = {
  verified: 200,
  probable: 60,
  unverified: 0,
  rejected: 0,
};

export interface RankInput {
  role_family: DecisionMakerRoleFamily;
  seniority: string;
  verification_status: EmployerVerificationStatus;
  /** 0..1 completeness of the normalized profile. */
  profile_completeness: number;
  /** True when the candidate came from a trusted direct source, not a search. */
  from_direct_source: boolean;
}

export interface RankComponents {
  role_priority: number;
  seniority_bonus: number;
  verification_weight: number;
  completeness_bonus: number;
  direct_source_bonus: number;
  total: number;
}

export interface RankedCandidate<T> {
  candidate: T;
  rank: number;
  score: RankComponents;
  rank_reasons: string[];
}

export function scoreCandidate(input: RankInput, band: CompanySizeBand): RankComponents {
  const table = band === "small" ? SMALL_PRIORITY : band === "large" ? LARGE_PRIORITY : UNKNOWN_PRIORITY;
  const role_priority = table[input.role_family] ?? 0;
  const seniority_bonus = SENIORITY_BONUS[input.seniority] ?? 0;
  const verification_weight = VERIFICATION_WEIGHT[input.verification_status] ?? 0;
  const completeness_bonus = Math.round(Math.max(0, Math.min(1, input.profile_completeness)) * 10);
  const direct_source_bonus = input.from_direct_source ? 5 : 0;

  return {
    role_priority,
    seniority_bonus,
    verification_weight,
    completeness_bonus,
    direct_source_bonus,
    total: role_priority + seniority_bonus + verification_weight + completeness_bonus + direct_source_bonus,
  };
}

function reasonsFor(input: RankInput, band: CompanySizeBand, score: RankComponents): string[] {
  const reasons: string[] = [];
  if (input.verification_status === "verified") reasons.push("current employer verified");
  else if (input.verification_status === "probable") reasons.push("employment probable, not confirmed");
  if (band === "small" && input.role_family === "founder") reasons.push("founder-led company");
  if (band === "large" && input.role_family === "executive_revenue") reasons.push("revenue executive at a larger company");
  if (band === "unknown") reasons.push("company size unknown — balanced ranking");
  if (score.seniority_bonus >= 14) reasons.push(`senior role (${input.seniority})`);
  if (input.from_direct_source) reasons.push("from a direct source, not a broad search");
  return reasons;
}

/**
 * Rank candidates, best first. Rejected/unverified candidates are NOT ranked —
 * they must never appear in the returned list at all.
 */
export function rankCandidates<T>(
  items: Array<{ candidate: T; input: RankInput }>,
  band: CompanySizeBand,
  limit = 3,
): RankedCandidate<T>[] {
  const eligible = items.filter(
    (i) => i.input.verification_status === "verified" || i.input.verification_status === "probable",
  );

  const scored = eligible.map((i) => {
    const score = scoreCandidate(i.input, band);
    return { candidate: i.candidate, score, rank_reasons: reasonsFor(i.input, band, score) };
  });

  scored.sort((a, b) => b.score.total - a.score.total);

  return scored.slice(0, limit).map((s, idx) => ({
    candidate: s.candidate,
    rank: idx + 1,
    score: s.score,
    rank_reasons: s.rank_reasons,
  }));
}
