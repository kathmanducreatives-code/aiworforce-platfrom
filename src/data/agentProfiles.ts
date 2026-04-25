import ariaImg from '@/assets/agents/aria.png';
import scoutImg from '@/assets/agents/scout.png';
import pennImg from '@/assets/agents/penn.png';
import hawkImg from '@/assets/agents/hawk.png';
import scribeImg from '@/assets/agents/scribe.png';

export type AgentDept = 'talent' | 'growth' | 'content' | 'intelligence';
export type AgentModelKey = 'gpt-4o' | 'claude-sonnet' | 'claude-haiku' | 'gemini-pro';

export interface AgentProfile {
  id: string;
  name: string;
  role: string;
  department: AgentDept;
  image: string;
  model: AgentModelKey;
}

export const AGENT_PROFILES: AgentProfile[] = [
  { id: 'aria',   name: 'Aria',   role: 'AI Screener',           department: 'talent',       image: ariaImg,   model: 'claude-sonnet' },
  { id: 'scout',  name: 'Scout',  role: 'AI Sourcer',            department: 'talent',       image: scoutImg,  model: 'gpt-4o' },
  { id: 'penn',   name: 'Penn',   role: 'AI Outreach Writer',    department: 'growth',       image: pennImg,   model: 'claude-haiku' },
  { id: 'hawk',   name: 'Hawk',   role: 'AI Competitor Watcher', department: 'intelligence', image: hawkImg,   model: 'gemini-pro' },
  { id: 'scribe', name: 'Scribe', role: 'AI Content Writer',     department: 'content',      image: scribeImg, model: 'claude-sonnet' },
];

export const AGENT_BY_ID: Record<string, AgentProfile> =
  Object.fromEntries(AGENT_PROFILES.map((a) => [a.id, a]));

export const AGENT_BY_NAME: Record<string, AgentProfile> =
  Object.fromEntries(AGENT_PROFILES.map((a) => [a.name.toLowerCase(), a]));

export const deptRing: Record<AgentDept, string> = {
  talent:       'ring-emerald-500/70',
  growth:       'ring-blue-500/70',
  intelligence: 'ring-amber-500/70',
  content:      'ring-violet-500/70',
};

export const deptDot: Record<AgentDept, string> = {
  talent:       'bg-emerald-500',
  growth:       'bg-blue-500',
  intelligence: 'bg-amber-500',
  content:      'bg-violet-500',
};

export const deptText: Record<AgentDept, string> = {
  talent:       'text-emerald-400',
  growth:       'text-blue-400',
  intelligence: 'text-amber-400',
  content:      'text-violet-400',
};
