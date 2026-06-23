// Tool Availability Registry — client-side types + helpers.
// Runtime availability is reported by the `tool-availability` edge function
// (env-flag probe) and cached via useToolAvailability().

export type ToolKey =
  | 'gemini'
  | 'claude'
  | 'apify_jobs'
  | 'apify_people'
  | 'apify_posts'
  | 'apify_comments'
  | 'firecrawl'
  | 'resend_draft'
  | 'supabase'
  | 'csv_export';

export type ToolAvailability = {
  key: ToolKey;
  enabled: boolean;
  configured: boolean;
  reason_if_unavailable?: string;
  fallback_workflow?: string;
};

export type ToolAvailabilityMap = Record<ToolKey, ToolAvailability>;

export const TOOL_LABELS: Record<ToolKey, string> = {
  gemini: 'Lovable AI (Gemini)',
  claude: 'Claude (Anthropic)',
  apify_jobs: 'Apify – Jobs',
  apify_people: 'Apify – People',
  apify_posts: 'Apify – LinkedIn Posts',
  apify_comments: 'Apify – LinkedIn Comments',
  firecrawl: 'Firecrawl',
  resend_draft: 'Resend (drafts only)',
  supabase: 'Database',
  csv_export: 'CSV Export',
};

// Conservative defaults assumed when the edge function is unreachable.
// We bias to "configured" only for tools that are always part of the
// platform (Gemini via Lovable AI, Supabase, CSV).
export const DEFAULT_TOOL_AVAILABILITY: ToolAvailabilityMap = {
  gemini: { key: 'gemini', enabled: true, configured: true },
  claude: { key: 'claude', enabled: false, configured: false, reason_if_unavailable: 'No Anthropic key configured', fallback_workflow: 'draft_outreach' },
  apify_jobs: { key: 'apify_jobs', enabled: true, configured: true },
  apify_people: { key: 'apify_people', enabled: false, configured: false, reason_if_unavailable: 'People actor disabled by workspace flag', fallback_workflow: 'linkedin_intent_posts' },
  apify_posts: { key: 'apify_posts', enabled: true, configured: true },
  apify_comments: { key: 'apify_comments', enabled: false, configured: false, reason_if_unavailable: 'Comments actor not configured', fallback_workflow: 'linkedin_intent_posts' },
  // Conservative offline default: Firecrawl needs FIRECRAWL_API_KEY, so don't
  // claim "ready" when the tool-availability probe is unreachable — the live
  // edge function reports the true state.
  firecrawl: { key: 'firecrawl', enabled: false, configured: false, reason_if_unavailable: 'No Firecrawl key configured', fallback_workflow: 'market_research' },
  resend_draft: { key: 'resend_draft', enabled: true, configured: true },
  supabase: { key: 'supabase', enabled: true, configured: true },
  csv_export: { key: 'csv_export', enabled: true, configured: true },
};

export function fallbackFor(tool: ToolKey, map: ToolAvailabilityMap): string | undefined {
  return map[tool]?.fallback_workflow;
}
