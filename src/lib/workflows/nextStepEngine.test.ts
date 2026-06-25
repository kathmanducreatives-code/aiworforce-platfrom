import { describe, it, expect } from 'vitest';
import { getRecommendedNextStep, type NextStepParams } from './nextStepEngine';
import { DEFAULT_TOOL_AVAILABILITY } from './tools';

describe('getRecommendedNextStep', () => {
  const capsFull = {
    ...DEFAULT_TOOL_AVAILABILITY,
    apify_jobs: { key: 'apify_jobs' as const, enabled: true, configured: true },
    apify_people: { key: 'apify_people' as const, enabled: true, configured: true },
    firecrawl: { key: 'firecrawl' as const, enabled: true, configured: true },
  };

  const capsMissingApify = {
    ...DEFAULT_TOOL_AVAILABILITY,
    apify_jobs: { key: 'apify_jobs' as const, enabled: false, configured: false },
    apify_people: { key: 'apify_people' as const, enabled: false, configured: false },
  };

  const capsMissingFirecrawl = {
    ...capsFull,
    firecrawl: { key: 'firecrawl' as const, enabled: false, configured: false },
  };

  it('GTM goal: returns find_hiring_signal_accounts when no rows are present', () => {
    const res = getRecommendedNextStep({
      companyBrain: { founder: { first_help_goal: 'find_leads' } },
      workbenchRows: [],
      capabilities: capsFull,
    });
    expect(res.action_id).toBe('find_hiring_signal_accounts');
    expect(res.enabled).toBe(true);
  });

  it('GTM goal: locks find_hiring_signal_accounts when apify_jobs capability is missing', () => {
    const res = getRecommendedNextStep({
      companyBrain: { founder: { first_help_goal: 'find_leads' } },
      workbenchRows: [],
      capabilities: capsMissingApify,
    });
    expect(res.action_id).toBe('find_hiring_signal_accounts');
    expect(res.enabled).toBe(false);
    expect(res.blocked_reason).toBe('Setup needed: Apify');
  });

  it('GTM goal: recommends find_decision_makers when rows exist but lack contacts', () => {
    const res = getRecommendedNextStep({
      companyBrain: { founder: { first_help_goal: 'find_leads' } },
      workbenchRows: [
        { id: '1', contact_status: 'needs_contact', enrichment_status: 'not_started', draft_status: 'locked' }
      ],
      capabilities: capsFull,
    });
    expect(res.action_id).toBe('find_decision_makers');
    expect(res.enabled).toBe(true);
  });

  it('GTM goal: locks find_decision_makers when apify_people is missing', () => {
    const res = getRecommendedNextStep({
      companyBrain: { founder: { first_help_goal: 'find_leads' } },
      workbenchRows: [
        { id: '1', contact_status: 'needs_contact', enrichment_status: 'not_started', draft_status: 'locked' }
      ],
      capabilities: capsMissingApify,
    });
    expect(res.action_id).toBe('find_decision_makers');
    expect(res.enabled).toBe(false);
    expect(res.blocked_reason).toBe('Setup needed: Apify');
  });

  it('GTM goal: recommends enrich_companies when contacts exist but lack enrichment', () => {
    const res = getRecommendedNextStep({
      companyBrain: { founder: { first_help_goal: 'find_leads' } },
      workbenchRows: [
        { id: '1', contact_name: 'John Doe', contact_status: 'verified', enrichment_status: 'not_started', draft_status: 'ready' }
      ],
      capabilities: capsFull,
    });
    expect(res.action_id).toBe('enrich_companies');
    expect(res.enabled).toBe(true);
  });

  it('GTM goal: locks enrich_companies when firecrawl is missing', () => {
    const res = getRecommendedNextStep({
      companyBrain: { founder: { first_help_goal: 'find_leads' } },
      workbenchRows: [
        { id: '1', contact_name: 'John Doe', contact_status: 'verified', enrichment_status: 'not_started', draft_status: 'ready' }
      ],
      capabilities: capsMissingFirecrawl,
    });
    expect(res.action_id).toBe('enrich_companies');
    expect(res.enabled).toBe(false);
    expect(res.blocked_reason).toBe('Setup needed: Firecrawl');
  });

  it('GTM goal: recommends draft_outreach when contacts and enrichment exist but lack drafts', () => {
    const res = getRecommendedNextStep({
      companyBrain: { founder: { first_help_goal: 'find_leads' } },
      workbenchRows: [
        { id: '1', contact_name: 'John Doe', contact_status: 'verified', enrichment_status: 'enriched', draft_status: 'ready' }
      ],
      capabilities: capsFull,
    });
    expect(res.action_id).toBe('draft_outreach');
    expect(res.enabled).toBe(true);
  });

  it('GTM goal: recommends export_csv when everything is complete', () => {
    const res = getRecommendedNextStep({
      companyBrain: { founder: { first_help_goal: 'find_leads' } },
      workbenchRows: [
        { id: '1', contact_name: 'John Doe', contact_status: 'verified', enrichment_status: 'enriched', draft_status: 'drafted' }
      ],
      capabilities: capsFull,
    });
    expect(res.action_id).toBe('export_csv');
    expect(res.enabled).toBe(true);
  });

  it('Content goal: returns linkedin_post_from_signals', () => {
    const res = getRecommendedNextStep({
      companyBrain: { founder: { first_help_goal: 'create_content' } },
      capabilities: capsFull,
    });
    expect(res.action_id).toBe('linkedin_post_from_signals');
  });

  it('Research goal: returns website_audit', () => {
    const res = getRecommendedNextStep({
      companyBrain: { founder: { first_help_goal: 'audit_website' } },
      capabilities: capsFull,
    });
    expect(res.action_id).toBe('website_audit');
    expect(res.enabled).toBe(true);
  });
});
