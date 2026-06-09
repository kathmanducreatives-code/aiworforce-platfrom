// Presentation-only mapping from tool calls to a human-readable workflow type badge.
import type { DBToolCall } from '@/lib/orchestration';

export type WorkflowType =
  | 'people_search'
  | 'jobs_search'
  | 'company_search'
  | 'scrape'
  | 'rank'
  | 'draft'
  | 'report'
  | 'generic';

export const WORKFLOW_LABELS: Record<WorkflowType, string> = {
  people_search: 'People Search',
  jobs_search: 'Jobs Search',
  company_search: 'Company Search',
  scrape: 'Web Research',
  rank: 'Ranking',
  draft: 'Drafting',
  report: 'Report',
  generic: 'Tool Run',
};

export function workflowTypeFromToolCall(tc: DBToolCall | null): WorkflowType {
  if (!tc) return 'generic';
  const tool = (tc.tool_name ?? '').toLowerCase();
  const provider = (tc.provider ?? '').toLowerCase();
  const outputType = (tc.output_json?.actor_output_type ?? '').toLowerCase();
  const actorKey = (tc.output_json?.selected_actor_key ?? tc.output_json?.actor_key ?? '').toLowerCase();

  if (outputType.includes('people') || actorKey.includes('people') || tool.includes('people')) return 'people_search';
  if (outputType.includes('job') || actorKey.includes('job') || tool.includes('job')) return 'jobs_search';
  if (outputType.includes('company') || actorKey.includes('company')) return 'company_search';
  if (provider === 'firecrawl' || tool.includes('scrape') || tool.includes('crawl')) return 'scrape';
  if (tool.includes('rank')) return 'rank';
  if (tool.includes('draft') || tool.includes('email') || tool.includes('outreach')) return 'draft';
  if (tool.includes('report')) return 'report';
  return 'generic';
}
