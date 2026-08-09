// THE SCORING RUBRIC — FIXED BEFORE ANY RESULT IS OBSERVED.
//
// Weights are declared here, in their own file, committed in the same change as
// the harness and BEFORE any planner output exists to look at. That ordering is
// the only thing that makes the comparison honest: a rubric tuned after seeing
// which planner wins is a justification, not a measurement.
//
// Correctness dominates. Latency is present because it is worth recording, and
// weighted low because a planner that is fast and wrong is worthless.
//
// DISPOSABLE. This is evaluation infrastructure, not the canonical Mission. The
// neutral shape below exists so two differently-shaped planner outputs can be
// compared without either one's native schema scoring points merely for
// matching the rubric. Phase 5 designs the real Mission; this must not become it.

export const RUBRIC_VERSION = "planner-eval-rubric-v1" as const;

export interface Criterion {
  key: string;
  weight: number;
  /** What a perfect score means, in one line. */
  meaning: string;
}

/**
 * Weights sum to 100. Chosen on this reasoning:
 *
 *   * The three "critical" criteria together outweigh everything else combined
 *     (55), because a planner that misunderstands the request or drops a hard
 *     constraint has produced a wrong plan regardless of how tidy the rest is.
 *   * Hallucinating a capability Agentory cannot execute is weighted with the
 *     high group rather than the critical one only because the deterministic
 *     capability check catches it before spend — it is a wasted round, not a
 *     wrong answer delivered to a user.
 *   * Repair rate is deliberately mid-weight: needing repair is a cost, but a
 *     planner whose output is repaired into something correct still ends in the
 *     right place. It matters more as a maintenance signal than a quality one.
 */
export const CRITERIA: readonly Criterion[] = [
  { key: "hard_constraint_preservation", weight: 20, meaning: "no explicit constraint silently dropped or loosened" },
  { key: "query_understanding",          weight: 20, meaning: "the plan is about what the user actually asked for" },
  { key: "signal_interpretation",        weight: 15, meaning: "'building their sales team' reads as sales hiring, not arbitrary hiring" },
  { key: "icp_persona_fidelity",         weight: 12, meaning: "industry, size, geography, company type and persona survive intact" },
  { key: "plan_validity",                weight: 10, meaning: "passes the existing deterministic validator without repair" },
  { key: "capability_realism",           weight:  8, meaning: "requests only capabilities Agentory can actually execute" },
  { key: "unnecessary_broadening",       weight:  6, meaning: "does not loosen the query without being asked to" },
  { key: "budget_correctness",           weight:  5, meaning: "requested count and spend limits preserved" },
  { key: "repair_rate",                  weight:  3, meaning: "output usable without deterministic repair" },
  { key: "latency",                      weight:  1, meaning: "recorded; never allowed to outrank correctness" },
] as const;

export const TOTAL_WEIGHT = CRITERIA.reduce((a, c) => a + c.weight, 0);

/**
 * SEVERE FAILURES — declared before evaluation, scored separately from the
 * weighted average.
 *
 * A planner with a materially higher severe-failure rate does not win on average
 * score. These are the outcomes that would cost real money or deliver a wrong
 * answer to a user, and averaging hides exactly those: one silently dropped
 * geography across twenty otherwise-good plans still means a run that bought
 * companies on the wrong continent.
 */
export const SEVERE_FAILURES = [
  "dropped_hard_geography",
  "changed_requested_persona",
  "required_signal_made_optional",
  "invented_unsupported_capability",
  "violated_explicit_no_broadening",
  "lost_requested_quantity",
  "ignored_budget_restriction",
] as const;

export type SevereFailure = typeof SEVERE_FAILURES[number];

/** A per-criterion score in [0,1]. Missing keys score 0, never "skip". */
export type Scores = Partial<Record<string, number>>;

export function weightedScore(scores: Scores): number {
  let total = 0;
  for (const c of CRITERIA) {
    const s = scores[c.key];
    // An unmeasured criterion scores zero rather than being dropped from the
    // denominator: silently shrinking the denominator flatters whichever planner
    // produced less measurable output.
    total += (typeof s === "number" ? Math.max(0, Math.min(1, s)) : 0) * c.weight;
  }
  return Number((total / TOTAL_WEIGHT * 100).toFixed(2));
}

/**
 * The decision rule, also fixed in advance.
 *
 * A winner requires BOTH a material score margin AND no severe-failure
 * disadvantage. Anything else is INCONCLUSIVE — which is a permitted and
 * frequently correct outcome, not a failure of the evaluation.
 */
export const DECISION = {
  /** Below this margin the two are not meaningfully different. */
  minScoreMarginPoints: 5,
  /** A winner may not have more severe failures than the loser. */
  severeFailuresMustNotExceedLoser: true,
  /** Fewer than this many cases cannot support a conclusion either way. */
  minCasesForConclusion: 12,
} as const;

export function decide(a: { name: string; score: number; severe: number; cases: number },
                       b: { name: string; score: number; severe: number; cases: number }):
  { result: "WINNER" | "INCONCLUSIVE"; winner?: string; why: string } {
  if (a.cases < DECISION.minCasesForConclusion || b.cases < DECISION.minCasesForConclusion) {
    return { result: "INCONCLUSIVE", why: `fewer than ${DECISION.minCasesForConclusion} scored cases per planner` };
  }
  const [hi, lo] = a.score >= b.score ? [a, b] : [b, a];
  if (hi.score - lo.score < DECISION.minScoreMarginPoints) {
    return { result: "INCONCLUSIVE", why: `score margin ${(hi.score - lo.score).toFixed(2)} < ${DECISION.minScoreMarginPoints}` };
  }
  if (DECISION.severeFailuresMustNotExceedLoser && hi.severe > lo.severe) {
    return { result: "INCONCLUSIVE", why: `${hi.name} scores higher but has more severe failures (${hi.severe} vs ${lo.severe})` };
  }
  return { result: "WINNER", winner: hi.name, why: `margin ${(hi.score - lo.score).toFixed(2)} pts, severe failures ${hi.severe} vs ${lo.severe}` };
}
