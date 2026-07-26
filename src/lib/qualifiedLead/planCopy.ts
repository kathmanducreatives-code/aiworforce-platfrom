// EXECUTION-PLAN COPY, PER WORKFLOW KIND.
//
// A qualified-lead run used to describe itself as "Scout sources signals through
// Apify → Aria ranks signals", in Fast mode, with "Find decision-makers" as a
// separate next step. None of that is what the company-first runtime does: it
// runs one compound execution that gates companies, resolves a decision-maker,
// verifies the employer and continues rounds until the CONTACT quota is met.
//
// These stages describe the PRODUCT outcome of each phase. They deliberately do
// NOT imply one paid provider node per line — the compound backend performs
// several of them inside a single round.
//
// Pure — no React, no network.

import type { WorkflowKind } from './contract.ts';

export interface PlanStage {
  id: string;
  label: string;
  /** The Agentory agent that owns this stage, using repo slugs. */
  agent: 'scout' | 'aria' | 'pilot';
}

/** The compound company-first stages, in the order the runtime performs them. */
export const QUALIFIED_LEAD_STAGES: PlanStage[] = [
  { id: 'find_companies', label: 'Find companies with relevant hiring signals', agent: 'scout' },
  { id: 'verify_company', label: 'Verify company fit and supporting evidence', agent: 'aria' },
  { id: 'find_person', label: 'Find Founder, Co-Founder or CEO', agent: 'scout' },
  { id: 'verify_employer', label: "Verify the person's current employer and role", agent: 'aria' },
  { id: 'prepare_contact', label: 'Prepare CONTACT-ready opportunities for review', agent: 'aria' },
  { id: 'continue_quota', label: 'Continue sourcing when the requested quota remains', agent: 'pilot' },
];

/** The pre-existing account-opportunity copy. Unchanged on purpose. */
export const ACCOUNT_OPPORTUNITY_STAGES: PlanStage[] = [
  { id: 'source_signals', label: 'Scout sources signals through Apify', agent: 'scout' },
  { id: 'rank_signals', label: 'Aria ranks signals', agent: 'aria' },
  { id: 'review_accounts', label: 'Review account opportunities in Workbench', agent: 'pilot' },
];

export function executionStages(kind: WorkflowKind | string | null | undefined): PlanStage[] {
  return kind === 'qualified_lead_sourcing' ? QUALIFIED_LEAD_STAGES : ACCOUNT_OPPORTUNITY_STAGES;
}

/**
 * Whether the "Fast mode" execution badge may be shown.
 *
 * Company-first sourcing is multi-round and quota-bound; calling it fast is a
 * false promise about both duration and shape.
 */
export function showsFastModeBadge(kind: WorkflowKind | string | null | undefined): boolean {
  return kind !== 'qualified_lead_sourcing';
}

/** Execution-mode chip text. Null hides the chip entirely. */
export function executionModeBadge(
  kind: WorkflowKind | string | null | undefined,
  rawMode: string | null | undefined,
): string | null {
  if (kind === 'qualified_lead_sourcing') return 'Company-first';
  return rawMode ?? null;
}

/**
 * A qualified-lead plan performs several stages inside one compound round, so
 * the UI must not claim one paid node per stage.
 */
export const COMPOUND_STAGE_NOTE =
  'These stages run inside one compound sourcing round — not six separate provider calls.';

/** Running-state line while a qualified-lead round is in flight. */
export function runningCopy(kind: WorkflowKind | string | null | undefined, stageId?: string | null): string {
  if (kind !== 'qualified_lead_sourcing') return 'Working…';
  const stage = QUALIFIED_LEAD_STAGES.find((s) => s.id === stageId);
  return stage ? `${stage.label}…` : 'Sourcing qualified leads…';
}
