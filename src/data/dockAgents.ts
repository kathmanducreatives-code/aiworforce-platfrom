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

export const DOCK_AGENTS: DockAgent[] = [
  {
    ...live('aria'),
    role: 'Your AI Screener',
    currentTask: 'Screening 12 applicants',
    progress: 64,
    status: 'active',
    href: '/candidates',
    recentActivity: [
      { time: '2m ago', text: 'Scored 8 candidates · 3 high fit' },
      { time: '14m ago', text: 'Pulled new applicants from Sr. Eng job' },
      { time: '1h ago', text: 'Sent 4 shortlists for approval' },
    ],
  },
  {
    ...live('scout'),
    role: 'Your AI Sourcer',
    currentTask: 'Sourcing SaaS founders in London',
    progress: 41,
    status: 'active',
    href: '/lead-scraper',
    recentActivity: [
      { time: '5m ago', text: 'Found 18 new leads in ICP' },
      { time: '32m ago', text: 'Verified 22 contact emails' },
      { time: 'Yesterday', text: 'Sourced 47 Senior Engineers' },
    ],
  },
  {
    ...live('penn'),
    role: 'Your AI Outreach Writer',
    currentTask: "Drafting outreach for today's leads",
    progress: 28,
    status: 'active',
    href: '/lead-crm',
    recentActivity: [
      { time: '7m ago', text: 'Drafted 3 personalized emails' },
      { time: '1h ago', text: 'Awaiting approval on Series A batch' },
    ],
  },
  {
    ...live('hawk'),
    role: 'Your AI Competitor Watcher',
    currentTask: 'Watching 12 competitors',
    progress: 81,
    status: 'active',
    href: '/competitor-intel',
    recentActivity: [
      { time: '11m ago', text: '2 new competitor signals flagged' },
      { time: '2h ago', text: 'Pricing page change detected · Acme' },
    ],
  },
  {
    ...live('scribe'),
    role: 'Your AI Content Writer',
    currentTask: 'Idle — ready for tasks',
    progress: 0,
    status: 'idle',
    href: '/dashboard',
    recentActivity: [
      { time: 'Yesterday', text: 'Drafted 2 LinkedIn posts' },
    ],
  },
];

export const deptColor: Record<DockDept, { ring: string; dot: string; text: string; bg: string; border: string }> = {
  talent:       { ring: 'ring-emerald-500/70', dot: 'bg-emerald-500', text: 'text-emerald-400', bg: 'from-emerald-500/30 to-emerald-700/30', border: 'border-emerald-500/40' },
  growth:       { ring: 'ring-blue-500/70',    dot: 'bg-blue-500',    text: 'text-blue-400',    bg: 'from-blue-500/30 to-blue-700/30',       border: 'border-blue-500/40' },
  content:      { ring: 'ring-violet-500/70',  dot: 'bg-violet-500',  text: 'text-violet-400',  bg: 'from-violet-500/30 to-violet-700/30',   border: 'border-violet-500/40' },
  intelligence: { ring: 'ring-amber-500/70',   dot: 'bg-amber-500',   text: 'text-amber-400',   bg: 'from-amber-500/30 to-amber-700/30',     border: 'border-amber-500/40' },
};

// Legacy text-only badge (kept for any consumer not yet migrated to <ModelBadge/>)
export const modelBadge: Record<DockModel, { label: string; className: string }> = {
  'gpt-4o':        { label: 'GPT-4o',        className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  'claude-sonnet': { label: 'Claude Sonnet', className: 'bg-orange-500/15 text-orange-300 border-orange-500/30' },
  'claude-haiku':  { label: 'Claude Haiku',  className: 'bg-orange-500/15 text-orange-300 border-orange-500/30' },
  'gemini-pro':    { label: 'Gemini Pro',    className: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
};
