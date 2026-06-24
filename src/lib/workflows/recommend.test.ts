import { describe, it, expect } from 'vitest';
import { recommendWorkflows, recommendFirstMove } from './recommend';

describe('recommendWorkflows', () => {
  it('returns empty when brain has no signals', () => {
    expect(recommendWorkflows({})).toEqual([]);
    expect(recommendWorkflows(null)).toEqual([]);
  });

  it('prioritizes workflows explicitly selected during onboarding', () => {
    const brain = {
      workflow_preferences: { priority_workflows: ['find_hiring_signal_accounts'] },
    };
    const ranked = recommendWorkflows(brain, undefined, 3);
    expect(ranked[0]?.workflow.id).toBe('find_hiring_signal_accounts');
    expect(ranked[0]?.reasons.some((r) => r.includes('onboarding'))).toBe(true);
  });

  it('boosts cold-call openers when primary channel is cold call', () => {
    const brain = {
      founder: { first_help_goal: 'draft_outreach' },
      gtm: { primary_channel: 'cold call', motion: 'outbound', preferred_channels: [] },
    };
    const ranked = recommendWorkflows(brain, undefined, 5).map((r) => r.workflow.id);
    expect(ranked).toContain('cold_call_openers');
  });

  it('matches content goal to LinkedIn content workflow', () => {
    const ranked = recommendWorkflows({ founder: { first_help_goal: 'create_content' } }).map((r) => r.workflow.id);
    expect(ranked).toContain('linkedin_post_from_signals');
  });

  it('uses workflow_preferences.priority_workflows as top signal', () => {
    const brain = {
      founder: { first_help_goal: 'create_content' },
      workflow_preferences: { priority_workflows: ['draft_outreach'] },
    };
    const ranked = recommendWorkflows(brain, undefined, 4);
    expect(ranked[0]?.workflow.id).toBe('draft_outreach');
  });

  it('limit param caps results', () => {
    const brain = {
      founder: { first_help_goal: 'find_leads' },
      gtm: { primary_channel: 'email', motion: 'outbound' },
    };
    expect(recommendWorkflows(brain, undefined, 2).length).toBeLessThanOrEqual(2);
  });
});
