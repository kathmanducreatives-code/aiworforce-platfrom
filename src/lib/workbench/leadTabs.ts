// WHICH BUCKET EACH RESULT BELONGS IN, AND WHAT TO CALL IT.
//
// ── THE STATES WERE ALREADY MODELLED; NOTHING SEPARATED THEM ON SCREEN ──────
//
// Every result landed in one table. A company that qualified, one still waiting
// on a decision-maker, and one the run never reached rendered as adjacent rows
// with the same weight — so "10 qualified" and "74 never looked at" read as one
// list of 84 things, and the only way to tell them apart was to read a status
// column.
//
// The data to separate them has always existed:
//
//   QualificationLevel   contact_ready | needs_decision_maker |
//                        needs_verification | not_qualified | not_evaluated
//   WorkbenchLifecycle   discovered | evaluated | not_investigated |
//                        shortlisted | identity_unresolved | verifying |
//                        deferred | held_for_evidence | qualified |
//                        not_qualified | contact_ready
//
// This maps both onto the three buckets a user actually acts on differently,
// and nothing else. A fourth bucket would be a fourth thing to explain.
//
// ── WHY `not_qualified` IS NOT A TAB ────────────────────────────────────────
//
// It is a real state and it is deliberately not promoted. There is no action to
// take on a company that was reviewed and ruled out — the evaluated-rows
// projection says so itself: those rows carry no lead_candidate_id, so nothing
// can act on them. They live in Run details, where a reader goes to check
// nothing was missed rather than to do something.
//
// ── AND WHY `qualified` READS AN EXPLICIT VERDICT ───────────────────────────
//
// `resolveQualification` carries the scar: `level !== 'not_qualified'` once
// reported 20 qualified companies for a run that qualified none, because it
// asked "was this rejected?" instead of "was this accepted?". Absence of a
// rejection is not a pass, and this file never asks the first question.
//
// Pure — no React, no network.

import { resolveQualification, type QualificationRecord } from '../qualifiedLead/qualification.ts';
import type { EvaluationRow } from './evaluationRows.ts';

export const LEAD_TABS_VERSION = 'workbench-lead-tabs-v1' as const;

export type LeadTabId = 'qualified' | 'in_review' | 'not_reached' | 'insights' | 'activity';

/**
 * The words on the tab.
 *
 * Plain English, chosen so the three result tabs cannot be confused with one
 * another when read quickly. "Pending" and "Unfinished" were the internal
 * names; both describe a process rather than telling the reader what they are
 * looking at, and "checking"/"not checked" — the first attempt — differ by one
 * word at a glance.
 */
export const LEAD_TAB_LABEL: Readonly<Record<LeadTabId, string>> = Object.freeze({
  qualified: 'Qualified',
  in_review: 'In review',
  not_reached: 'Not reached',
  insights: 'Insights',
  activity: 'Activity',
});

/** One sentence under an empty tab. Says what the bucket MEANS, not that it is empty. */
export const LEAD_TAB_EMPTY: Readonly<Record<LeadTabId, string>> = Object.freeze({
  qualified: 'Nothing has qualified yet. Companies appear here once they match everything you asked for.',
  in_review: 'Nothing is waiting. Companies land here when we have found them but still need one more thing — usually a contact.',
  not_reached: 'Every company was checked. Nothing was left behind when the run finished.',
  insights: 'No qualification details were recorded for this run.',
  activity: 'No activity recorded yet.',
});

export interface LeadPartition<T> {
  qualified: T[];
  inReview: T[];
}

/**
 * Split result rows into the two buckets that carry an action.
 *
 * `not_qualified` and `not_evaluated` rows fall out of both: the first has been
 * decided against, and the second has had nothing said about it, so calling it
 * "in review" would claim a review that never happened.
 */
export function partitionLeads<T extends QualificationRecord>(rows: T[]): LeadPartition<T> {
  const qualified: T[] = [];
  const inReview: T[] = [];
  for (const r of rows) {
    const q = resolveQualification(r);
    if (q.qualified) {
      qualified.push(r);
      continue;
    }
    // EVALUATED AND SHORT OF SOMETHING. Not "everything that was not rejected".
    if (q.evaluated && (q.level === 'needs_decision_maker' || q.level === 'needs_verification')) {
      inReview.push(r);
    }
  }
  return { qualified, inReview };
}

/**
 * Companies the run would continue if resumed.
 *
 * `resumable` is the engine's own answer — "resuming the run would continue this
 * company" — so this reads it rather than inferring from status. A status-based
 * guess would disagree with the resume path about what resuming does, and the
 * tab would then promise work that would not happen.
 */
export function notReachedCompanies(rows: readonly EvaluationRow[]): EvaluationRow[] {
  return rows.filter((r) => r.resumable);
}

/** Reviewed and ruled out. Shown in Run details, never as a tab. */
export function ruledOutCompanies(rows: readonly EvaluationRow[]): EvaluationRow[] {
  return rows.filter((r) => !r.resumable && r.evaluated);
}

export interface TabCount {
  id: LeadTabId;
  label: string;
  /** Null for tabs that are not a count of anything. */
  count: number | null;
}

/**
 * The tab row, in order.
 *
 * Qualified first and always, even at zero — a tab that disappears when empty
 * makes "no qualified leads" indistinguishable from "this run does not do
 * that", and moves every other tab under the reader's cursor between runs.
 */
export function tabsFor(i: {
  qualified: number;
  inReview: number;
  notReached: number;
  hasInsights: boolean;
}): TabCount[] {
  const tabs: TabCount[] = [
    { id: 'qualified', label: LEAD_TAB_LABEL.qualified, count: i.qualified },
    { id: 'in_review', label: LEAD_TAB_LABEL.in_review, count: i.inReview },
  ];
  // `not_reached` appears only when there is something to resume. On a run that
  // finished cleanly the tab would always read zero and would say nothing.
  if (i.notReached > 0) {
    tabs.push({ id: 'not_reached', label: LEAD_TAB_LABEL.not_reached, count: i.notReached });
  }
  if (i.hasInsights) {
    tabs.push({ id: 'insights', label: LEAD_TAB_LABEL.insights, count: null });
  }
  tabs.push({ id: 'activity', label: LEAD_TAB_LABEL.activity, count: null });
  return tabs;
}
