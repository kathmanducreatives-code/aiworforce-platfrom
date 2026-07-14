// Radar source execution — the bridge from a Brain-derived scan plan to provider
// queries. This is the module that makes the Company Brain actually DRIVE Firecrawl
// execution (previously the plan was computed and ignored while legacy generic
// query builders ran). Pure orchestration with an INJECTED search function, so it
// is fully deterministic under test — no live provider calls.
//
// Guarantees enforced here:
//   * setup_required  → ZERO provider calls (no broad generic search when the Brain
//                       is unusable); returns an honest `setup_needed` status.
//   * negative_terms  → appended to every query as `-"term"` exclusions.
//   * geography       → already baked into the plan's query text (planner), never
//                       dropped when a stage widens.
//   * staged widening → exact → synonym → adjacent, stopping as soon as enough raw
//                       candidates exist to rank/cap. Adjacent is still ICP-seeded,
//                       never a bare generic search.

import type { RadarSourcePlan, RadarSource } from "./radarScanPlanner.ts";
import { firecrawlHitToCandidate, type FirecrawlHit, type ScoredCandidate, type RadarPlanSource } from "./radarCandidatePipeline.ts";

/** Injected provider search. In production this calls Firecrawl; in tests, a stub. */
export type FirecrawlSearchFn = (query: string, limit: number) => Promise<FirecrawlHit[]>;

export interface SourceExecResult {
  source: RadarSource;
  items: ScoredCandidate[];
  /** raw hits gathered across the stages that ran */
  found: number;
  status: "ready" | "setup_needed" | "skipped";
  reason?: string;
  /** how many stages (1..3) actually ran */
  stages_used: number;
  /** the exact query strings sent to the provider (with negatives applied) */
  queries_run: string[];
}

/**
 * Append Brain disqualifiers as `-"term"` exclusions. Capped so a long
 * disqualifier list doesn't overflow the provider's query length.
 */
export function buildFirecrawlQuery(base: string, negativeTerms: string[], maxNeg = 4): string {
  const negs = [...new Set(negativeTerms.filter((n) => n && n.trim()))]
    .slice(0, maxNeg)
    .map((n) => `-"${n.trim()}"`)
    .join(" ");
  return negs ? `${base} ${negs}` : base;
}

/**
 * Run ONE source from the scan plan through the injected search function, widening
 * from exact → synonym → adjacent only as needed. Returns scorer-ready candidates.
 * Never fabricates: a hit with no company/url simply scores low downstream.
 */
export async function runFirecrawlSource(args: {
  plan: RadarSourcePlan;
  wanted: number;
  search: FirecrawlSearchFn;
  scanPlanReason: string;
  setupRequired: boolean;
}): Promise<SourceExecResult> {
  const { plan, wanted } = args;

  // Honest short-circuit: an unusable Brain must not burn provider budget on
  // broad generic queries.
  if (args.setupRequired) {
    return {
      source: plan.source, items: [], found: 0, status: "setup_needed",
      reason: "Company Brain incomplete — complete setup before a high-quality scan.",
      stages_used: 0, queries_run: [],
    };
  }
  if (!plan.enabled || wanted <= 0) {
    return { source: plan.source, items: [], found: 0, status: "skipped", stages_used: 0, queries_run: [] };
  }

  const stages = [plan.staged_queries.exact, plan.staged_queries.synonym, plan.staged_queries.adjacent];
  const perQuery = Math.max(3, Math.ceil(wanted * 1.5));
  // Gather ~2× the wanted count of raw candidates, then let the scorer rank + cap.
  const enough = Math.max(wanted * 2, wanted + 3);

  const collected: FirecrawlHit[] = [];
  const queries_run: string[] = [];
  let stages_used = 0;

  for (const stage of stages) {
    if (collected.length >= enough) break;
    if (!stage.length) continue;
    stages_used++;
    for (const q of stage) {
      const full = buildFirecrawlQuery(q, plan.negative_terms);
      queries_run.push(full);
      const hits = await args.search(full, perQuery);
      if (Array.isArray(hits)) collected.push(...hits);
    }
  }

  const source = plan.source as RadarPlanSource;
  const items: ScoredCandidate[] = collected.map((h) => ({
    candidate: firecrawlHitToCandidate(source, h),
    source,
    scanPlanReason: args.scanPlanReason,
    provider: "firecrawl_search",
  }));

  return { source: plan.source, items, found: collected.length, status: "ready", stages_used, queries_run };
}
