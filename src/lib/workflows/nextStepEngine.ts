import type { ToolAvailabilityMap } from './tools';

export interface NextStepParams {
  companyBrain: any;
  workflowRun?: any;
  workbenchRows?: any[];
  capabilities: ToolAvailabilityMap;
  onboardingGoal?: string;
}

export interface NextStepResult {
  action_id: string;
  label: string;
  reason: string;
  agent_team: string[];
  enabled: boolean;
  blocked_reason?: string;
}

export function getRecommendedNextStep({
  companyBrain,
  workflowRun,
  workbenchRows = [],
  capabilities,
  onboardingGoal
}: NextStepParams): NextStepResult {
  const goal = onboardingGoal || companyBrain?.founder?.first_help_goal || 'not_sure';
  const hasRows = workbenchRows && workbenchRows.length > 0;

  // ──────────────── GTM / Leads Loop ────────────────
  if (['find_leads', 'draft_outreach', 'organize_founder_ops', 'not_sure'].includes(goal)) {
    if (!hasRows) {
      const isApifyJobsReady = capabilities.apify_jobs?.configured && capabilities.apify_jobs?.enabled;
      return {
        action_id: 'find_hiring_signal_accounts',
        label: 'Find hiring-signal accounts',
        reason: 'Start your first workflow to source company accounts matching your ICP.',
        agent_team: ['scout', 'aria'],
        enabled: !!isApifyJobsReady,
        blocked_reason: isApifyJobsReady ? undefined : 'Setup needed: Apify'
      };
    }

    const runWasSourcing = workflowRun?.payload?.instruction?.toLowerCase().includes('find') || false;
    if (runWasSourcing && workbenchRows.length === 0) {
      return {
        action_id: 'broaden_search',
        label: 'Broaden search',
        reason: 'Your last search returned 0 results. Try widening your industry or geography.',
        agent_team: ['scout'],
        enabled: true
      };
    }

    // Check if contacts are missing for all rows
    const missingContacts = workbenchRows.filter(r => !r.contact_name || r.contact_status === 'needs_contact');
    if (missingContacts.length > 0) {
      const isApifyPeopleReady = capabilities.apify_people?.configured && capabilities.apify_people?.enabled;
      return {
        action_id: 'find_decision_makers',
        label: 'Find decision-makers',
        reason: 'Scout will search LinkedIn for Founder, CEO, Head of Growth, or VP Sales contacts at these accounts.',
        agent_team: ['scout'],
        enabled: !!isApifyPeopleReady,
        blocked_reason: isApifyPeopleReady ? undefined : 'Setup needed: Apify'
      };
    }

    // Check if enrichment is missing
    const missingEnrichment = workbenchRows.filter(r => r.enrichment_status !== 'enriched');
    if (missingEnrichment.length > 0) {
      const isFirecrawlReady = capabilities.firecrawl?.configured && capabilities.firecrawl?.enabled;
      return {
        action_id: 'enrich_companies',
        label: 'Enrich companies',
        reason: 'Hawk will research the target company websites and prepare personalization angles.',
        agent_team: ['hawk'],
        enabled: !!isFirecrawlReady,
        blocked_reason: isFirecrawlReady ? undefined : 'Setup needed: Firecrawl'
      };
    }

    // Check if outreach drafts are missing
    const missingDrafts = workbenchRows.filter(r => r.draft_status !== 'drafted' && r.draft_status !== 'approved');
    if (missingDrafts.length > 0) {
      return {
        action_id: 'draft_outreach',
        label: 'Draft outreach',
        reason: 'Penn will draft personalized outreach emails/openers. Nothing will be sent without your approval.',
        agent_team: ['penn'],
        enabled: true
      };
    }

    // Default to CSV export when loop is complete
    return {
      action_id: 'export_csv',
      label: 'Export CSV',
      reason: 'All steps are complete. Export your personalized outreach drafts or review them in Awaiting You.',
      agent_team: ['pilot'],
      enabled: true
    };
  }

  // ──────────────── Content Goal ────────────────
  if (goal === 'create_content') {
    return {
      action_id: 'linkedin_post_from_signals',
      label: 'Create LinkedIn post',
      reason: 'Scribe will create LinkedIn content from your Company Brain context.',
      agent_team: ['scribe'],
      enabled: true
    };
  }

  // ──────────────── Research Goal ────────────────
  if (['research_companies', 'audit_website'].includes(goal)) {
    const isFirecrawlReady = capabilities.firecrawl?.configured && capabilities.firecrawl?.enabled;
    return {
      action_id: 'website_audit',
      label: 'Audit website',
      reason: 'Hawk will research the website and Aria will prioritize recommendations.',
      agent_team: ['hawk', 'aria', 'scribe'],
      enabled: !!isFirecrawlReady,
      blocked_reason: isFirecrawlReady ? undefined : 'Setup needed: Firecrawl'
    };
  }

  // ──────────────── Competitor Goal ────────────────
  if (goal === 'track_competitors') {
    return {
      action_id: 'competitor_snapshot',
      label: 'Snapshot competitor',
      reason: 'Hawk will find competitor signals and Aria will summarize changes.',
      agent_team: ['hawk', 'aria'],
      enabled: true
    };
  }

  // Fallback
  return {
    action_id: 'find_hiring_signal_accounts',
    label: 'Find hiring-signal accounts',
    reason: 'Start your first workflow to source company accounts matching your ICP.',
    agent_team: ['scout', 'aria'],
    enabled: true
  };
}
