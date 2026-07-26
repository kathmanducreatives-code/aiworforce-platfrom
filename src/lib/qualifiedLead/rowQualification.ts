// Adapt a persisted Workbench row to the canonical qualification record.
//
// The row carries BOTH the legacy analyst fields (fit_score, fit_tier,
// analyst_verdict, gate_decision) and the runtime's own answer inside the
// preserved jsonb. This is the single place that decides which is which, so no
// surface has to guess again.
//
// Pure — no React, no network.

import type { QualificationRecord } from './qualification.ts';

/** The subset of a Workbench row this adapter reads. */
export interface QualifiableRow {
  contact_status?: string | null;
  fit_score?: number | null;
  fit_tier?: string | null;
  analyst_verdict?: string | null;
  gate_decision?: string | null;
  company_name?: string | null;
  contact_name?: string | null;
  raw?: unknown;
}

/** `useLeadResults` sets row.raw to the DB row; the jsonb is one level deeper. */
function innerRaw(raw: unknown): Record<string, unknown> {
  const outer = (raw ?? {}) as Record<string, unknown>;
  const inner = outer.raw;
  return (inner && typeof inner === 'object' ? inner : outer) as Record<string, unknown>;
}

export function qualificationFromRow(row: QualifiableRow): QualificationRecord & { company: string | null; person: string | null } {
  const raw = innerRaw(row.raw);
  return {
    // The runtime's explicit answer, when the row was written by the
    // company-first path. Absent for legacy rows — precedence handles that.
    quota_eligible: typeof raw.quota_eligible === 'boolean' ? raw.quota_eligible : null,
    disposition: (raw.disposition as string) ?? (raw.verdict as string) ?? null,
    decision_maker_status: (raw.decision_maker_status as string) ?? null,
    employer_match_status: (raw.employer_match_status as string) ?? null,
    gate_decision: row.gate_decision ?? (raw.gate_decision as string) ?? null,
    analyst_verdict: row.analyst_verdict ?? (raw.analyst_verdict as string) ?? null,
    contact_status: row.contact_status ?? null,
    // Descriptive context only.
    fit_score: row.fit_score ?? null,
    fit_tier: row.fit_tier ?? null,
    company: row.company_name ?? null,
    person: row.contact_name ?? (raw.person_name as string) ?? null,
  };
}
