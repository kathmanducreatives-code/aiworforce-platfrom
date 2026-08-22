// ONE SET OF HEADLINE NUMBERS FOR THE WORKBENCH.
//
// ── WHAT THIS REPLACES ──────────────────────────────────────────────────────
//
// Three counter systems rendered at once, above the leads:
//
//   PortfolioSummary        11 cells  Requested, Shown, Opportunities,
//                                     Tier A/B/C, Qualified, Review, Watch,
//                                     Contact-ready
//   WorkflowProgressStrip    7 lines  Accounts found, Evaluated, Open roles
//                                     read, Eligible opportunities, Verified
//                                     companies, Qualified companies,
//                                     Decision-makers verified
//   LeadResultsView chips    6 chips  ACCOUNTS FOUND, EVALUATED, QUALIFIED
//                                     COMPANIES, DECISION-MAKERS VERIFIED,
//                                     CONTACT-READY, REMAINING
//
// Twenty-four numbers. "Qualified" appeared THREE times, and Accounts found,
// Evaluated, Contact-ready and Decision-makers verified each appeared twice.
//
// ── AND THEY COULD DISAGREE ─────────────────────────────────────────────────
//
// Not merely repetitive — they read three different persisted projections of
// the same fact: the engine's quota contract, the portfolio the engine built,
// and the row-level table. A user seeing "Qualified 3" beside "Qualified
// companies 6" has no way to know which is the answer, and neither did the UI:
// nothing compared them.
//
// So this does two things. It picks ONE authority per number, using the same
// precedence `buildWorkbenchCounts` already established — the engine's own
// answer beats a projection, a projection beats counting rows. And it RECORDS
// any disagreement instead of silently preferring one, because two projections
// of one run disagreeing is a data defect, and hiding it behind a chosen winner
// is how it would survive.
//
// ── WHY `qualified` IS NOT `!not_qualified` ─────────────────────────────────
//
// `qualification.ts` carries the scar: TEST plan edb4cbf6 reported 20 qualified
// companies for a run whose qualified set was empty, because the count asked
// "was this rejected?" instead of "was this accepted?". Absence of a rejection
// is not a pass. Every count here reads an explicit positive verdict.
//
// Pure — no React, no network.

import type { PortfolioView } from './portfolioView.ts';
import type { WorkbenchProgress } from './workbenchProgress.ts';
import type { QuotaProgress } from '../qualifiedLead/quotaProgress.ts';

export const RUN_SUMMARY_VERSION = 'workbench-run-summary-v1' as const;

/** Which projection answered a number. Shown in Run details, never on the hero. */
export type CountSource =
  | 'engine_quota'
  | 'portfolio'
  | 'progress'
  | 'rows'
  | 'none';

export interface SummaryNumber {
  value: number;
  source: CountSource;
  /**
   * Other projections' answers, when they differ.
   *
   * Empty on the healthy path. Non-empty means two records of one run disagree,
   * which Run details reports — a number nobody can reconcile is worse than a
   * number nobody shows.
   */
  disagreements: Array<{ source: CountSource; value: number }>;
}

export interface RunSummary {
  version: typeof RUN_SUMMARY_VERSION;
  /** THE HEADLINE. Explicit positive verdicts only. */
  qualified: SummaryNumber;
  /** Companies looked at, whatever the outcome. Context for the headline. */
  reviewed: SummaryNumber;
  /** Judged, but still waiting on something before they can qualify. */
  pending: SummaryNumber;
  /** Looked at and ruled out. */
  notAFit: SummaryNumber;
  /** What the user asked for. Null when the request named no number. */
  requested: number | null;
  /** Short of the request, and still running or resumable. */
  shortfall: number;
  /** True while the run is still working. */
  inProgress: boolean;
  /** True when any two projections disagree about any headline number. */
  hasDisagreement: boolean;
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
};

/**
 * Pick the first source that has an answer, and record the rest when they differ.
 *
 * Candidates are supplied in PRECEDENCE ORDER. The winner is the first non-null;
 * every other non-null that disagrees with it is reported.
 */
function reconcile(
  candidates: Array<{ source: CountSource; value: number | null }>,
): SummaryNumber {
  const present = candidates.filter((c) => c.value !== null) as
    Array<{ source: CountSource; value: number }>;
  if (present.length === 0) return { value: 0, source: 'none', disagreements: [] };
  const [winner, ...rest] = present;
  return {
    value: winner.value,
    source: winner.source,
    disagreements: rest.filter((c) => c.value !== winner.value),
  };
}

export interface RunSummaryInput {
  /** The engine's own quota contract. Highest authority where it speaks. */
  quota: QuotaProgress | null;
  /** The ranked portfolio the engine built for this run. */
  portfolio: PortfolioView | null;
  /** Stage-by-stage progress, written as the run proceeds. */
  progress: WorkbenchProgress | null;
  /** Row-level fallback for legacy runs the projections do not cover. */
  rows: { total: number; qualified: number; pending: number };
}

export function buildRunSummary(i: RunSummaryInput): RunSummary {
  const { quota, portfolio, progress, rows } = i;

  // AN EMPTY TABLE HAS NOT COUNTED ANYTHING.
  //
  // With no rows, the row-level fallback would report a confident `0 qualified`
  // and become the authority for a run whose projections simply have not been
  // written yet — turning "we have not looked" into "we looked and found none",
  // which is the exact conflation this module exists to prevent, reintroduced
  // one layer down. Rows speak only when there are rows.
  const rowsSpeak = rows.total > 0;
  const fromRows = (v: number): number | null => (rowsSpeak ? v : null);

  // QUALIFIED. The engine's answer, then the portfolio's, then the rows'.
  const qualified = reconcile([
    { source: 'engine_quota', value: num(quota?.qualifiedCompanies) },
    { source: 'portfolio', value: num(portfolio?.counts.qualified) },
    { source: 'progress', value: num(progress?.qualified_companies) },
    { source: 'rows', value: fromRows(rows.qualified) },
  ]);

  // REVIEWED is discovery-shaped and says nothing about qualification. Kept
  // separate for exactly that reason — collapsing the two is what once made "5
  // found" read as a met quota for a run with zero leads.
  const reviewed = reconcile([
    { source: 'progress', value: num(progress?.evaluated) },
    { source: 'portfolio', value: num(portfolio?.counts.delivered) },
    { source: 'rows', value: fromRows(rows.total) },
  ]);

  // PENDING: judged, not yet qualifiable. The portfolio's `review` bucket is the
  // same idea by another name.
  const pending = reconcile([
    { source: 'portfolio', value: num(portfolio?.counts.review) },
    { source: 'rows', value: fromRows(rows.pending) },
  ]);

  // NOT A FIT is DERIVED, never counted independently — reviewed minus the two
  // positive buckets. A separately-counted total is a fourth number that can
  // disagree with the other three.
  const notAFitValue = Math.max(0, reviewed.value - qualified.value - pending.value);

  const requested = num(quota?.requested);
  const shortfall = requested != null ? Math.max(0, requested - qualified.value) : 0;

  return {
    version: RUN_SUMMARY_VERSION,
    qualified,
    reviewed,
    pending,
    notAFit: { value: notAFitValue, source: reviewed.source, disagreements: [] },
    requested,
    shortfall,
    inProgress: progress?.in_progress === true,
    hasDisagreement: [qualified, reviewed, pending].some((n) => n.disagreements.length > 0),
  };
}

/**
 * The one line under the headline.
 *
 * Plain language on purpose. "10 qualified" is the answer; this is the context a
 * reader needs to trust it, and it must not reintroduce the counter wall it
 * replaced — one sentence, three numbers at most.
 */
export function summaryCaption(s: RunSummary): string {
  const parts = [`${s.reviewed.value} ${s.reviewed.value === 1 ? 'company' : 'companies'} reviewed`];
  if (s.pending.value > 0) parts.push(`${s.pending.value} still being checked`);
  if (s.inProgress) parts.push('still running');
  return parts.join(' · ');
}

/**
 * The headline itself.
 *
 * Says QUALIFIED, never "found". The distinction is the whole reason this file
 * exists: a row being on the page has never meant it qualified.
 */
export function summaryHeadline(s: RunSummary): string {
  const n = s.qualified.value;
  if (n === 0) return s.inProgress ? 'Still looking' : 'No qualified leads yet';
  return `${n} qualified ${n === 1 ? 'lead' : 'leads'}`;
}
