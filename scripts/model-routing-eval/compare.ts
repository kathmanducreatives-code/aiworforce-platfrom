// WHAT CHANGES IF THIS STAGE MOVES TO A CHEAPER MODEL.
//
// ── THE MEASURE THIS REPLACES ───────────────────────────────────────────────
//
// The instinct is to run the pipeline twice, once per model, and compare
// qualified-lead counts. The persisted history says that measure does not work
// at the sample size anyone would pay for. Two runs of the SAME mission on the
// SAME code, three hours apart:
//
//     3a231901   10 qualified   5 identity_unresolved    9 cost units
//     4fe98f5c   10 qualified  12 identity_unresolved   17 cost units
//
// Same input, same model, nearly double the cost and 2.4x the identity misses.
// That spread is provider variance — which Actor rows came back that morning —
// and it is larger than any difference a model swap would plausibly produce. An
// A/B at one run per arm would be reading the weather and calling it a model
// evaluation.
//
// So this compares the MODEL'S OUTPUT, which is deterministic to inspect, and
// weights each difference by the paid work it would change. The end-to-end run
// is still the final proof, but it is the LAST step and it needs repeats, not
// the first step and one sample.
//
// ── AGREEMENT IS NOT THE SCORE ──────────────────────────────────────────────
//
// A difference is reported, never scored as a failure. gpt-4.1 is the incumbent,
// not the definition of correct — the audit caught it dropping `locations` and
// needing a repair call on its own discovery proposal. `checkMissionInvariants`
// is what says whether an output is WRONG; this says what a difference COSTS.
//
// PURE. No network, model or database access.

import { normalizeCountry } from "../../supabase/functions/_shared/locationMatch.ts";
import { gradeOf, type ImpactGrade, isUngraded } from "./missionImpact.ts";

export const MISSION_COMPARE_VERSION = "mission-compare-v1" as const;

export interface FieldDifference {
  path: string;
  grade: ImpactGrade;
  /** True when no entry in the impact table covers this path. */
  ungraded: boolean;
  baseline: unknown;
  candidate: unknown;
}

export interface CompareReport {
  version: typeof MISSION_COMPARE_VERSION;
  differences: FieldDifference[];
  counts: Record<ImpactGrade, number>;
  ungraded_paths: string[];
  /**
   * True when nothing that changes paid work differs.
   *
   * The bar a cheaper model has to clear to be a drop-in: it may word things
   * differently, it may not buy differently.
   */
  cost_equivalent: boolean;
}

const isRec = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Paths whose values the PIPELINE ITSELF normalises before comparing.
 *
 * Verified, not assumed: `normalizeCountry` in `locationMatch.ts` maps "US",
 * "us", "United States" and "United States of America" all to "US". So two
 * missions differing only in that spelling buy identical work, and reporting it
 * as a difference is a false positive.
 *
 * This mattered immediately. The two harvested 10/10 runs are the same request
 * compiled twice by the same model, and gpt-4.1 wrote the geography as "United
 * States" once and "US" the other time. Compared raw, the only pair of runs in
 * the entire history known to be equivalent looked as if it were not — which
 * would have made every model-vs-model comparison report a difference it could
 * not act on.
 *
 * DELIBERATELY NARROW. Normalising anything the consumer does not normalise
 * would hide real differences, which is the more expensive error, so a path
 * joins this list only with the consumer named.
 */
const CONSUMER_NORMALISED: Record<string, (v: unknown) => unknown> = {
  "company_profile.locations": (v) => normalizeCountry(String(v ?? "")) || v,
  "hard_constraints.geographies.value": (v) => normalizeCountry(String(v ?? "")) || v,
};

/** Apply the consumer's own normalisation, if this path has one. */
function normalised(path: string, v: unknown): unknown {
  const f = CONSUMER_NORMALISED[path];
  if (!f) return v;
  return Array.isArray(v) ? v.map(f) : f(v);
}

/**
 * Fields no model authors, excluded from every comparison.
 *
 * A build stamp differing between two runs is not a model difference, and
 * leaving them in would put a permanent floor under every diff.
 */
const NOT_MODEL_AUTHORED = new Set([
  "planner_runtime", "version", "confidence", "field_provenance",
]);

/**
 * Compare two arrays as SETS when they are lists of scalars.
 *
 * `["AI","startup"]` and `["startup","AI"]` are the same mission. Every list in
 * the direct-impact set is read as a set downstream — verticals become search
 * terms, locations become region filters — so ordering is noise, and treating it
 * as a difference would drown the differences that are real.
 *
 * Lists of OBJECTS keep their order, because `required_signals` and actor
 * proposals are read positionally.
 */
function sameArray(a: unknown[], b: unknown[]): boolean {
  const scalar = (xs: unknown[]) => xs.every((x) => x == null || typeof x !== "object");
  if (scalar(a) && scalar(b)) {
    const norm = (xs: unknown[]) => [...xs.map((x) => JSON.stringify(x))].sort();
    return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

function walk(
  base: unknown, cand: unknown, path: string, out: FieldDifference[],
): void {
  if (path && NOT_MODEL_AUTHORED.has(path.split(".")[0])) return;

  if (Array.isArray(base) || Array.isArray(cand)) {
    const a = Array.isArray(normalised(path, base)) ? normalised(path, base) as unknown[] : [];
    const b = Array.isArray(normalised(path, cand)) ? normalised(path, cand) as unknown[] : [];
    if (!sameArray(a, b)) {
      out.push({ path, grade: gradeOf(path), ungraded: isUngraded(path), baseline: base, candidate: cand });
    }
    return;
  }

  if (isRec(base) || isRec(cand)) {
    const a = isRec(base) ? base : {};
    const b = isRec(cand) ? cand : {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      walk(a[k], b[k], path ? `${path}.${k}` : k, out);
    }
    return;
  }

  if (JSON.stringify(normalised(path, base) ?? null) !== JSON.stringify(normalised(path, cand) ?? null)) {
    out.push({ path, grade: gradeOf(path), ungraded: isUngraded(path), baseline: base, candidate: cand });
  }
}

/**
 * Diff two compiled missions, weighted by what each difference buys.
 *
 * `baseline` is the incumbent's output and `candidate` the challenger's, but the
 * report is symmetric in meaning: it says what would change, not who is right.
 */
export function compareMissions(
  baseline: Record<string, unknown>, candidate: Record<string, unknown>,
): CompareReport {
  const differences: FieldDifference[] = [];
  walk(baseline, candidate, "", differences);

  const counts: Record<ImpactGrade, number> = { direct: 0, gating: 0, inert: 0 };
  for (const d of differences) counts[d.grade]++;

  return {
    version: MISSION_COMPARE_VERSION,
    differences,
    counts,
    ungraded_paths: [...new Set(differences.filter((d) => d.ungraded).map((d) => d.path))],
    cost_equivalent: counts.direct === 0 && counts.gating === 0,
  };
}

/** One line for a terminal table. */
export function summarizeComparison(r: CompareReport): string {
  return `${r.counts.direct} direct · ${r.counts.gating} gating · ` +
    `${r.counts.inert} inert${r.cost_equivalent ? " · COST-EQUIVALENT" : ""}`;
}
