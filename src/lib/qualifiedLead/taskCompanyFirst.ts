// THE PERSISTED TASK ROW, READ AS A COMPANY-FIRST RESPONSE.
//
// `QualifiedLeadProgressCard` renders quota and continuation from a
// `CompanyFirstResponse`. Live, that object is the run-agent HTTP reply. After a
// reload — or any realtime update — the only copy that exists is the one
// run-agent persisted on `tasks.result`.
//
// This mapping already existed, inline in SummaryView.tsx. It is lifted here
// unchanged in behaviour so it can be tested directly: it is what decides
// whether "Continue sourcing" appears and whether a run that delivered nothing
// says so, and neither deserves to be untested inside a component.
//
// READ-ONLY. It maps fields; it never counts rows, judges quota or decides
// continuation — `buildQuotaProgress` and `buildContinuationView` own those.

import type { CompanyFirstResponse } from './continuation';

/** The persisted shape this reads. Deliberately loose: it is a jsonb column. */
export interface TaskLike {
  id?: string | null;
  status?: string | null;
  result?: unknown;
}

/** Quota fields the progress card reads alongside the continuation fields. */
export interface CompanyFirstQuotaFields {
  quota_policy?: string | null;
  counts?: Record<string, unknown> | null;
}

export type TaskCompanyFirstResponse = CompanyFirstResponse & CompanyFirstQuotaFields;

function obj(v: unknown): Record<string, any> | null {
  return v && typeof v === 'object' ? (v as Record<string, any>) : null;
}

/**
 * Map a persisted task row to the response the progress card understands.
 *
 * Returns null when the task carries no company-first block — a non-Lead
 * workflow, or a task that has not started — so the card is not rendered at all.
 */
export function companyFirstResponseFromTask(task: TaskLike | null | undefined): TaskCompanyFirstResponse | null {
  const result = obj(task?.result);
  const companyFirst = obj(result?.company_first);
  if (!companyFirst) return null;

  const continuation = obj(companyFirst.continuation);
  const quota = obj(companyFirst.quota);

  return {
    // Prefer the separated result field; fall back to the company-first block
    // for tasks written before the PR #115 status split.
    terminal_status: (result?.terminal_status as string | undefined) ?? companyFirst.status ?? null,
    task_status: (result?.task_status as string | undefined) ?? task?.status ?? null,
    // The DATABASE LIFECYCLE state, kept distinct from workflow progress. This is
    // what stops a Continue button appearing on a failed or skipped row.
    row_status: task?.status ?? null,
    task_id: task?.id ?? null,
    continuation_token: continuation?.continuation_token ?? null,
    next_round: continuation?.next_round ?? null,
    checkpoint_at: continuation?.checkpoint_at ?? null,
    rounds_completed: companyFirst.rounds_attempted ?? null,
    requested_leads: quota?.requested_leads ?? null,
    eligible_leads: quota?.eligible_leads ?? null,
    remaining_leads: quota?.remaining_leads ?? null,
    quota_policy: quota?.quota_policy ?? null,
    counts: (companyFirst.counts as Record<string, unknown> | undefined) ?? null,
  };
}

/** The candidate rows the quota adapter scores, read off the same block. */
export function companyFirstCandidatesFromTask(task: TaskLike | null | undefined): Record<string, unknown>[] {
  const companyFirst = obj(obj(task?.result)?.company_first);
  const items = companyFirst?.items;
  if (!Array.isArray(items)) return [];
  return items.map((it: Record<string, any>) => ({
    company: it.company ?? null,
    person: it.person ?? null,
    quota_eligible: it.quotaEligible ?? null,
    disposition: it.verdict ?? null,
    employer_match_status: it.employerMatch ?? null,
    decision_maker_status: it.person ? 'verified' : 'missing',
    persistence_reason: it.persistenceReason ?? null,
  }));
}
