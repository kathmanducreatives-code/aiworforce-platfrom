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

export type LeadTabId =
  | 'qualified' | 'in_review' | 'rejected' | 'not_reached' | 'insights' | 'activity';

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
  rejected: 'Ruled out',
  not_reached: 'Not reached',
  insights: 'Insights',
  activity: 'Activity',
});

/** One sentence under an empty tab. Says what the bucket MEANS, not that it is empty. */
export const LEAD_TAB_EMPTY: Readonly<Record<LeadTabId, string>> = Object.freeze({
  qualified: 'Nothing has qualified yet. Companies appear here once they match everything you asked for.',
  in_review: 'Nothing is waiting. Companies land here when we have found them but still need one more thing — usually a contact.',
  rejected: 'Nothing was ruled out. Companies land here when the run checked them against what you asked for and they did not match.',
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

/**
 * Reviewed and ruled out.
 *
 * ── IT READ A FIELD THAT DOES NOT EXIST ────────────────────────────────────
 *
 * This was `rows.filter((r) => !r.resumable && r.evaluated)`. `EvaluationRow`
 * has no `evaluated` property — the tests passed because their synthetic helper
 * invented one, and against real rows the expression was always
 * `!resumable && undefined`, so this returned an empty list for every run ever
 * made. Task 5c461aa3's eighteen headcount rejections were not even in Run
 * details, and this is why.
 *
 * It now reads the same partition the tabs do, so "ruled out" means one thing
 * in one place.
 */
export function ruledOutCompanies(
  rows: ReadonlyArray<EvaluationRow & QualificationRecord>,
): Array<EvaluationRow & QualificationRecord> {
  return rows.filter((r) => bucketFor(r) === 'rejected');
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
  /**
   * Companies the run checked and ruled out.
   *
   * Optional so existing callers keep their shape; absent behaves exactly as
   * before. Present and non-zero, it becomes a tab — because a stated rejection
   * is a result, and eighteen of them once had nowhere to appear.
   */
  rejected?: number;
  hasInsights: boolean;
}): TabCount[] {
  const tabs: TabCount[] = [
    { id: 'qualified', label: LEAD_TAB_LABEL.qualified, count: i.qualified },
    { id: 'in_review', label: LEAD_TAB_LABEL.in_review, count: i.inReview },
  ];
  // Ruled out sits with the other results, not in a details drawer: it is the
  // answer to "what happened to the rest?" and on a run that qualifies nothing
  // it is the only answer there is.
  if ((i.rejected ?? 0) > 0) {
    tabs.push({ id: 'rejected', label: LEAD_TAB_LABEL.rejected, count: i.rejected! });
  }
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

// ══ EVERY REVIEWED COMPANY LANDS SOMEWHERE ═════════════════════════════════
//
// ── THE SCREEN THIS EXISTS TO MAKE IMPOSSIBLE ──────────────────────────────
//
// Task 5c461aa3 showed: "30 companies reviewed · Qualified 0 · In review 0 ·
// Not reached 1". Twenty-nine companies were on no tab at all.
//
// Each selector above was individually correct. They all key on DECISION
// fields — `counts_as_qualified`, `decision_source`, `resumable` — and that run
// never decided anything: it stopped at hiring assessment with
// `decision_source: not_evaluated` on all thirty rows. Eighteen of them carried
// a real, stated rejection in `shortlist_exclusion`
// (`mission_constraint:employee_size`, every one of them over the Company
// Brain's 150-employee ceiling) and eleven sat at `verifying`. None of that was
// part of the vocabulary any bucket could see, so `ruledOutCompanies` did not
// catch them either — not even Run details showed them.
//
// The fix is not another selector. It is that the buckets are now a PARTITION:
// every row lands in exactly one, `unclassified` is the bucket for anything the
// model did not anticipate, and a test asserts it is empty against the real
// thirty rows. A future status nobody mapped shows up as a failing test rather
// than as a company that quietly vanishes.

export type LeadBucket =
  | 'qualified' | 'in_review' | 'rejected' | 'not_reached' | 'unclassified';

/** Statuses that mean the company got somewhere but nobody concluded anything. */
const IN_REVIEW_STATUS: ReadonlySet<string> = new Set([
  'shortlisted', 'identity_unresolved', 'verifying', 'held_for_evidence', 'evaluated',
]);

/**
 * The one bucket this row belongs in.
 *
 * Order is the whole design: an acceptance outranks a rejection, a stated
 * rejection outranks "we never got to it", and only a row that reached no
 * modelled state at all falls through to `unclassified`.
 */
export function bucketFor(row: EvaluationRow & QualificationRecord): LeadBucket {
  if (resolveQualification(row).qualified) return 'qualified';
  // A STATED REJECTION IS A DECISION, wherever it was recorded. Eighteen
  // companies were ruled out on headcount before anyone looked further; that is
  // a result the user is entitled to see, not an absence.
  if (row.status === 'not_qualified') return 'rejected';
  if (row.shortlist_exclusion || row.exclusion) return 'rejected';
  // The engine's own answer to "would resuming continue this company?".
  if (row.resumable) return 'not_reached';
  if (row.status === 'not_investigated' || row.status === 'deferred') return 'not_reached';
  if (IN_REVIEW_STATUS.has(row.status)) return 'in_review';
  return 'unclassified';
}

export type LeadBuckets = Record<LeadBucket, Array<EvaluationRow & QualificationRecord>>;

/**
 * Split every reviewed company into exactly one bucket.
 *
 * Total by construction — the returned counts always sum to `rows.length`,
 * which is the invariant the Workbench failed.
 */
export function partitionAllRows(
  rows: ReadonlyArray<EvaluationRow & QualificationRecord>,
): LeadBuckets {
  const out: LeadBuckets = {
    qualified: [], in_review: [], rejected: [], not_reached: [], unclassified: [],
  };
  for (const r of rows) out[bucketFor(r)].push(r);
  return out;
}

/**
 * Why this company is where it is, in the user's terms.
 *
 * Prefers the explanation a human can read over the code that produced it, and
 * returns the code only when there is nothing better — a bucket with no reason
 * is the same silence in a smaller place.
 */
export function bucketReasonFor(row: EvaluationRow & QualificationRecord): string {
  const bucket = bucketFor(row);
  if (bucket === 'rejected') {
    return row.shortlist_exclusion_explanation
      ?? row.mission_reasoning
      ?? row.explanation
      ?? row.shortlist_exclusion
      ?? row.exclusion
      ?? 'Ruled out.';
  }
  return row.explanation || row.mission_reasoning || 'No reason was recorded.';
}
