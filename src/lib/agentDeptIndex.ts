import { AGENT_BY_NAME, AGENT_PROFILES, type AgentDept, type AgentProfile } from '@/data/agentProfiles';
import type { DBAgent } from './orchestration';

/** Resolve an AgentProfile from a DB agent (by slug → name match, then dept fallback). */
export function profileForAgent(agent: DBAgent | undefined | null): AgentProfile | undefined {
  if (!agent) return undefined;
  const bySlug = AGENT_PROFILES.find((p) => p.id === agent.slug);
  if (bySlug) return bySlug;
  return AGENT_BY_NAME[agent.name?.toLowerCase()] ?? AGENT_PROFILES.find((p) => p.department === agent.department);
}

export function profileById(agents: DBAgent[], agentId: string | null | undefined): AgentProfile | undefined {
  if (!agentId) return undefined;
  return profileForAgent(agents.find((a) => a.id === agentId));
}

export const DEPTS: { id: AgentDept; label: string; description: string }[] = [
  { id: 'talent', label: 'talent', description: 'Sourcing, screening, hiring' },
  { id: 'growth', label: 'growth', description: 'Outreach, leads, revenue' },
  { id: 'intelligence', label: 'intelligence', description: 'Market & competitor signals' },
  { id: 'content', label: 'content', description: 'Posts, articles, narratives' },
];

export function agentsForDept(agents: DBAgent[], dept: AgentDept): DBAgent[] {
  return agents.filter((a) => a.department === dept);
}
