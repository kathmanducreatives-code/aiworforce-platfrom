// Recommendation helper — ranks workflow registry entries based on the
// Company Brain (founder.first_help_goal, gtm.motion/primary_channel,
// workflow_preferences.priority_workflows). Pure / deterministic.

import { WORKFLOWS, type WorkflowDefinition } from './registry';

type BrainLike = Record<string, any> | null | undefined;

function lower(s: unknown): string { return typeof s === 'string' ? s.toLowerCase() : ''; }
function arr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).map((s) => s.toLowerCase()).filter(Boolean);
  return [];
}

// Map goal/channel keywords to workflow ids that satisfy them.
const GOAL_TO_WORKFLOWS: Record<string, string[]> = {
  find_leads: ['find_hiring_signal_accounts', 'find_icp_accounts', 'find_decision_makers'],
  research_companies: ['research_company', 'enrich_companies', 'find_decision_makers'],
  draft_outreach: ['draft_outreach', 'cold_call_openers', 'followup_messages'],
  create_content: ['linkedin_post_from_signals', 'content_ideas', 'founder_weekly_update'],
  audit_website: ['website_audit'],
  track_competitors: ['competitor_snapshot', 'competitor_changes', 'market_signal_brief'],
  organize_founder_ops: ['daily_workforce_briefing', 'review_approvals', 'summarize_pending_work'],
};

const CHANNEL_BOOSTS: Record<string, string[]> = {
  'cold call': ['cold_call_openers', 'find_decision_makers'],
  linkedin: ['linkedin_post_from_signals', 'find_decision_makers'],
  email: ['draft_outreach', 'followup_messages', 'find_decision_makers'],
  content: ['linkedin_post_from_signals', 'content_ideas', 'website_audit'],
  partnerships: ['enrich_companies'],
  'paid content': ['linkedin_post_from_signals', 'content_ideas'],
};

export interface RankedWorkflow {
  workflow: WorkflowDefinition;
  score: number;
  reasons: string[];
}

export function recommendWorkflows(
  brain: BrainLike,
  registry: WorkflowDefinition[] = WORKFLOWS,
  limit = 3,
): RankedWorkflow[] {
  const founder = (brain?.founder ?? {}) as Record<string, unknown>;
  const gtm = (brain?.gtm ?? {}) as Record<string, unknown>;
  const wfp = (brain?.workflow_preferences ?? {}) as Record<string, unknown>;

  const priority = arr(wfp.priority_workflows);
  const goal = lower(founder.first_help_goal);
  const motion = lower(gtm.motion);
  const primary = lower(gtm.primary_channel);
  const channels = arr(gtm.preferred_channels);

  const ranked: RankedWorkflow[] = registry.map((wf) => {
    let score = 0;
    const reasons: string[] = [];

    if (priority.includes(wf.id.toLowerCase())) {
      score += 50;
      reasons.push('selected during onboarding');
    }
    if (goal && (GOAL_TO_WORKFLOWS[goal] ?? []).includes(wf.id)) {
      score += 30;
      reasons.push(`matches first goal: ${goal}`);
    }
    const allChannels = [primary, ...channels].filter(Boolean);
    for (const ch of allChannels) {
      const list = CHANNEL_BOOSTS[ch] ?? [];
      if (list.includes(wf.id)) {
        score += 15;
        reasons.push(`fits ${ch}`);
      }
    }
    if (motion === 'outbound' && ['find_decision_makers', 'draft_outreach', 'enrich_companies', 'cold_call_openers'].includes(wf.id)) {
      score += 10;
      reasons.push('outbound motion');
    }
    if (wf.recommended) score += 5;
    if (wf.status === 'ready') score += 2;

    return { workflow: wf, score, reasons };
  });

  return ranked
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
