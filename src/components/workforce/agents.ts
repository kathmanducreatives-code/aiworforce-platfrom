/**
 * Workforce module registry — legacy IDs preserved for the workforce dock
 * typing (Record<AgentId, AgentState> is used across useWorkforceState and
 * the dock components). Display names / roles / blurbs are the PUBLIC
 * identities from `@/config/agentRegistry`.
 *
 * Public mapping applied here:
 *   pilot  → Pilot
 *   scout  → Lyra
 *   aria   → Atlas (qualification)
 *   hawk   → Atlas (research) — kept as a lookup entry but excluded from
 *                                AGENT_ORDER so the dock doesn't render two
 *                                Atlas cards.
 *   penn   → Mira
 *   scribe → Orion
 */

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
    role: 'AI Workforce Coordinator',
    accent: 'emerald',
    initial: 'P',
    blurb: "Coordinates Agentory's specialists and presents their work for founder review.",
  },
  scout: {
    id: 'scout',
    name: 'Lyra',
    role: 'AI Signal Scout',
    accent: 'blue',
    initial: 'N',
    blurb: 'Finds companies showing meaningful signs they may be ready to buy.',
  },
  aria: {
    id: 'aria',
    name: 'Atlas',
    role: 'AI Account Analyst',
    accent: 'amber',
    initial: 'A',
    blurb: 'Researches accounts, qualifies them, and ranks the strongest opportunities.',
  },
  penn: {
    id: 'penn',
    name: 'Mira',
    role: 'AI Message Strategist',
    accent: 'emerald',
    initial: 'M',
    blurb: 'Turns research into clear, relevant outreach prepared for founder approval.',
  },
  hawk: {
    // Publicly represented by Atlas — kept as an internal alias so historical
    // lookups (agent_slug='hawk') still resolve to the Atlas presentation.
    id: 'hawk',
    name: 'Atlas',
    role: 'AI Account Analyst',
    accent: 'amber',
    initial: 'A',
    blurb: 'Researches accounts, qualifies them, and ranks the strongest opportunities.',
  },
  scribe: {
    id: 'scribe',
    name: 'Orion',
    role: 'AI Pipeline Operator',
    accent: 'purple',
    initial: 'O',
    blurb: 'Organizes what should be reviewed, approved, contacted, watched, or skipped next.',
  },
};

// Hawk is intentionally excluded — Atlas already appears via 'aria'.
export const AGENT_ORDER: AgentId[] = ['pilot', 'scout', 'aria', 'penn', 'scribe'];

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
