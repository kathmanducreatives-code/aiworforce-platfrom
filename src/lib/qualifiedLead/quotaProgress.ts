// THE ONE ADAPTER FOR QUALIFIED-LEAD PROGRESS.
//
// FORBIDDEN INPUTS — every one of these produced a wrong number at least once:
//
//   acceptedAccounts.length      a company with no person is not a lead
//   visible Workbench cards      NEEDS_REVIEW rows are visible but worth 0
//   raw jobs                     11 job posts is not 11 leads
//   qualified company count      1 qualified company is not 1 CONTACT lead
//   persisted account count      a write is not a delivery
//   successful database writes   v96 reported `completed` with 0 CONTACT
//
// CONTACT-ready progress comes from the backend quota contract when present, and
// otherwise from per-candidate `quota_eligible` resolved through the canonical
// precedence helper. Nothing else may promote a number.
//
// Pure — no React, no network.

import { resolveQualification, type QualificationRecord } from './qualification.ts';
import type { QuotaPolicy } from './contract.ts';

/** The flat quota fields run-agent returns for a company-first run. */
export interface QuotaBackendFields {
  requested_leads?: number | null;
  eligible_leads?: number | null;
  remaining_leads?: number | null;
  quota_policy?: string | null;
  terminal_status?: string | null;
  task_status?: string | null;
  rounds_completed?: number | null;
  /** Signal funnel counters the runtime already computed. */
  counts?: {
    rawJobs?: number | null;
    verifiedCompanies?: number | null;
    candidates?: number | null;
    contact?: number | null;
  } | null;
}

export interface QuotaCandidate extends QualificationRecord {
  company?: string | null;
  person?: string | null;
}

export interface QuotaMetric {
  key: string;
  label: string;
  value: number;
}

export interface QuotaProgress {
  requested: number;
  /** CONTACT-ready leads DELIVERED. Never accounts, cards, jobs or writes. */
  eligible: number;
  remaining: number;
  quotaPolicy: QuotaPolicy;
  hiringSignalsReviewed: number;
  qualifiedCompanies: number;
  verifiedDecisionMakers: number;
  roundsCompleted: number;
  terminalStatus: string | null;
  taskStatus: string | null;
  /** The five headline metrics, in display order. */
  metrics: QuotaMetric[];
  /** "0 of 5 CONTACT-ready leads" */
  headline: string;
  /** Every line of the progress block, in order. */
  lines: string[];
  /** Which input actually decided `eligible` — backend field or candidates. */
  eligibleSource: 'backend_quota' | 'candidate_precedence' | 'none';
}

export function buildQuotaProgress(
  backend: QuotaBackendFields | null | undefined,
  candidates: QuotaCandidate[] = [],
): QuotaProgress {
  const resolved = candidates.map((c) => ({ candidate: c, q: resolveQualification(c) }));

  // eligible: prefer the runtime's own count; fall back to precedence over
  // candidates. NEVER to accounts, cards, jobs or persistence outcomes.
  const backendEligible = numOrNull(backend?.eligible_leads);
  const eligible = backendEligible ?? (candidates.length ? resolved.filter((r) => r.q.contactReady).length : 0);
  const eligibleSource: QuotaProgress['eligibleSource'] =
    backendEligible != null ? 'backend_quota' : candidates.length ? 'candidate_precedence' : 'none';

  const requested = numOrNull(backend?.requested_leads) ?? 0;
  const remaining = numOrNull(backend?.remaining_leads) ?? Math.max(0, requested - eligible);

  // A company can be qualified and still deliver zero CONTACT-ready leads. Both
  // numbers are reported; neither is allowed to stand in for the other.
  const qualifiedCompanies = numOrNull(backend?.counts?.verifiedCompanies)
    ?? new Set(resolved.filter((r) => r.q.level !== 'not_qualified').map((r) => r.candidate.company ?? '')).size;
  const verifiedDecisionMakers = resolved.filter((r) => r.q.level !== 'needs_decision_maker' && !!r.candidate.person).length;
  const hiringSignalsReviewed = numOrNull(backend?.counts?.rawJobs) ?? 0;

  const headline = `${eligible} of ${requested} CONTACT-ready ${requested === 1 ? 'lead' : 'leads'}`;

  return {
    requested,
    eligible,
    remaining,
    quotaPolicy: (backend?.quota_policy as QuotaPolicy) ?? 'contact_only',
    hiringSignalsReviewed,
    qualifiedCompanies,
    verifiedDecisionMakers,
    roundsCompleted: numOrNull(backend?.rounds_completed) ?? 0,
    terminalStatus: backend?.terminal_status ?? null,
    taskStatus: backend?.task_status ?? null,
    metrics: [
      { key: 'hiring_signals_reviewed', label: 'Hiring signals reviewed', value: hiringSignalsReviewed },
      { key: 'qualified_companies', label: 'Qualified companies', value: qualifiedCompanies },
      { key: 'verified_decision_makers', label: 'Verified decision-makers', value: verifiedDecisionMakers },
      { key: 'contact_ready_leads', label: 'CONTACT-ready leads', value: eligible },
      { key: 'remaining_quota', label: 'Remaining CONTACT quota', value: remaining },
    ],
    headline,
    lines: [
      `${hiringSignalsReviewed} hiring ${hiringSignalsReviewed === 1 ? 'signal' : 'signals'} reviewed`,
      `${qualifiedCompanies} qualified ${qualifiedCompanies === 1 ? 'company' : 'companies'}`,
      `${verifiedDecisionMakers} verified decision-${verifiedDecisionMakers === 1 ? 'maker' : 'makers'}`,
      headline,
      `${remaining} remaining`,
    ],
    eligibleSource,
  };
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
