// Account-centric Workbench row state + a pure stage reducer. No React imports,
// so this is unit-testable alongside the other src/lib models.
//
// THE DEFECT THIS REPLACES
//
// The Workbench held ONE action slot per lead:
//
//     setRowActions((s) => ({ ...s, [r.id]: ra }))
//
// and LeadTable rendered each cell conditionally on `rowActions[id]?.kind`.
// Running Generate outreach therefore overwrote the research result and the
// research column vanished — completed account intelligence was being treated
// as temporary action output.
//
// Here every stage gets its OWN slot. An action updates one stage; the others
// are carried forward untouched. A failed retry keeps the last success.

import type { LeadActionKind } from './leadActionRequest';
import type { RowDisplayStatus } from './leadActionOutcome';
import type { DecisionMakerRowView } from './decisionMakerDisplay';
import type { CompanyResearchView } from './companyResearchDisplay';
import type { IcpSnapshot } from './icpSnapshot';

export type WorkbenchStage =
  | 'company_research'
  | 'decision_makers'
  | 'contact_enrichment'
  | 'outreach';

/** Maps an action to the single stage it may update. */
export const STAGE_FOR_ACTION: Record<LeadActionKind, WorkbenchStage> = {
  research_company: 'company_research',
  find_decision_makers: 'decision_makers',
  find_contact_details: 'contact_enrichment',
  generate_outreach: 'outreach',
};

export interface StageAttempt {
  status: RowDisplayStatus;
  reason_code?: string;
  message?: string;
  attempted_at: string;
  succeeded_at?: string;
  failure_reason?: string;
}

export interface AccountStage<T> {
  /** Latest attempt — may be a failure. */
  attempt: StageAttempt | null;
  /** Last payload that actually succeeded. NEVER cleared by a later failure. */
  last_success: T | null;
}

/**
 * The outreach stage as the Workbench actually stores it.
 *
 * This used to be `{ status; personalization_depth?; draft_id? }`, so a
 * successful personalized opener was reduced to its status during
 * reconciliation and the generated message was silently discarded — the row
 * read "Draft ready for approval" with nothing to show and the CSV exported
 * "Not generated".
 *
 * `opener` and friends mirror the persisted
 * `raw.agentory_workbench.outreach.last_success` payload. `draft_id` stays for
 * the legacy full_draft path, which is unaffected.
 */
export interface OutreachStageView {
  status: string;
  reason_code?: string;
  /** The generated opening line. Null for the legacy full_draft path. */
  opener?: string | null;
  alternative_opener?: string | null;
  personalization_depth?: string;
  used_evidence_ids?: string[];
  approval_required?: boolean;
  approval_status?: string;
  generated_at?: string;
  persisted?: boolean;
  retryable?: boolean;
  output_mode?: string;
  /** Always false on this path — nothing here can send. */
  sent?: boolean;
  selected_contact_id?: string | null;
  selected_recipient_name?: string | null;
  selected_recipient_title?: string | null;
  /** Legacy full_draft only. */
  draft_id?: string;
}

/**
 * What a Find Contact Details unlock established, as the cell renders it.
 *
 * ── MIRRORS `ContactEnrichmentState` ON THE BACKEND ─────────────────────────
 *
 * This was `{ email_status: string; linkedin_available: boolean }` — a stage
 * modelled but never written, because no action produced it. The backend now
 * writes the full record, and a cell that only knew the status could show that
 * an address exists without being able to show it.
 *
 * `email_status` has THREE values, and the middle one is the reason this type
 * exists rather than a bare `email: string | null`:
 *
 *   email_found    an address, quoted from the provider, never constructed
 *   not_found      the lookup ran, was PAID FOR, and there is none. An answer.
 *   provider_error nothing was established; a retry is right
 */
export interface ContactEnrichmentView {
  email_status: 'email_found' | 'not_found' | 'provider_error';
  business_email: string | null;
  email_source: string | null;
  person_full_name: string | null;
  person_linkedin_url: string | null;
  linkedin_available: boolean;
  reason: string;
}

export interface WorkbenchAccountView {
  lead_candidate_id: string;
  company_research: AccountStage<CompanyResearchView>;
  decision_makers: AccountStage<DecisionMakerRowView>;
  contact_enrichment: AccountStage<ContactEnrichmentView>;
  outreach: AccountStage<OutreachStageView>;
  icp_snapshot: IcpSnapshot | null;
  updated_at: string | null;
}

function emptyStage<T>(): AccountStage<T> {
  return { attempt: null, last_success: null };
}

export function emptyAccountView(leadCandidateId: string): WorkbenchAccountView {
  return {
    lead_candidate_id: leadCandidateId,
    company_research: emptyStage(),
    decision_makers: emptyStage(),
    contact_enrichment: emptyStage(),
    outreach: emptyStage(),
    icp_snapshot: null,
    updated_at: null,
  };
}

const SUCCESS_STATUSES: ReadonlySet<RowDisplayStatus> = new Set<RowDisplayStatus>([
  'succeeded',
  'needs_manual_review',
]);

export interface StageUpdate<T> {
  stage: WorkbenchStage;
  lead_candidate_id: string;
  status: RowDisplayStatus;
  reason_code?: string;
  message?: string;
  /** Only stored when the attempt actually succeeded. */
  payload?: T | null;
  /** Recomputed only when this action produced new grounds for it. */
  icp_snapshot?: IcpSnapshot | null;
  now: string;
}

/**
 * Merge ONE stage update into the account view.
 *
 * Every other stage is carried through by reference. This is the whole fix for
 * "research disappears when I click Generate outreach": the reducer physically
 * cannot touch a stage it was not given.
 */
export function mergeWorkbenchStage<T>(
  prev: WorkbenchAccountView,
  update: StageUpdate<T>,
): WorkbenchAccountView {
  const succeeded = SUCCESS_STATUSES.has(update.status);

  const attempt: StageAttempt = {
    status: update.status,
    reason_code: update.reason_code,
    message: update.message,
    attempted_at: update.now,
    succeeded_at: succeeded
      ? update.now
      : prev[update.stage].attempt?.succeeded_at,
    failure_reason: succeeded ? undefined : (update.reason_code ?? update.status),
  };

  const merged: AccountStage<unknown> = {
    attempt,
    // A later failure NEVER replaces a previous success with null/empty.
    last_success: succeeded && update.payload != null
      ? update.payload
      : prev[update.stage].last_success,
  };

  return {
    ...prev,
    [update.stage]: merged,
    // ICP is recomputed only when the caller supplies a new one; otherwise the
    // previous snapshot survives every action.
    icp_snapshot: update.icp_snapshot !== undefined
      ? update.icp_snapshot
      : prev.icp_snapshot,
    updated_at: update.now,
  } as WorkbenchAccountView;
}

/**
 * Apply a batch of per-lead updates. Each lead is merged independently so one
 * lead's action can never disturb another lead's stages.
 */
export function mergeBatch(
  views: Record<string, WorkbenchAccountView>,
  updates: Array<StageUpdate<unknown>>,
): Record<string, WorkbenchAccountView> {
  const next = { ...views };
  for (const u of updates) {
    const prev = next[u.lead_candidate_id] ?? emptyAccountView(u.lead_candidate_id);
    next[u.lead_candidate_id] = mergeWorkbenchStage(prev, u);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Derived row presentation
// ---------------------------------------------------------------------------

export function hasCompletedResearch(view: WorkbenchAccountView): boolean {
  return !!view.company_research.last_success?.usable;
}

export function hasVerifiedDecisionMaker(view: WorkbenchAccountView): boolean {
  const dm = view.decision_makers.last_success;
  return !!dm?.primary_decision_maker;
}

export type NextAction =
  | 'research_company'
  | 'find_decision_makers'
  | 'enrich_contact'
  | 'generate_outreach'
  | 'review_draft'
  | 'resolve_missing_evidence'
  | 'manual_review'
  | 'stop';

/**
 * Recommend — never trigger. Every action stays user-initiated.
 */
export function nextAction(view: WorkbenchAccountView): NextAction {
  if (view.icp_snapshot?.status === 'excluded') return 'stop';

  const research = view.company_research.last_success;
  if (!research) return 'research_company';
  if (!research.usable) return 'resolve_missing_evidence';

  const dm = view.decision_makers.last_success;
  if (!dm?.primary_decision_maker) {
    if ((dm?.manual_review_count ?? 0) > 0) return 'manual_review';
    return 'find_decision_makers';
  }

  if (view.outreach.last_success) return 'review_draft';
  return 'generate_outreach';
}

export const NEXT_ACTION_COPY: Record<NextAction, string> = {
  research_company: 'Research company',
  find_decision_makers: 'Find decision-makers',
  enrich_contact: 'Enrich contact',
  generate_outreach: 'Generate outreach',
  review_draft: 'Review draft',
  resolve_missing_evidence: 'Resolve missing evidence',
  manual_review: 'Review profiles',
  stop: 'Excluded — skip',
};
