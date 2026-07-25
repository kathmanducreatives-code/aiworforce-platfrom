// Deterministic ranking (section 8/12/15).
//
// Verdict class dominates (CONTACT > WATCH > NEEDS_REVIEW > REJECT); within a
// class, higher benchmark score first; ties broken deterministically so the same
// input always produces the same order (stable, reproducible replay).

import type { BenchmarkEvaluation, BenchmarkVerdict, RankedEvaluation } from "./types.ts";

const CLASS_ORDER: Record<BenchmarkVerdict, number> = {
  CONTACT: 0,
  WATCH: 1,
  NEEDS_REVIEW: 2,
  REJECT: 3,
};

/** Compare two evaluations for ranking (negative → a ranks first). */
export function compareEvaluations(a: BenchmarkEvaluation, b: BenchmarkEvaluation): number {
  const cls = CLASS_ORDER[a.verdict] - CLASS_ORDER[b.verdict];
  if (cls !== 0) return cls;

  const score = b.benchmarkScore.total - a.benchmarkScore.total;
  if (Math.abs(score) > 1e-9) return score;

  // Tie-break 1: more hard gates passed.
  const passA = a.gates.gates.filter((g) => g.outcome === "pass").length;
  const passB = b.gates.gates.filter((g) => g.outcome === "pass").length;
  if (passA !== passB) return passB - passA;

  // Tie-break 2: fresher signal (smaller days) first; nulls last.
  const fa = a.normalized.evidenceFreshnessDays ?? Number.POSITIVE_INFINITY;
  const fb = b.normalized.evidenceFreshnessDays ?? Number.POSITIVE_INFINITY;
  if (fa !== fb) return fa - fb;

  // Tie-break 3: stable, deterministic — candidate id ascending.
  return a.normalized.candidateId.localeCompare(b.normalized.candidateId);
}

/** Sort and assign 1-based final ranks. Pure — does not mutate the input array. */
export function rankEvaluations(evals: BenchmarkEvaluation[]): RankedEvaluation[] {
  return [...evals]
    .sort(compareEvaluations)
    .map((e, i) => ({ ...e, finalRank: i + 1 }));
}
