import type { NavigateFunction } from 'react-router-dom';
import type { AgentId } from './agents';

export interface DeptAction {
  label: string;
  route: string;
  primary?: boolean;
}

export interface DeptStat {
  label: string;
  value: string | number;
  tone?: 'default' | 'good' | 'warn' | 'bad';
}

export interface DeptTotals {
  signals: number;
  outreachDrafts: number;
  contentDrafts: number;
  approvals: number;
  hotSignals: number;
  competitorSignals: number;
}

export interface DeptConfig {
  title: string;
  subtitle: string;
  /** Visual ring accent override for the dock circle (per user spec). */
  ringHex: string;
  /** Soft outer glow rgba */
  glowRgba: string;
  iconKey: 'command' | 'radar' | 'rank' | 'pen' | 'eye' | 'doc' | 'plus';
  route: string;
  badge: (t: DeptTotals, brainComplete: boolean, badgeCount: number) => string | number | null;
  stats: (t: DeptTotals, brainComplete: boolean) => DeptStat[];
  actions: (t: DeptTotals, brainComplete: boolean) => DeptAction[];
}

export const DEPT_CONFIG: Record<AgentId, DeptConfig> = {
  pilot: {
    title: 'Pilot Department',
    subtitle: 'Briefing, approvals and workforce command.',
    ringHex: '#10b981',
    glowRgba: 'rgba(16,185,129,0.35)',
    iconKey: 'command',
    route: '/awaiting-you',
    badge: (_t, _b, n) => n || null,
    stats: (t) => [
      { label: 'Approvals pending', value: t.approvals, tone: t.approvals ? 'warn' : 'default' },
      { label: 'Live signals today', value: t.signals },
      { label: 'Drafts in queue', value: t.outreachDrafts + t.contentDrafts },
      { label: 'Workforce health', value: 'Stable', tone: 'good' },
    ],
    actions: () => [
      { label: 'Open Briefing', route: '/awaiting-you', primary: true },
      { label: 'View Decision Queue', route: '/awaiting-you' },
    ],
  },
  scout: {
    title: 'Lyra Department',
    subtitle: 'Lead discovery and buying signal intelligence.',
    ringHex: '#2dd4bf',
    glowRgba: 'rgba(45,212,191,0.35)',
    iconKey: 'radar',
    route: '/signals',
    badge: (t) => t.signals || null,
    stats: (t) => [
      { label: 'New signals found', value: t.signals },
      { label: 'Marked hot', value: t.hotSignals, tone: t.hotSignals ? 'good' : 'default' },
      { label: 'In review', value: Math.max(0, t.signals - t.hotSignals) },
      { label: 'Ready for outreach', value: t.outreachDrafts },
    ],
    actions: () => [
      { label: 'Open Signal Feed', route: '/signals', primary: true },
      { label: 'Send to Atlas', route: '/leads' },
      { label: 'Ask Lyra to find more', route: '/lead-scraper' },
    ],
  },
  aria: {
    title: 'Atlas Department',
    subtitle: 'Lead ranking, scoring and ICP fit analysis.',
    ringHex: '#a855f7',
    glowRgba: 'rgba(168,85,247,0.35)',
    iconKey: 'rank',
    route: '/leads',
    badge: (t, brainComplete, n) => (!brainComplete ? '!' : n || null),
    stats: (t, brainComplete) => [
      { label: 'ICP status', value: brainComplete ? 'Confirmed' : 'Incomplete', tone: brainComplete ? 'good' : 'warn' },
      { label: 'Hot leads marked', value: t.hotSignals, tone: t.hotSignals ? 'good' : 'default' },
      { label: 'Waiting for scoring', value: t.signals },
      { label: 'Company Brain', value: brainComplete ? 'Ready' : 'Action needed', tone: brainComplete ? 'good' : 'bad' },
    ],
    actions: (_t, brainComplete) => (brainComplete
      ? [
          { label: 'Review Lead Scores', route: '/leads', primary: true },
          { label: 'Open Ranking Board', route: '/leads' },
        ]
      : [
          { label: 'Complete ICP', route: '/onboarding/company-brain', primary: true },
          { label: 'Open Ranking Board', route: '/leads' },
        ]),
  },
  penn: {
    title: 'Mira Department',
    subtitle: 'Outreach drafts, messages and follow-up sequences.',
    ringHex: '#22d3ee',
    glowRgba: 'rgba(34,211,238,0.35)',
    iconKey: 'pen',
    route: '/awaiting-you',
    badge: (t) => t.outreachDrafts || null,
    stats: (t) => [
      { label: 'Drafts ready', value: t.outreachDrafts, tone: t.outreachDrafts ? 'good' : 'default' },
      { label: 'Waiting for approval', value: t.approvals, tone: t.approvals ? 'warn' : 'default' },
      { label: 'Sequences active', value: 0 },
      { label: 'Auto-send', value: 'Off', tone: 'good' },
    ],
    actions: () => [
      { label: 'Review Drafts', route: '/awaiting-you', primary: true },
      { label: 'Open Messages', route: '/outreach-engine' },
      { label: 'Create Sequence', route: '/email-sequences' },
    ],
  },
  hawk: {
    title: 'Atlas Research',
    subtitle: 'Competitor intelligence and market signals.',
    ringHex: '#60a5fa',
    glowRgba: 'rgba(96,165,250,0.35)',
    iconKey: 'eye',
    route: '/competitors',
    badge: (t) => t.competitorSignals || null,
    stats: (t) => [
      { label: 'Competitor notes', value: t.competitorSignals },
      { label: 'Market moves', value: 0 },
      { label: 'Pricing changes', value: 0 },
      { label: 'Monitoring', value: 'Live', tone: 'good' },
    ],
    actions: () => [
      { label: 'Open Competitor Feed', route: '/competitors', primary: true },
      { label: 'View Research', route: '/competitor-intelligence' },
    ],
  },
  scribe: {
    title: 'Content Workspace',
    subtitle: 'Content drafts, briefs and pipeline reports.',
    ringHex: '#a855f7',
    glowRgba: 'rgba(168,85,247,0.35)',
    iconKey: 'doc',
    route: '/content',
    badge: (t) => t.contentDrafts || null,
    stats: (t) => [
      { label: 'Content drafts', value: t.contentDrafts },
      { label: 'Weekly summaries', value: 0 },
      { label: 'Research briefs', value: 0 },
      { label: 'Auto-post', value: 'Off', tone: 'good' },
    ],
    actions: () => [
      { label: 'Open Content', route: '/content', primary: true },
      { label: 'View Reports', route: '/content' },
    ],
  },
};

export function navigateAction(navigate: NavigateFunction, route: string) {
  navigate(route);
}
