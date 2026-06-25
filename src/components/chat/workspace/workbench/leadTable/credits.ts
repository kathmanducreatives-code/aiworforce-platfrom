import type { LeadTableRow } from '@/hooks/useLeadResults';
import type { LeadResultPanelAction } from '@/lib/chatActions';

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

export interface Recommendation {
  action: LeadResultPanelAction;
  label: string;
  reason: string;
  estimated_credits: number;
}

export function recommendNextAction(rows: LeadTableRow[], partial = false): Recommendation {
  if (rows.length === 0) {
    return { action: 'find_contacts', label: 'Find decision-makers', reason: 'No rows yet.', estimated_credits: 0 };
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
