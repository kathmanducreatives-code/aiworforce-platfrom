// Single source of truth for workflow credit costs.
// Mirror this catalog in supabase/functions/_shared/pricing.ts for edge runtime.
//
// Credits are INTERNAL Agentory credits and represent real AI workforce work
// (provider scrapes, Firecrawl crawls, Claude drafts, ranking, research).

export const WORKFLOW_CREDIT_COSTS = {
  // Briefings / lightweight ops
  daily_briefing: 1,
  weekly_workforce_briefing: 1,
  review_approvals: 1,
  summarize_pending_work: 1,
  daily_workforce_briefing: 1,
  weekly_report: 2,

  // Signal Feed radar
  signal_radar_scan_top_10: 6,
  signal_radar_load_more_10: 6,

  // Lead discovery
  hiring_signal_leads_5: 15,
  hiring_signal_leads_10: 25,
  find_hiring_signal_accounts: 15,        // alias used by registry
  find_icp_accounts: 20,
  icp_company_search_5: 20,
  founder_profile_search_5: 20,
  linkedin_intent_post_scan: 25,
  competitor_conversation_scan: 20,

  // Decision-maker discovery
  decision_makers_5_accounts: 12,
  decision_makers_10_accounts: 22,
  find_decision_makers: 12,

  // Ranking
  rank_accounts: 2,

  // Enrichment / research
  enrich_company: 3,
  enrich_companies: 3,
  website_audit: 10,
  company_research_brief: 5,
  research_company: 5,
  competitor_snapshot: 5,
  market_signal_brief: 5,
  competitor_website_analysis: 10,
  competitor_engagement: 6,

  // Outreach drafting (all draft-only, approval-gated)
  outreach_draft_single: 1,
  outreach_draft_10: 8,
  draft_outreach: 8,
  cold_call_openers_10: 8,
  cold_call_openers: 8,
  followup_messages: 6,

  // Content
  linkedin_post_from_signal: 4,
  linkedin_post_from_signals: 4,
  content_ideas: 4,
  founder_weekly_update: 4,
  competitor_signal_post: 4,
  comparison_angle: 4,

  // Export
  export_csv_basic: 0,
  export_call_list: 0,
  export_csv_enriched: 1,
} as const;

export type WorkflowCostKey = keyof typeof WORKFLOW_CREDIT_COSTS;

/**
 * Returns the per-run credit cost for a workflow id (with safe fallback).
 * `params.count` scales lead/decision-maker workflows past their default tier.
 */
export function getWorkflowCost(
  workflowId: string,
  params: { count?: number; enrichableCount?: number } = {},
): number {
  // Lead discovery scales by count
  if (workflowId === 'find_hiring_signal_accounts' || workflowId === 'hiring_signal_leads_5') {
    const n = Math.max(1, params.count ?? 5);
    if (n <= 5) return WORKFLOW_CREDIT_COSTS.hiring_signal_leads_5;
    if (n <= 10) return WORKFLOW_CREDIT_COSTS.hiring_signal_leads_10;
    return Math.ceil((WORKFLOW_CREDIT_COSTS.hiring_signal_leads_10 / 10) * n);
  }
  if (workflowId === 'find_decision_makers') {
    const n = Math.max(1, params.count ?? 5);
    if (n <= 5) return WORKFLOW_CREDIT_COSTS.decision_makers_5_accounts;
    if (n <= 10) return WORKFLOW_CREDIT_COSTS.decision_makers_10_accounts;
    return Math.ceil((WORKFLOW_CREDIT_COSTS.decision_makers_10_accounts / 10) * n);
  }
  if (workflowId === 'enrich_companies' || workflowId === 'enrich_company') {
    const n = Math.max(1, params.enrichableCount ?? params.count ?? 1);
    return n * WORKFLOW_CREDIT_COSTS.enrich_company;
  }
  if (workflowId === 'draft_outreach') {
    const n = Math.max(1, params.count ?? 5);
    return Math.ceil((WORKFLOW_CREDIT_COSTS.outreach_draft_10 / 10) * n);
  }
  const direct = (WORKFLOW_CREDIT_COSTS as Record<string, number>)[workflowId];
  if (typeof direct === 'number') return direct;
  return 2; // safe default for unknown workflows
}

/**
 * Compute actual credits to charge given the original estimate and the
 * accepted result count. Implements the fair-charge policy from the spec.
 */
export function computeActualCharge(opts: {
  estimated: number;
  requested: number;
  accepted: number;
  providerRan: boolean;
  failedBeforeProvider?: boolean;
}): { actual: number; status: 'charged' | 'partial' | 'minimum_charge' | 'not_charged' } {
  const { estimated, requested, accepted, providerRan, failedBeforeProvider } = opts;
  if (failedBeforeProvider || !providerRan) {
    return { actual: 0, status: 'not_charged' };
  }
  if (requested <= 0 || estimated <= 0) {
    return { actual: 0, status: 'not_charged' };
  }
  if (accepted >= requested) {
    return { actual: estimated, status: 'charged' };
  }
  if (accepted <= 0) {
    // Provider ran but produced no useful accepted output → 10–25% minimum.
    const min = Math.max(1, Math.round(estimated * 0.2));
    return { actual: min, status: 'minimum_charge' };
  }
  // Proportional, with a minimum floor.
  const proportional = Math.round((accepted / requested) * estimated);
  const min = Math.max(1, Math.round(estimated * 0.25));
  return { actual: Math.max(min, proportional), status: 'partial' };
}
