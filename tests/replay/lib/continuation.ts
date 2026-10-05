// LEAD V2 REPLAY LAB — A LINEAGE'S SLICES, THROUGH THE PRODUCTION CONTINUATION.
//
// A fixture records what each slice of a canary did (cumulative counters, as
// run-agent passes them to `foldSlice`). Replay folds them with the production
// `foldSlice` and asks the production `decideAutoContinuation` — the decisions
// are production's, the counters are the canary's.

import {
  decideAutoContinuation, foldSlice, type LineageProgress, readLineageProgress,
  resolveMaxContinuations, resolveMaxLineageCostUnits,
} from "../../../supabase/functions/_shared/leadAutoContinuation.ts";

export interface FixtureSlice {
  label: string;
  investigated: number;
  decided: number;
  costUnits: number;
  /** Canonical claim progress after the slice; null = the field did not exist yet (pre-PR #15). */
  claimProgress: number | null;
  pendingRuns: number;
  verifiable: number;
  qualified?: number;
  /** Discovery page this slice bought, if any. */
  page?: number | null;
}

export interface SliceDecision {
  slice: number;
  label: string;
  decision: string;
  continue: boolean;
  barren: number;
  progress: LineageProgress;
}

export interface LineageEnv {
  requestedCount?: number;
  discoveryRoutesRemain?: boolean;
  frontierRemaining?: number;
}

/** Fold one slice and decide — exactly the pair run-agent runs at the end of a slice. */
export function foldAndDecide(prior: LineageProgress, s: FixtureSlice, env: LineageEnv = {}) {
  const progress = foldSlice(prior, {
    qualifiedInPool: s.qualified ?? 0, uniqueCompaniesInvestigatedInPool: s.investigated,
    authorisationsInPool: s.investigated, costUnitsInLineage: s.costUnits, brainDecidedInPool: s.decided,
    ...(s.claimProgress === null ? {} : { claimProgressInPool: s.claimProgress }),
  });
  const d = decideAutoContinuation({
    cancelled: false, qualified: s.qualified ?? 0, requestedCount: env.requestedCount ?? 1,
    frontierRemaining: env.frontierRemaining ?? 0,
    continuationsUsed: progress.continuations_used, maxContinuations: resolveMaxContinuations(() => undefined),
    costUnitsUsed: progress.cost_units_used, maxCostUnits: resolveMaxLineageCostUnits(() => undefined),
    barrenSlices: progress.barren_slices, providerFailed: false,
    pendingRuns: s.pendingRuns, verificationRoutesRemain: s.verifiable,
    discoveryRoutesRemain: env.discoveryRoutesRemain ?? true,
  });
  return { progress, decision: d };
}

export function replayLineage(slices: readonly FixtureSlice[], env: LineageEnv = {}): SliceDecision[] {
  let progress = readLineageProgress({});
  const out: SliceDecision[] = [];
  for (const [i, s] of slices.entries()) {
    const r = foldAndDecide(progress, s, env);
    progress = r.progress;
    out.push({ slice: i + 1, label: s.label, decision: String(r.decision.reason), continue: r.decision.continue,
      barren: progress.barren_slices, progress });
    if (!r.decision.continue) break;
  }
  return out;
}
