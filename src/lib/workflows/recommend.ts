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
    // Tie-breakers only count when the brain already matched this workflow.
    if (score > 0) {
      if (wf.recommended) score += 5;
      if (wf.status === 'ready') score += 2;
    }

    return { workflow: wf, score, reasons };
  });

  return ranked
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ---------- First-move recommendation (used by the product tour & first-run helper) ----------

export interface FirstMove {
  headline: string;
  body: string;
  workflowId: string;
  workflowName: string;
  why: string;
  agentTeam: string[];
  outputDescription: string;
  safetyNote: string;
  estimatedCredits: string;
}

const DEFAULT_FIRST_MOVE: FirstMove = {
  headline: 'Run your first safe workflow',
  body: 'Pick a playbook from the Workflow Center. Agentory will run it draft-only — nothing is sent until you approve.',
  workflowId: 'find_icp_accounts',
  workflowName: 'Find ICP accounts',
  why: 'Matches your goal of finding company accounts matching your ICP.',
  agentTeam: ['scout', 'aria'],
  outputDescription: '5 high-fit accounts corresponding to your ideal customer profile.',
  safetyNote: 'Draft-only. No messages will be sent.',
  estimatedCredits: '5',
};

const GOAL_FIRST_MOVE: Record<string, FirstMove> = {
  find_leads: {
    headline: 'Find 5 hiring-signal accounts',
    body: 'Nova will source, Atlas will rank, and results will open in Workbench.',
    workflowId: 'find_hiring_signal_accounts',
    workflowName: 'Find hiring-signal accounts',
    why: 'Matches your first goal of finding company accounts based on hiring signals.',
    agentTeam: ['scout', 'aria'],
    outputDescription: '5 high-intent accounts currently hiring for target roles.',
    safetyNote: 'Draft-only. Results open in Workbench.',
    estimatedCredits: '5',
  },
  draft_outreach: {
    headline: 'Draft outreach to 5 prospects',
    body: 'Mira will write approval-ready drafts using your voice. Nothing is sent automatically.',
    workflowId: 'draft_outreach',
    workflowName: 'Draft outreach',
    why: 'Matches your goal of drafting personalized outreach sequences.',
    agentTeam: ['penn'],
    outputDescription: 'Drafted emails or openers in your voice stored in Awaiting You.',
    safetyNote: 'Nothing is sent automatically. All outreach is draft-only.',
    estimatedCredits: '5',
  },
  create_content: {
    headline: 'Create your first LinkedIn post from your positioning',
    body: 'Agentory will draft it in your voice. Nothing is posted automatically.',
    workflowId: 'linkedin_post_from_signals',
    workflowName: 'Create LinkedIn post',
    why: 'Matches your content goal of publishing brand-aligned posts.',
    agentTeam: ['scribe'],
    outputDescription: 'A structured, engaging LinkedIn post draft ready for review.',
    safetyNote: 'Nothing is posted. Drafts are saved in Workbench.',
    estimatedCredits: '5',
  },
  audit_website: {
    headline: 'Audit your website',
    body: 'Atlas will research, prioritize issues, and summarize.',
    workflowId: 'website_audit',
    workflowName: 'Audit website',
    why: 'Matches your goal of auditing websites for growth.',
    agentTeam: ['hawk', 'aria', 'scribe'],
    outputDescription: 'A prioritization of website issues and copy improvement suggestions.',
    safetyNote: 'Passive website analysis only. No changes are made to your website.',
    estimatedCredits: '5',
  },
  research_companies: {
    headline: 'Research your top target account',
    body: 'Atlas gathers public signals, highlights what matters, and writes a one-pager.',
    workflowId: 'research_company',
    workflowName: 'Research company',
    why: 'Matches your goal of deep-diving into target accounts.',
    agentTeam: ['hawk', 'aria', 'scribe'],
    outputDescription: 'A comprehensive research profile detailing signals and personalization hooks.',
    safetyNote: 'Passive research only.',
    estimatedCredits: '5',
  },
  track_competitors: {
    headline: 'Snapshot your top competitor',
    body: 'Atlas pulls a competitor snapshot and summarizes the changes worth watching.',
    workflowId: 'competitor_snapshot',
    workflowName: 'Competitor snapshot',
    why: 'Matches your goal of tracking competitors.',
    agentTeam: ['hawk', 'aria'],
    outputDescription: 'A snapshot of changes and actionable threats/opportunities.',
    safetyNote: 'Passive monitoring only.',
    estimatedCredits: '5',
  },
  organize_founder_ops: {
    headline: 'Get your daily workforce briefing',
    body: 'Pilot summarizes what changed, what needs approval, and what to do next.',
    workflowId: 'daily_workforce_briefing',
    workflowName: 'Daily workforce briefing',
    why: 'Matches your goal of organizing founder operations.',
    agentTeam: ['pilot'],
    outputDescription: 'A briefing email listing approvals, tasks, and recommendations.',
    safetyNote: 'No external messages sent.',
    estimatedCredits: '5',
  },
};

export function recommendFirstMove(brain: BrainLike): FirstMove {
  const wfp = (brain?.workflow_preferences ?? {}) as Record<string, unknown>;
  const priority = arr(wfp.priority_workflows);
  const founder = (brain?.founder ?? {}) as Record<string, unknown>;
  const goal = lower(founder.first_help_goal);

  // Helper to map workflow output type to description
  const mapOutput = (outputType: string) => {
    switch (outputType) {
      case 'lead_table': return '5 high-fit accounts in Workbench.';
      case 'contact_table': return 'Decision maker contacts in Workbench.';
      case 'draft_list': return 'Personalized outreach drafts in Awaiting You.';
      case 'content_doc': return 'Brand-aligned post drafts.';
      case 'audit_report': return 'Actionable audit report.';
      default: return 'Structured workspace output.';
    }
  };

  // 1) Honor an explicit onboarding selection if present.
  if (priority.length > 0) {
    const id = priority[0];
    const wf = WORKFLOWS.find((w) => w.id === id);
    if (wf) {
      return {
        headline: `Run ${wf.title}`,
        body: wf.description,
        workflowId: wf.id,
        workflowName: wf.title,
        why: `Matches your explicitly selected workflow: ${wf.title}.`,
        agentTeam: wf.agents,
        outputDescription: mapOutput(wf.outputType),
        safetyNote: wf.safety || 'Draft-only. Nothing is sent without your approval.',
        estimatedCredits: wf.estimatedCredits || '5',
      };
    }
  }

  // 2) Fall back to goal-keyed copy.
  if (goal && GOAL_FIRST_MOVE[goal]) return GOAL_FIRST_MOVE[goal];

  // 3) Fall back to the top-ranked recommendation, then a safe default.
  const top = recommendWorkflows(brain, WORKFLOWS, 1)[0];
  if (top) {
    return {
      headline: `Run ${top.workflow.title}`,
      body: top.workflow.description,
      workflowId: top.workflow.id,
      workflowName: top.workflow.title,
      why: top.reasons.join(', ') || `Matches your onboarding settings.`,
      agentTeam: top.workflow.agents,
      outputDescription: mapOutput(top.workflow.outputType),
      safetyNote: top.workflow.safety || 'Draft-only. Nothing is sent without your approval.',
      estimatedCredits: top.workflow.estimatedCredits || '5',
    };
  }
  return DEFAULT_FIRST_MOVE;
}
