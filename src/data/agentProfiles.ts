import ariaImg from '@/assets/agents/aria.png';
import scoutImg from '@/assets/agents/scout.png';
import pennImg from '@/assets/agents/penn.png';
import hawkImg from '@/assets/agents/hawk.png';
import scribeImg from '@/assets/agents/scribe.png';
import pilotImg from '@/assets/agents/pilot.png';

export type AgentDept = 'talent' | 'growth' | 'content' | 'intelligence' | 'operations';
export type AgentModelKey = 'gpt-4o' | 'claude-sonnet' | 'claude-haiku' | 'gemini-pro';

export interface AgentProfile {
  id: string;
  name: string;
  role: string;
  department: AgentDept;
  image: string | null;
  model: AgentModelKey;
  accentHex?: string;
  description?: string;
}

export const AGENT_PROFILES: AgentProfile[] = [
  { id: 'aria',   name: 'Aria',   role: 'Ranking',  department: 'talent',       image: ariaImg,   model: 'claude-sonnet', accentHex: '#8B5CF6', description: 'Scores and prioritizes opportunities' },
  { id: 'scout',  name: 'Scout',  role: 'Sourcing', department: 'talent',       image: scoutImg,  model: 'gpt-4o',         accentHex: '#3B82F6', description: 'Finds leads, companies, and signals' },
  { id: 'penn',   name: 'Penn',   role: 'Outreach', department: 'growth',       image: pennImg,   model: 'claude-haiku',   accentHex: '#10B981', description: 'Writes approval-ready outreach drafts' },
  { id: 'hawk',   name: 'Hawk',   role: 'Research', department: 'intelligence', image: hawkImg,   model: 'gemini-pro',     accentHex: '#F59E0B', description: 'Researches companies, competitors, and websites' },
  { id: 'scribe', name: 'Scribe', role: 'Content',  department: 'content',      image: scribeImg, model: 'claude-sonnet',  accentHex: '#A855F7', description: 'Writes content, summaries, and reports' },
];

// Pilot has no PNG asset — kept separate so iterators over AGENT_PROFILES
// (rosters, docks, department pages) are unchanged. Lookups via AGENT_BY_ID /
// AGENT_BY_NAME do include Pilot, so chat/workbench surfaces resolve correctly.
export const PILOT_PROFILE: AgentProfile = {
  id: 'pilot',
  name: 'Pilot',
  role: 'Manager',
  department: 'operations',
  image: pilotImg,
  model: 'claude-sonnet',
  accentHex: '#10B981',
  description: 'Coordinates the AI workforce',
};

const LOOKUP_PROFILES: AgentProfile[] = [...AGENT_PROFILES, PILOT_PROFILE];

export const AGENT_BY_ID: Record<string, AgentProfile> =
  Object.fromEntries(LOOKUP_PROFILES.map((a) => [a.id, a]));

export const AGENT_BY_NAME: Record<string, AgentProfile> =
  Object.fromEntries(LOOKUP_PROFILES.map((a) => [a.name.toLowerCase(), a]));

export const deptRing: Record<AgentDept, string> = {
  talent:       'ring-emerald-500/70',
  growth:       'ring-blue-500/70',
  intelligence: 'ring-amber-500/70',
  content:      'ring-violet-500/70',
  operations:   'ring-slate-400/70',
};

export const deptDot: Record<AgentDept, string> = {
  talent:       'bg-emerald-500',
  growth:       'bg-blue-500',
  intelligence: 'bg-amber-500',
  content:      'bg-violet-500',
  operations:   'bg-slate-400',
};

export const deptText: Record<AgentDept, string> = {
  talent:       'text-emerald-400',
  growth:       'text-blue-400',
  intelligence: 'text-amber-400',
  content:      'text-violet-400',
  operations:   'text-slate-300',
};
