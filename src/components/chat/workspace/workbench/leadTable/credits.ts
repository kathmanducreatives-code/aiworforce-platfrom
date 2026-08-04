import type { LeadTableRow } from '@/hooks/useLeadResults';
import type { LeadResultPanelAction } from '@/lib/chatActions';
// RELATIVE, not the `@/` alias: this is a VALUE import and the alias is a
// bundler-only convention that does not resolve outside Vite.
import {
  isExplicitlyQualified, type QualificationRecord,
} from '../../../../../lib/qualifiedLead/qualification';

/**
 * Local-only credit estimates. NO ledger writes — these are presented to the
 * user for confirmation before any dispatched action.
 */
export function estimateCredits(action: LeadResultPanelAction, rows: LeadTableRow[]): number {
  switch (action) {
    case 'find_contacts':
      return rows.filter((r) => r.contact_status === 'needs_contact').length;
    case 'research_company':
      return rows.filter((r) => !!r.website && r.enrichment_status !== 'enriched').length;
    case 'draft_outreach':
      return rows.filter((r) => r.contact_status !== 'needs_contact' && r.draft_status !== 'drafted' && r.draft_status !== 'approved').length * 2;
    case 'enrich':
      return rows.filter((r) => !!r.website).length;
    case 'enrich_and_draft':
      return estimateCredits('research_company', rows) + estimateCredits('draft_outreach', rows);
    case 'rank':
      return Math.max(1, Math.ceil(rows.length / 10));
    case 'export_csv':
    case 'save_to_signal_feed':
      return 0;
    default:
      return 0;
  }
}

/** Why a recommended action cannot be dispatched yet. */
export type UnmetPrerequisite =
  | 'no_qualified_companies'
  | 'no_qualified_companies_ready_for_people_search'
  | 'no_verified_person';

export interface Recommendation {
  action: LeadResultPanelAction;
  label: string;
  reason: string;
  estimated_credits: number;
  /**
   * False when the action's prerequisite does not exist yet.
   *
   * Optional so every existing caller and test stays valid; absent means enabled,
   * which is the pre-existing behaviour for every recommendation that had one.
   */
  enabled?: boolean;
  unmet_prerequisite?: UnmetPrerequisite;
}

/** A recommendation may be dispatched only when its prerequisite exists. */
export function isRecommendationDispatchable(r: Recommendation): boolean {
  return r.enabled !== false;
}

/**
 * THE PEOPLE GATE, ON THE DIRECT-ACTION PATH.
 *
 * The capability engine refuses a people provider until the whole company chain
 * has completed and a company carries an explicit Brain pass. The Workbench
 * button bypassed that engine entirely, so it could buy people searches for
 * companies that had never been qualified — which is exactly what the 20 rows on
 * TEST plan edb4cbf6-…-65b1d3fbbcda would have done.
 *
 * A row is eligible only when something EXPLICITLY qualified it. Absence of a
 * rejection is not a pass.
 */
export function peopleSearchEligibleRows(rows: LeadTableRow[]): LeadTableRow[] {
  return rows.filter((r) => isExplicitlyQualified(r as QualificationRecord));
}

export function recommendNextAction(rows: LeadTableRow[], partial = false): Recommendation {
  // FAIL CLOSED BEFORE ANY OTHER RECOMMENDATION. Rows can exist in the table
  // while none of them has been qualified; visibility is not qualification.
  if (rows.length > 0 && peopleSearchEligibleRows(rows).length === 0) {
    return {
      action: 'find_contacts',
      label: 'Find decision-makers',
      reason:
        'None of these companies carries an explicit Company Brain pass yet, so a people search ' +
        'would be paid for against unqualified companies. Qualify companies first.',
      estimated_credits: 0,
      enabled: false,
      unmet_prerequisite: 'no_qualified_companies_ready_for_people_search',
    };
  }
  // NO ROWS MEANS NO PREREQUISITE. "Find decision-makers" searches people AT
  // qualified companies; with no qualified company there is nothing to search,
  // and offering it invites a paid call that cannot produce a lead. The honest
  // recommendation at this point is more company sourcing, and the action is
  // returned DISABLED so the panel cannot dispatch it.
  if (rows.length === 0) {
    return {
      action: 'find_contacts',
      label: 'Find decision-makers',
      reason: 'No companies have passed the Company Brain yet, so there is nobody to search for. Continue sourcing companies first.',
      estimated_credits: 0,
      enabled: false,
      unmet_prerequisite: 'no_qualified_companies',
    };
  }
  const missingWebsite = rows.filter((r) => r.domain_status === 'missing').length;
  const noContact = rows.filter((r) => r.contact_status === 'needs_contact').length;
  const hasContact = rows.length - noContact;
  const noEnrich = rows.filter((r) => r.enrichment_status !== 'enriched').length;
  const noDraft = rows.filter((r) => r.draft_status !== 'drafted' && r.draft_status !== 'approved').length;

  if (noContact > 0) {
    return {
      action: 'find_contacts',
      label: 'Find decision-makers',
      reason: 'Scout can look for Founder, CEO, Head of Growth, or VP Sales contacts at these accounts.',
      estimated_credits: estimateCredits('find_contacts', rows),
    };
  }
  if (hasContact > 0 && noEnrich === rows.length) {
    return {
      action: 'research_company',
      label: 'Research company context',
      reason: 'Enrichment will make outreach more personalized.',
      estimated_credits: estimateCredits('research_company', rows),
    };
  }
  if (hasContact > 0 && noDraft > 0 && noEnrich < rows.length) {
    return {
      action: 'draft_outreach',
      label: 'Generate approval-ready outreach',
      reason: 'Penn can now write personalized messages using company context.',
      estimated_credits: estimateCredits('draft_outreach', rows),
    };
  }
  if (partial) {
    return { action: 'find_contacts', label: 'Broaden search', reason: 'Scout returned a partial result.', estimated_credits: 0 };
  }
  if (missingWebsite > 0) {
    return {
      action: 'research_company',
      label: 'Find domains',
      reason: 'Firecrawl needs websites before enrichment.',
      estimated_credits: 0,
    };
  }
  return { action: 'save_to_signal_feed', label: 'Save to Signal Feed', reason: 'All set — keep these for later.', estimated_credits: 0 };
}

export const ACTION_LABEL: Record<LeadResultPanelAction, string> = {
  find_contacts: 'Find decision-makers',
  research_company: 'Research company',
  draft_outreach: 'Generate outreach',
  enrich_and_draft: 'Enrich + draft',
  enrich: 'Enrich',
  rank: 'Rank by fit',
  export_csv: 'Export CSV',
  save_to_signal_feed: 'Save',
};
