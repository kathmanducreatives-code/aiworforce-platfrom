// Internal / admin-facing per-workflow USD budget caps. Used to detect runaway
// provider spend and surface in admin tooling. NEVER render these to end users.

export const WORKFLOW_BUDGET_CAPS_USD = {
  signal_radar_scan_top_10: 0.18,
  hiring_signal_leads_5: 0.45,
  hiring_signal_leads_10: 0.75,
  decision_makers_5_accounts: 0.40,
  enrich_company: 0.07,
  website_audit: 0.30,
  company_research_brief: 0.15,
  outreach_draft_10: 0.15,
} as const;

export type BudgetCapKey = keyof typeof WORKFLOW_BUDGET_CAPS_USD;
