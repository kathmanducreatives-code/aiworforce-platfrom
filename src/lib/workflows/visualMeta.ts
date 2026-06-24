// Per-workflow visual metadata for the premium Workflow Center.
// No backend changes — pure presentational map keyed by workflow id with
// fallbacks by outputType / category.

import type { AgentId, WorkflowDefinition, WorkflowOutput, WorkflowCategory } from './registry';

export type ThumbnailVariant =
  | 'radar'
  | 'target'
  | 'org'
  | 'stack'
  | 'lens'
  | 'browser'
  | 'message'
  | 'wave'
  | 'feed'
  | 'briefing'
  | 'versus'
  | 'gear';

export interface AgentAccent {
  /** Tailwind text color class for accents. */
  text: string;
  /** Tailwind border color class (with alpha). */
  border: string;
  /** Inline rgba glow color used in radial gradients. */
  glow: string;
  /** Hex stop for SVG accents. */
  hex: string;
}

export const AGENT_ACCENT: Record<AgentId, AgentAccent> = {
  pilot: { text: 'text-emerald-300', border: 'border-emerald-500/25', glow: 'rgba(16,185,129,0.28)', hex: '#10b981' },
  scout: { text: 'text-sky-300', border: 'border-sky-500/25', glow: 'rgba(56,189,248,0.28)', hex: '#38bdf8' },
  aria: { text: 'text-violet-300', border: 'border-violet-500/25', glow: 'rgba(167,139,250,0.28)', hex: '#a78bfa' },
  hawk: { text: 'text-amber-300', border: 'border-amber-500/25', glow: 'rgba(251,191,36,0.28)', hex: '#fbbf24' },
  penn: { text: 'text-teal-300', border: 'border-teal-500/25', glow: 'rgba(45,212,191,0.28)', hex: '#2dd4bf' },
  scribe: { text: 'text-rose-300', border: 'border-rose-500/25', glow: 'rgba(251,113,133,0.28)', hex: '#fb7185' },
};

const ID_TO_VARIANT: Record<string, ThumbnailVariant> = {
  find_hiring_signal_accounts: 'radar',
  find_icp_accounts: 'target',
  find_decision_makers: 'org',
  rank_accounts: 'target',
  export_call_list: 'org',
  enrich_companies: 'stack',
  research_company: 'lens',
  website_audit: 'browser',
  competitor_snapshot: 'versus',
  market_signal_brief: 'briefing',
  draft_outreach: 'message',
  cold_call_openers: 'wave',
  followup_messages: 'message',
  objection_handling: 'message',
  linkedin_post_from_signals: 'feed',
  content_ideas: 'feed',
  founder_weekly_update: 'briefing',
  competitor_signal_post: 'feed',
  competitor_engagement: 'versus',
  competitor_website_analysis: 'browser',
  competitor_changes: 'versus',
  comparison_angle: 'versus',
  daily_workforce_briefing: 'briefing',
  review_approvals: 'briefing',
  summarize_pending_work: 'briefing',
  weekly_report: 'briefing',
};

const OUTPUT_FALLBACK: Record<WorkflowOutput, ThumbnailVariant> = {
  lead_table: 'target',
  contact_table: 'org',
  enrichment_table: 'stack',
  draft_list: 'message',
  content_doc: 'feed',
  audit_report: 'browser',
  briefing: 'briefing',
};

const CATEGORY_FALLBACK: Record<WorkflowCategory, ThumbnailVariant> = {
  growth: 'radar',
  research: 'lens',
  outreach: 'message',
  content: 'feed',
  competitor: 'versus',
  operations: 'gear',
};

export function getThumbnailVariant(w: WorkflowDefinition): ThumbnailVariant {
  return ID_TO_VARIANT[w.id] || OUTPUT_FALLBACK[w.outputType] || CATEGORY_FALLBACK[w.category] || 'gear';
}

export const OUTPUT_LABEL: Record<WorkflowOutput, string> = {
  lead_table: 'Lead table',
  contact_table: 'Contact table',
  enrichment_table: 'Enrichment',
  draft_list: 'Drafts',
  content_doc: 'Content',
  audit_report: 'Audit report',
  briefing: 'Briefing',
};

export const CATEGORY_ICON: Record<WorkflowCategory, string> = {
  growth: 'Sparkles',
  research: 'Search',
  outreach: 'Send',
  content: 'FileText',
  competitor: 'Swords',
  operations: 'Settings2',
};
