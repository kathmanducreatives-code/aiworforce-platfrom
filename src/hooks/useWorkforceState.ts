import { useMemo } from 'react';
import { useSignalFeed } from './useSignalFeed';
import { useApprovals } from './useApprovals';
import { useCompanyBrain } from './useCompanyBrain';
import type { AgentId, AgentStatusKind } from '@/components/workforce/agents';

export interface AgentState {
  id: AgentId;
  status: AgentStatusKind;
  statusText: string;
  todayOutput: string;
  context?: string;
  nextAction: { label: string; route?: string; prompt?: string };
  badgeCount: number;
  blockedReason?: string;
}

export interface TimelineItem {
  id: string;
  time: string;
  agentId: AgentId;
  text: string;
}

export interface DecisionItem {
  id: string;
  agentId: AgentId;
  title: string;
  reason: string;
  createdAt: string;
}

export function useWorkforceState(workspaceId: string | null) {
  const { signals, drafts, savedOutputs, loading } = useSignalFeed(workspaceId);
  const { approvals } = useApprovals(workspaceId);
  const { data: brain } = useCompanyBrain();

  return useMemo(() => {
    const brainComplete = Boolean(brain?.onboarding_completed);

    const hotSignals = signals.filter((s) => (s.signal_label ?? '').toLowerCase().includes('hot')).length;
    const competitorSignals = signals.filter((s) => (s.signal_type ?? '').toLowerCase().includes('competitor')).length;
    const contentDrafts = savedOutputs.filter((o) => (o.type ?? '').match(/content|post/i)).length;
    const outreachDrafts = drafts.length;
    const approvalsCount = approvals.length;

    const agents: Record<AgentId, AgentState> = {
      pilot: {
        id: 'pilot',
        status: approvalsCount > 0 ? 'awaiting' : 'working',
        statusText: approvalsCount > 0 ? 'Coordinating workflow' : 'Watching the workforce',
        todayOutput: `${approvalsCount} decision${approvalsCount === 1 ? '' : 's'} waiting`,
        context: 'Routes work between agents and queues approvals for you.',
        nextAction: { label: approvalsCount > 0 ? 'Review approvals' : 'Open briefing', route: '/awaiting-you' },
        badgeCount: approvalsCount,
      },
      scout: {
        id: 'scout',
        status: signals.length > 0 ? 'working' : 'idle',
        statusText: signals.length > 0 ? 'Scanning hiring + intent signals' : 'Standing by',
        todayOutput: `${signals.length} signal${signals.length === 1 ? '' : 's'} found`,
        context: `${hotSignals} marked hot · ${Math.max(0, signals.length - hotSignals)} in review`,
        nextAction: { label: 'Open signal feed', route: '/signals' },
        badgeCount: signals.length,
      },
      aria: brainComplete
        ? {
            id: 'aria',
            status: signals.length > 0 ? 'working' : 'idle',
            statusText: signals.length > 0 ? 'Scoring against your ICP' : 'Awaiting fresh signals',
            todayOutput: `${hotSignals} flagged strong fit`,
            context: 'Uses your Company Brain ICP to rank every signal.',
            nextAction: { label: 'View top fits', route: '/leads' },
            badgeCount: hotSignals,
          }
        : {
            id: 'aria',
            status: 'blocked',
            statusText: 'Blocked — Company Brain incomplete',
            todayOutput: 'Waiting on ICP confirmation',
            nextAction: { label: 'Complete Company Brain', route: '/onboarding/company-brain' },
            badgeCount: 0,
            blockedReason: 'Aria needs your ICP, offer, and target market before she can score leads.',
          },
      penn: {
        id: 'penn',
        status: outreachDrafts > 0 ? 'awaiting' : 'idle',
        statusText: outreachDrafts > 0 ? 'Waiting for approval' : 'Ready to draft',
        todayOutput: `${outreachDrafts} draft${outreachDrafts === 1 ? '' : 's'} ready`,
        context: 'Nothing is sent without your approval.',
        nextAction: { label: outreachDrafts > 0 ? 'Review drafts' : 'Ask Penn to draft', route: '/awaiting-you' },
        badgeCount: outreachDrafts,
      },
      hawk: {
        id: 'hawk',
        status: 'monitoring',
        statusText: 'Monitoring competitors',
        todayOutput: `${competitorSignals} competitor note${competitorSignals === 1 ? '' : 's'}`,
        context: 'Surfaces fresh competitor conversations and launches.',
        nextAction: { label: 'View research', route: '/competitors' },
        badgeCount: competitorSignals,
      },
      scribe: {
        id: 'scribe',
        status: contentDrafts > 0 ? 'drafting' : 'idle',
        statusText: contentDrafts > 0 ? 'Drafting briefs and posts' : 'Ready to draft',
        todayOutput: `${contentDrafts} content draft${contentDrafts === 1 ? '' : 's'}`,
        context: 'Turns activity into founder-led content and reports.',
        nextAction: { label: 'Open content', route: '/content' },
        badgeCount: contentDrafts,
      },
    };

    // Timeline — synthesize from recent signals/drafts/approvals (most recent first)
    const fmt = (iso?: string | null) => {
      if (!iso) return 'now';
      try {
        return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      } catch { return 'now'; }
    };

    const timeline: TimelineItem[] = [
      ...signals.slice(0, 3).map((s, i) => ({
        id: `sig-${(s as any).id ?? i}`,
        time: fmt((s as any).created_at),
        agentId: 'scout' as AgentId,
        text: `Scout found "${(s as any).title ?? 'a new signal'}"`,
      })),
      ...drafts.slice(0, 2).map((d, i) => ({
        id: `draft-${(d as any).id ?? i}`,
        time: fmt((d as any).created_at),
        agentId: 'penn' as AgentId,
        text: `Penn prepared a ${(d as any).channel ?? 'outreach'} draft`,
      })),
      ...approvals.slice(0, 2).map((a) => ({
        id: `apr-${a.id}`,
        time: fmt(a.created_at),
        agentId: 'pilot' as AgentId,
        text: `Pilot queued "${a.title}" for your approval`,
      })),
    ].slice(0, 6);

    const decisions: DecisionItem[] = approvals.slice(0, 6).map((a) => {
      // Best-effort agent attribution from title
      const t = a.title?.toLowerCase() ?? '';
      let agentId: AgentId = 'pilot';
      if (t.includes('outreach') || t.includes('email') || t.includes('message')) agentId = 'penn';
      else if (t.includes('signal') || t.includes('lead')) agentId = 'scout';
      else if (t.includes('post') || t.includes('content') || t.includes('linkedin')) agentId = 'scribe';
      else if (t.includes('competitor')) agentId = 'hawk';
      return {
        id: a.id,
        agentId,
        title: a.title,
        reason: a.description ?? 'Needs your approval to proceed.',
        createdAt: a.created_at,
      };
    });

    return {
      loading,
      brainComplete,
      agents,
      timeline,
      decisions,
      totals: { signals: signals.length, outreachDrafts, contentDrafts, approvals: approvalsCount, hotSignals, competitorSignals },
    };
  }, [signals, drafts, savedOutputs, approvals, brain, loading]);
}
