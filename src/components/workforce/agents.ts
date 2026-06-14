// Canonical AI workforce registry. Every workforce component reads from this.

export type AgentId = 'pilot' | 'scout' | 'aria' | 'penn' | 'hawk' | 'scribe';

export type AgentStatusKind =
  | 'idle'
  | 'working'
  | 'awaiting'
  | 'blocked'
  | 'monitoring'
  | 'drafting';

export interface AgentMeta {
  id: AgentId;
  name: string;
  role: string;
  /** Tailwind hue used for status ring + accents */
  accent: 'emerald' | 'teal' | 'amber' | 'cyan' | 'blue' | 'purple' | 'violet';
  /** 1–2 letter mark drawn in the avatar */
  initial: string;
  /** Short bio for hover cards / drawer */
  blurb: string;
}

export const AGENTS: Record<AgentId, AgentMeta> = {
  pilot: {
    id: 'pilot',
    name: 'Pilot',
    role: 'Manager Agent',
    accent: 'emerald',
    initial: 'P',
    blurb: 'Coordinates your AI workforce and routes decisions to you.',
  },
  scout: {
    id: 'scout',
    name: 'Scout',
    role: 'Signal Discovery Agent',
    accent: 'teal',
    initial: 'S',
    blurb: 'Finds buying signals across hiring, intent, and growth sources.',
  },
  aria: {
    id: 'aria',
    name: 'Aria',
    role: 'Lead Scoring Agent',
    accent: 'amber',
    initial: 'A',
    blurb: 'Scores and prioritizes leads against your ICP.',
  },
  penn: {
    id: 'penn',
    name: 'Penn',
    role: 'Outreach Writer',
    accent: 'cyan',
    initial: 'P',
    blurb: 'Drafts outreach in your voice. Never sends without approval.',
  },
  hawk: {
    id: 'hawk',
    name: 'Hawk',
    role: 'Research Agent',
    accent: 'blue',
    initial: 'H',
    blurb: 'Monitors competitors and market moves.',
  },
  scribe: {
    id: 'scribe',
    name: 'Scribe',
    role: 'Content Agent',
    accent: 'purple',
    initial: 'S',
    blurb: 'Turns activity and research into briefs, posts, and reports.',
  },
};

export const AGENT_ORDER: AgentId[] = ['pilot', 'scout', 'aria', 'penn', 'hawk', 'scribe'];

export const accentClasses = {
  emerald: { ring: 'ring-emerald-400/60', glow: 'shadow-[0_0_24px_rgba(16,185,129,0.35)]', text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', stroke: '#10b981' },
  teal:    { ring: 'ring-teal-400/60',    glow: 'shadow-[0_0_24px_rgba(45,212,191,0.30)]', text: 'text-teal-400',    bg: 'bg-teal-500/10',    border: 'border-teal-500/30',    stroke: '#2dd4bf' },
  amber:   { ring: 'ring-amber-400/60',   glow: 'shadow-[0_0_24px_rgba(251,191,36,0.30)]', text: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   stroke: '#fbbf24' },
  cyan:    { ring: 'ring-cyan-400/60',    glow: 'shadow-[0_0_24px_rgba(34,211,238,0.30)]', text: 'text-cyan-400',    bg: 'bg-cyan-500/10',    border: 'border-cyan-500/30',    stroke: '#22d3ee' },
  blue:    { ring: 'ring-blue-400/60',    glow: 'shadow-[0_0_24px_rgba(96,165,250,0.30)]', text: 'text-blue-400',    bg: 'bg-blue-500/10',    border: 'border-blue-500/30',    stroke: '#60a5fa' },
  purple:  { ring: 'ring-purple-400/60',  glow: 'shadow-[0_0_24px_rgba(168,85,247,0.30)]', text: 'text-purple-400',  bg: 'bg-purple-500/10',  border: 'border-purple-500/30',  stroke: '#a855f7' },
  violet:  { ring: 'ring-violet-400/60',  glow: 'shadow-[0_0_24px_rgba(139,92,246,0.30)]', text: 'text-violet-400',  bg: 'bg-violet-500/10',  border: 'border-violet-500/30',  stroke: '#8b5cf6' },
} as const;

export const statusLabel: Record<AgentStatusKind, string> = {
  idle: 'Idle',
  working: 'Working',
  awaiting: 'Awaiting approval',
  blocked: 'Blocked',
  monitoring: 'Monitoring',
  drafting: 'Drafting',
};

export const statusDot: Record<AgentStatusKind, string> = {
  idle: 'bg-neutral-500',
  working: 'bg-emerald-400',
  awaiting: 'bg-amber-400',
  blocked: 'bg-rose-400',
  monitoring: 'bg-blue-400',
  drafting: 'bg-purple-400',
};
