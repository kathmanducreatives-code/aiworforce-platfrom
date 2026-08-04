// WORKBENCH HEADER COUNTS — accounts and final leads kept strictly apart.
//
// The old header was:
//
//     FOUND | CONTACT-READY | NEEDS CONTACT | ENRICHABLE
//
// where FOUND was `items.length` (accounts) and CONTACT-READY was
// `contact_status !== 'needs_contact'` (a contact field, not a qualification).
// For a request asking for five CONTACT-ready LEADS, "5 FOUND" read as the quota
// being met while zero leads existed.
//
// Account-shaped counts and lead-shaped counts now live in separate, separately
// labelled groups, and the lead group comes from the quota adapter alone.
//
// Pure — no React, no network.

import { resolveQualification, type QualificationRecord } from './qualification.ts';
import type { QuotaProgress } from './quotaProgress.ts';

export interface WorkbenchCount {
  key: string;
  label: string;
  value: number;
  /** account-shaped vs final-lead-shaped. They are never summed together. */
  group: 'account' | 'lead';
  tone: 'neutral' | 'positive' | 'warning';
}

export interface WorkbenchCountsInput {
  /** Rows visible in the table. Visibility never implies quota credit. */
  rows: Array<QualificationRecord & { website?: string | null; enrichment_status?: string | null }>;
  progress: QuotaProgress | null;
}

/**
 * ACCOUNTS FOUND / QUALIFIED COMPANIES are account-shaped.
 * DECISION-MAKERS VERIFIED / CONTACT-READY / REMAINING are lead-shaped.
 */
export function buildWorkbenchCounts({ rows, progress }: WorkbenchCountsInput): WorkbenchCount[] {
  const resolved = rows.map((r) => resolveQualification(r));

  // ACCOUNTS FOUND is discovery. It says nothing about qualification, and the
  // two must never collapse into each other.
  const accountsFound = rows.length;

  // EVALUATED is "something actually judged this row".
  const evaluated = resolved.filter((q) => q.evaluated).length;

  // QUALIFIED COMPANIES counts EXPLICIT positive verdicts only.
  //
  // This was `q.level !== 'not_qualified'`, which counted every row that had not
  // been actively rejected — including rows nothing had looked at. TEST plan
  // edb4cbf6-…-65b1d3fbbcda reported 20 qualified companies for a run whose
  // `qualified_company_keys` was empty. Absence of a rejection is not a pass.
  //
  // When the capability engine reports its own qualified set, that set is the
  // authority; the row-level fallback exists for legacy runs.
  const qualifiedCompanies = progress?.qualifiedCompanies
    ?? resolved.filter((q) => q.qualified).length;
  // Same discipline: only rows that were evaluated AND are not still waiting on
  // a decision-maker count. An unevaluated row has no verified decision-maker.
  const decisionMakersVerified = progress?.verifiedDecisionMakers
    ?? resolved.filter((q) => q.evaluated && q.level !== 'needs_decision_maker'
      && q.level !== 'not_evaluated').length;
  // CONTACT-READY comes from the quota contract, or from precedence — never from
  // `contact_status`, which only says whether a contact field is populated.
  const contactReady = progress?.eligible ?? resolved.filter((q) => q.contactReady).length;
  const remaining = progress?.remaining ?? 0;

  return [
    { key: 'accounts_found', label: 'ACCOUNTS FOUND', value: accountsFound, group: 'account', tone: 'neutral' },
    { key: 'evaluated', label: 'EVALUATED', value: evaluated, group: 'account', tone: 'neutral' },
    { key: 'qualified_companies', label: 'QUALIFIED COMPANIES', value: qualifiedCompanies, group: 'account', tone: 'neutral' },
    { key: 'decision_makers_verified', label: 'DECISION-MAKERS VERIFIED', value: decisionMakersVerified, group: 'lead', tone: 'neutral' },
    { key: 'contact_ready', label: 'CONTACT-READY', value: contactReady, group: 'lead', tone: contactReady > 0 ? 'positive' : 'warning' },
    { key: 'remaining', label: 'REMAINING', value: remaining, group: 'lead', tone: remaining > 0 ? 'warning' : 'positive' },
  ];
}

export interface CardQuotaNote {
  /** Shown on the card so a visible row can never imply quota progress. */
  text: string;
  tone: 'positive' | 'warning';
}

/**
 * The per-card statement. A NEEDS_CONTACT / NEEDS_REVIEW row stays visible and
 * reviewable, but says out loud that it gives no CONTACT quota credit.
 */
export function cardQuotaNote(rec: QualificationRecord): CardQuotaNote {
  const q = resolveQualification(rec);
  if (q.contactReady) return { text: 'Counts as 1 CONTACT-ready lead', tone: 'positive' };
  return { text: `${q.displayLines[0]} — 0 CONTACT quota credit`, tone: 'warning' };
}
