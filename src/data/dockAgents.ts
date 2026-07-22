import { AGENT_BY_ID, type AgentDept, type AgentModelKey } from './agentProfiles';

export type DockDept = AgentDept;
export type DockModel = AgentModelKey;

export interface DockAgent {
  id: string;
  name: string;
  role: string;
  department: DockDept;
  model: DockModel;
  image: string;
  currentTask: string;
  progress: number;
  status: 'active' | 'idle';
  href: string;
  recentActivity: { time: string; text: string }[];
}

const live = (id: string) => {
  const a = AGENT_BY_ID[id];
  if (!a) throw new Error(`Unknown agent: ${id}`);
  return a;
};

/**
 * DOCK_AGENTS shows the public specialist lineup: Nova, Atlas, Mira, Orion.
 * Atlas is a single public card even though execution is currently split
 * across two internal engines (aria = qualification, hawk = research).
 */
export const DOCK_AGENTS: DockAgent[] = [
  {
    ...live('nova'),
    role: 'Your AI Signal Scout',
    currentTask: 'Scanning for buying signals',
    progress: 41,
    status: 'active',
    href: '/lead-scraper',
    recentActivity: [
      { time: '5m ago', text: 'Found 18 accounts matching ICP signals' },
      { time: '32m ago', text: 'Verified 22 contact emails' },
      { time: 'Yesterday', text: 'Surfaced 47 hiring / funding signals' },
    ],
  },
  {
    ...live('atlas'),
    role: 'Your AI Account Analyst',
    currentTask: 'Researching and qualifying accounts',
    progress: 64,
    status: 'active',
    href: '/leads',
    recentActivity: [
      { time: '2m ago', text: 'Ranked 8 accounts · 3 strong fit' },
      { time: '14m ago', text: 'Enriched 12 companies against Company Brain' },
      { time: '1h ago', text: 'Flagged 4 accounts as top opportunities' },
    ],
  },
  {
    ...live('mira'),
    role: 'Your AI Message Strategist',
    currentTask: "Drafting outreach for today's accounts",
    progress: 28,
    status: 'active',
    href: '/lead-crm',
    recentActivity: [
      { time: '7m ago', text: 'Drafted 3 personalized openers' },
      { time: '1h ago', text: 'Awaiting founder approval on Series A batch' },
    ],
  },
  {
    ...live('orion'),
    role: 'Your AI Pipeline Operator',
    currentTask: 'Organizing review queue',
    progress: 12,
    status: 'idle',
    href: '/awaiting-you',
    recentActivity: [
      { time: '10m ago', text: 'Summarized 6 items awaiting approval' },
      { time: 'Yesterday', text: 'Recommended next actions for 4 accounts' },
    ],
  },
];

export const deptColor: Record<DockDept, { ring: string; dot: string; text: string; bg: string; border: string }> = {
  talent:       { ring: 'ring-emerald-500/70', dot: 'bg-emerald-500', text: 'text-emerald-400', bg: 'from-emerald-500/30 to-emerald-700/30', border: 'border-emerald-500/40' },
  growth:       { ring: 'ring-blue-500/70',    dot: 'bg-blue-500',    text: 'text-blue-400',    bg: 'from-blue-500/30 to-blue-700/30',       border: 'border-blue-500/40' },
  content:      { ring: 'ring-violet-500/70',  dot: 'bg-violet-500',  text: 'text-violet-400',  bg: 'from-violet-500/30 to-violet-700/30',   border: 'border-violet-500/40' },
  intelligence: { ring: 'ring-amber-500/70',   dot: 'bg-amber-500',   text: 'text-amber-400',   bg: 'from-amber-500/30 to-amber-700/30',     border: 'border-amber-500/40' },
  operations:   { ring: 'ring-emerald-500/70', dot: 'bg-emerald-500', text: 'text-emerald-400', bg: 'from-emerald-500/30 to-emerald-700/30', border: 'border-emerald-500/40' },
};

// Legacy text-only badge (kept for any consumer not yet migrated to <ModelBadge/>)
export const modelBadge: Record<DockModel, { label: string; className: string }> = {
  'gpt-4o':        { label: 'GPT-4o',        className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  'claude-sonnet': { label: 'Claude Sonnet', className: 'bg-orange-500/15 text-orange-300 border-orange-500/30' },
  'claude-haiku':  { label: 'Claude Haiku',  className: 'bg-orange-500/15 text-orange-300 border-orange-500/30' },
  'gemini-pro':    { label: 'Gemini Pro',    className: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
};
