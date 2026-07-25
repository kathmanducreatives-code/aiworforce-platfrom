// Canonical per-lead state for Lead Detail.
//
// WHY
//   Lead Detail computed its three "Locked" states from FLAT sourcing-era
//   columns:
//
//     enrichLocked = row.enrichment_status !== 'enriched'
//     draftLocked  = row.draft_status !== 'drafted' && !== 'approved'
//     contactLocked = row.contact_status === 'needs_contact'
//
//   Those columns are written by the sourcing pipeline, not by the Workbench
//   stages. A 2026-07-21 production lead had
//   `agentory_workbench.company_research.status = succeeded`,
//   `company_enrichment.status = "enriched"`, and a persisted 210-char opener —
//   yet Lead Detail showed ENRICHMENT "Locked" and PERSONALIZED MESSAGE
//   "Locked", because the flat columns had never been updated. The opener path
//   in particular creates no draft row at all, so `draft_status` is never set.
//
//   Same failure class as the CSV exporting "Not generated" for an opener that
//   existed (fixed in PR #75): the canonical state lives in the workbench
//   namespace, and each surface was re-deriving its own from stale fields.
//
// Success-preserving: a later failed retry never demotes a stage that has a
// stored success. Pure — no React, no network.

import { hydrateOutreachStage } from './outreachStageView';
import type { OutreachStageView } from './workbenchAccountView';

export type ResearchState =
  | 'not_started'
  | 'ready'
  | 'previous_result_latest_failed'
  | 'failed_no_previous';

export type OutreachState =
  | 'not_generated'
  | 'draft_ready'
  | 'previous_draft_latest_failed'
  | 'failed_no_previous';

export interface LeadDetailState {
  research: ResearchState;
  /** True only when there is genuinely nothing successful to show. */
  researchLocked: boolean;
  outreach: OutreachState;
  outreachLocked: boolean;
  /** The persisted opener, when one exists. */
  opener: OutreachStageView | null;
  /**
   * Who the opener was actually generated for (PR #78). Null for drafts that
   * predate that provenance — those must be labelled unknown, never guessed.
   */
  selectedRecipientName: string | null;
  selectedRecipientTitle: string | null;
  /** True when an opener exists but carries no recorded recipient. */
  recipientUnknownForHistoricalDraft: boolean;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** The jsonb sits one level deeper than the DB row — row.raw.raw. */
function leadJsonb(raw: unknown): Record<string, unknown> {
  const dbRow = isObj(raw) ? raw : {};
  return isObj(dbRow.raw) ? dbRow.raw : {};
}

/** Minimal row shape this module needs. Flat fields are LEGACY fallbacks only. */
export interface LeadStateInput {
  raw?: unknown;
  enrichment_status?: string | null;
  draft_status?: string | null;
}

/**
 * Derive Lead Detail's canonical state.
 *
 * Precedence for every stage: workbench stage success → canonical payload →
 * legacy flat column. A stage is Locked ONLY when no successful result exists
 * in any of those.
 */
export function deriveLeadDetailState(row: LeadStateInput): LeadDetailState {
  const jsonb = leadJsonb(row.raw);
  const workbench = isObj(jsonb.agentory_workbench) ? jsonb.agentory_workbench : {};

  // ---- research -----------------------------------------------------------
  const researchStage = isObj(workbench.company_research) ? workbench.company_research : {};
  const researchSuccess = isObj(researchStage.last_success) ? researchStage.last_success : null;
  const researchStatus = str(researchStage.status);

  // An enrichment blob written by sourcing counts as a real success too — it is
  // the same information, produced by a different path.
  const enrichmentBlob = isObj(jsonb.company_enrichment) ? jsonb.company_enrichment : null;
  const enrichmentUsable = !!enrichmentBlob && str(enrichmentBlob.status) === 'enriched';

  // Legacy flat column, last.
  const flatEnriched = str(row.enrichment_status) === 'enriched';

  const hasResearch = !!researchSuccess || enrichmentUsable || flatEnriched;
  const researchAttemptFailed = researchStatus !== null
    && researchStatus !== 'succeeded'
    && researchStatus !== 'not_started';

  let research: ResearchState;
  if (hasResearch) {
    research = researchAttemptFailed ? 'previous_result_latest_failed' : 'ready';
  } else if (researchAttemptFailed) {
    research = 'failed_no_previous';
  } else {
    research = 'not_started';
  }

  // ---- outreach -----------------------------------------------------------
  const outreachStage = hydrateOutreachStage(jsonb);
  const opener = outreachStage.last_success?.opener ? outreachStage.last_success : null;

  // The opener path writes NO draft row, so draft_status is only meaningful for
  // the legacy full_draft flow.
  const flatDrafted = row.draft_status === 'drafted' || row.draft_status === 'approved';

  const latestOutreachFailed = outreachStage.latest_status !== null
    && outreachStage.latest_status !== 'succeeded'
    && outreachStage.latest_status !== 'not_started';

  const hasOutreach = !!opener || flatDrafted;

  let outreach: OutreachState;
  if (hasOutreach) {
    outreach = latestOutreachFailed ? 'previous_draft_latest_failed' : 'draft_ready';
  } else if (latestOutreachFailed) {
    outreach = 'failed_no_previous';
  } else {
    outreach = 'not_generated';
  }

  // ---- recipient ----------------------------------------------------------
  // ONLY the persisted generation recipient. Never a separately-derived contact
  // — showing "Recommended contact: Amy" beside an opener written for Kenneth is
  // precisely the defect this replaces.
  const selectedRecipientName = opener?.selected_recipient_name ?? null;
  const selectedRecipientTitle = opener?.selected_recipient_title ?? null;

  return {
    research,
    researchLocked: !hasResearch,
    outreach,
    outreachLocked: !hasOutreach,
    opener,
    selectedRecipientName,
    selectedRecipientTitle,
    recipientUnknownForHistoricalDraft: !!opener && !selectedRecipientName,
  };
}

export const RESEARCH_STATE_COPY: Record<ResearchState, string> = {
  not_started: 'Not started',
  ready: 'Ready',
  previous_result_latest_failed: 'Previous result · latest refresh failed',
  failed_no_previous: 'Failed · no previous result',
};

export const OUTREACH_STATE_COPY: Record<OutreachState, string> = {
  not_generated: 'Not generated',
  draft_ready: 'Draft ready',
  previous_draft_latest_failed: 'Previous draft · latest retry failed',
  failed_no_previous: 'Failed · no previous draft',
};

export const RECIPIENT_UNKNOWN_COPY = 'Not recorded for this older draft';
