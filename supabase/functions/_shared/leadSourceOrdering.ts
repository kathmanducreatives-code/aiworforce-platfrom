// SIGNAL-DRIVEN DISCOVERY SOURCE ORDERING.
//
// The order in which paid discovery sources are spent is a STRATEGY decision,
// not a constant. `DEFAULT_SOURCE_ORDER` remains the taxonomy's declared
// preference, but the order actually executed is derived from the mission
// signals so that a startup mission spends YC first while a non-startup
// enterprise mission does not.
//
// Pure module: no I/O, no model, fully unit-testable.

import {
  APPROVED_DISCOVERY_SOURCES, DEFAULT_SOURCE_ORDER, type DiscoverySource,
} from "./leadRoleTaxonomy.ts";
import type { LeadStrategyMission, LeadStrategyRoundContext } from "./leadStrategyContract.ts";

/** Everything the ordering is allowed to consider. Nothing else. */
export interface SourceOrderingSignals {
  /** Mission explicitly targets startups / early-stage employers. */
  startupIntent: boolean;
  /** Company Brain / ICP business model, e.g. "saas", "marketplace". */
  businessModel: string | null;
  employeeMin: number | null;
  employeeMax: number | null;
  geography: string | null;
  roleFamilyKey: string | null;
  /** Sources already spent this run — they sink to the end, never vanish. */
  attemptedSources: string[];
  /** Query packs not yet executed. More unused packs → recall matters more. */
  unusedQueryPacks: string[];
  /** Observed quality per source from earlier rounds, -1 (bad) .. 1 (good). */
  sourceQuality: Record<string, number>;
}

/**
 * Static, documented per-source priors. These are CAPABILITY facts about each
 * board, not mission preferences — the mission signals weight them.
 */
export interface SourcePrior {
  source: DiscoverySource;
  /** How well the source represents early-stage / startup employers. */
  startupRelevance: number;
  /** Share of returned rows that are in-family and on-ICP. */
  precision: number;
  /** Absolute volume reachable. */
  recall: number;
  /** Countries the source covers well; empty means global. */
  strongGeographies: string[];
}

export const SOURCE_PRIORS: SourcePrior[] = [
  { source: "yc_jobs", startupRelevance: 1.0, precision: 0.9, recall: 0.25, strongGeographies: ["united states", "us", "usa", "remote"] },
  { source: "linkedin_jobs", startupRelevance: 0.55, precision: 0.7, recall: 0.9, strongGeographies: [] },
  { source: "indeed_jobs", startupRelevance: 0.25, precision: 0.4, recall: 1.0, strongGeographies: [] },
  { source: "glassdoor_jobs", startupRelevance: 0.2, precision: 0.45, recall: 0.6, strongGeographies: [] },
];

export interface SourceScore {
  source: DiscoverySource;
  score: number;
  reasons: string[];
}

const STARTUP_STAGE = /(pre-?seed|seed|series\s*[ab]|early|startup|venture|yc\b|accelerator)/i;

/** Derive the ordering signals from the canonical mission + round context. */
export function deriveSourceOrderingSignals(
  mission: LeadStrategyMission,
  ctx: LeadStrategyRoundContext,
  extra: Partial<SourceOrderingSignals> = {},
): SourceOrderingSignals {
  const stages = (mission.maturity_stages ?? []).join(" ");
  const employeeMax = mission.company_size?.max ?? null;
  const employeeMin = mission.company_size?.min ?? null;
  const startupIntent = STARTUP_STAGE.test(stages) ||
    STARTUP_STAGE.test(mission.original_query ?? "") ||
    (typeof employeeMax === "number" && employeeMax > 0 && employeeMax <= 200);

  return {
    startupIntent,
    businessModel: mission.company_vertical ?? null,
    employeeMin,
    employeeMax,
    geography: mission.geography ?? null,
    roleFamilyKey: null,
    attemptedSources: ctx.attempted_sources ?? [],
    unusedQueryPacks: [],
    sourceQuality: {},
    ...extra,
  };
}

const norm = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();

/**
 * Score every approved discovery source. Deterministic and explainable: each
 * contribution is recorded as a reason string so an ordering decision can be
 * audited without re-running the model.
 */
export function scoreDiscoverySources(signals: SourceOrderingSignals): SourceScore[] {
  const geo = norm(signals.geography);
  const model = norm(signals.businessModel);
  const recallWeight = 0.8 + Math.min(0.4, (signals.unusedQueryPacks?.length ?? 0) * 0.05);

  const scored = SOURCE_PRIORS.map((prior) => {
    const reasons: string[] = [];
    let score = 0;

    if (signals.startupIntent) {
      const boost = 1.4 * prior.startupRelevance;
      score += boost;
      reasons.push(`startup_intent:+${boost.toFixed(2)}`);
    }

    score += prior.precision;
    reasons.push(`precision:+${prior.precision.toFixed(2)}`);
    const recall = recallWeight * prior.recall;
    score += recall;
    reasons.push(`recall:+${recall.toFixed(2)}`);

    // Business model: SaaS/tech missions sit where technology employers post.
    if (/saas|software|tech|b2b/.test(model) && prior.startupRelevance >= 0.5) {
      score += 0.2;
      reasons.push("business_model_fit:+0.20");
    }

    // Employee range: small companies favour startup-native sources.
    if (typeof signals.employeeMax === "number" && signals.employeeMax > 0 && signals.employeeMax <= 200) {
      const b = 0.5 * prior.startupRelevance;
      score += b;
      reasons.push(`employee_range_small:+${b.toFixed(2)}`);
    }
    if (typeof signals.employeeMin === "number" && signals.employeeMin >= 1000) {
      const p = 0.6 * prior.startupRelevance;
      score -= p;
      reasons.push(`employee_range_enterprise:-${p.toFixed(2)}`);
    }

    // Geography: a source with declared strong coverage loses ground outside it.
    if (geo && prior.strongGeographies.length > 0 && !prior.strongGeographies.some((g) => geo.includes(g))) {
      score -= 0.7;
      reasons.push("geography_outside_coverage:-0.70");
    }

    // Observed quality from earlier rounds outranks every prior.
    const q = signals.sourceQuality?.[prior.source];
    if (typeof q === "number" && Number.isFinite(q)) {
      const adj = 1.2 * Math.max(-1, Math.min(1, q));
      score += adj;
      reasons.push(`observed_quality:${adj >= 0 ? "+" : ""}${adj.toFixed(2)}`);
    }

    // Already spent: keep it in the plan, but last.
    if ((signals.attemptedSources ?? []).map(norm).includes(prior.source)) {
      score -= 10;
      reasons.push("already_attempted:-10.00");
    }

    return { source: prior.source, score, reasons };
  });

  const tieBreak = new Map(DEFAULT_SOURCE_ORDER.map((s, i) => [s, i] as const));
  return scored.sort((a, b) =>
    b.score - a.score || (tieBreak.get(a.source) ?? 99) - (tieBreak.get(b.source) ?? 99)
  );
}

/** The executed order. Always a permutation of the approved discovery sources. */
export function orderDiscoverySources(signals: SourceOrderingSignals): DiscoverySource[] {
  const ordered = scoreDiscoverySources(signals).map((s) => s.source);
  // Defensive: never silently drop an approved source.
  for (const s of APPROVED_DISCOVERY_SOURCES) if (!ordered.includes(s)) ordered.push(s);
  return ordered;
}

/** Source plan steps in the canonical plan shape. */
export function buildSourcePlan(
  signals: SourceOrderingSignals,
): Array<{ source_key: string; priority: number; rationale: string }> {
  return scoreDiscoverySources(signals).map((s, i) => ({
    source_key: s.source,
    priority: i + 1,
    rationale: `score=${s.score.toFixed(2)} ${s.reasons.join(" ")}`.slice(0, 240),
  }));
}
