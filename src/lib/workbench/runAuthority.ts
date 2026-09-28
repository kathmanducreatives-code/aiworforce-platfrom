// ONE AUTHORITY CHAIN FOR "WHERE IS THIS MISSION, AND WHAT DID IT FIND?"
//
// A finished mission showed "0 companies reviewed · still running" (and, on
// other runs, "counts disagree"). The Workbench took both answers from
// PROJECTIONS the engine writes as it goes — `workbench_progress.in_progress`
// and the mission view — and a slice that ends the run is not obliged to
// rewrite them (a slice that adopts its results by replay, for instance, has
// nothing new to project). Meanwhile run-agent writes the DURABLE record once,
// at completion — `result.run_outcome` — precisely so that "everything
// downstream reads that field" (runOutcome.ts). The Workbench never read it.
//
// The chain, highest authority first:
//
//   1. The task ROW's lifecycle (`tasks.status`): `complete`, `failed` or
//      `skipped` is TERMINAL. A terminal run is never "still running", whatever
//      a snapshot says.
//   2. At a terminal state, `result.run_outcome` is the account of the run: its
//      canonical decisions when the run produced them (Lead V2), else its
//      qualification facts. These become the counts.
//   3. Only while the row is NOT terminal do the projections speak
//      (`workbench_progress`, the mission view) — that is what they are for.
//
// PURE. No React, no network.

import type { WorkbenchProgress } from './workbenchProgress.ts';

export const TERMINAL_ROW_STATUSES: ReadonlySet<string> = new Set(['complete', 'completed', 'done', 'failed', 'skipped', 'cancelled']);
const RUN_OUTCOME_VERSION = 'run-outcome-v1';

export type MissionActivity = 'running' | 'checkpointed' | 'finished' | 'failed';

export interface OutcomeCounts {
  /** Companies that qualified (canonical: every eligible lead, whatever its label). */
  qualified: number;
  /** Companies judged, whatever the outcome. */
  reviewed: number;
  /** Judged, with a hard requirement still owed evidence. */
  pending: number;
  /** Where the numbers came from. */
  source: 'run_outcome_canonical' | 'run_outcome_legacy';
}

export interface RunAuthority {
  activity: MissionActivity;
  terminal: boolean;
  /** The terminal account of the run, when it recorded one. */
  outcome: OutcomeCounts | null;
}

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) && x >= 0 ? Math.trunc(x) : 0;
};
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? v as Record<string, unknown> : {});

/** The counts a stored run_outcome states, or null when the run recorded none. */
export function outcomeCounts(result: unknown): OutcomeCounts | null {
  const o = rec(rec(result).run_outcome);
  if (o.version !== RUN_OUTCOME_VERSION) return null;
  const q = rec(o.qualification);
  const c = rec(q.canonical);
  if (c.source === 'workbench_mission_view') {
    const qualified = n(c.qualified), pending = n(c.pending), ineligible = n(c.ineligible);
    // The same formula the mission view uses (workbenchProgress.ts): judged = qualified + pending + ineligible.
    return { qualified, pending, reviewed: qualified + pending + ineligible, source: 'run_outcome_canonical' };
  }
  const qualified = n(q.qualified), evaluated = n(q.evaluated), rejected = n(q.rejected);
  return {
    qualified,
    reviewed: Math.max(evaluated, qualified + rejected),
    pending: Math.max(0, evaluated - qualified - rejected),
    source: 'run_outcome_legacy',
  };
}

export function resolveRunAuthority(i: { taskStatus: string | null | undefined; result: unknown }): RunAuthority {
  const status = String(i.taskStatus ?? '').toLowerCase();
  if (TERMINAL_ROW_STATUSES.has(status)) {
    return {
      activity: status === 'failed' ? 'failed' : 'finished',
      terminal: true,
      outcome: outcomeCounts(i.result),
    };
  }
  if (status === 'ready') return { activity: 'checkpointed', terminal: false, outcome: null };
  return { activity: 'running', terminal: false, outcome: null };
}

/**
 * The progress every Workbench consumer reads, corrected by the authority.
 *
 * At a terminal state: never in progress, never awaiting a provider, and — when
 * the run recorded an outcome — the outcome's counts are the canonical counts,
 * which makes the run summary take its single-authority path (no reconciling a
 * stale portfolio against a lead, so no "counts disagree"). Otherwise the
 * projection is returned untouched.
 */
export function applyRunAuthority(progress: WorkbenchProgress | null, a: RunAuthority): WorkbenchProgress | null {
  if (!a.terminal) return progress;
  const base: WorkbenchProgress = progress ?? {
    stage: 'qualified', accounts_found: 0, evaluated: 0, eligible_opportunities: 0, exclusion_reasons: {},
    identity_resolved: 0, identity_unresolved: 0, companies_enriched: 0, hiring_verified: 0,
    qualified_companies: 0, decision_makers_verified: 0, open_jobs_evaluated: 0, shortlisted: 0,
    in_progress: false, awaiting_external_run: false,
  };
  if (!progress && !a.outcome) return null;
  const out: WorkbenchProgress = { ...base, in_progress: false, awaiting_external_run: false };
  if (a.outcome) {
    out.evaluated = a.outcome.reviewed;
    out.qualified_companies = a.outcome.qualified;
    out.canonical = { qualified_companies: a.outcome.qualified, reviewed: a.outcome.reviewed, pending: a.outcome.pending };
  }
  return out;
}
