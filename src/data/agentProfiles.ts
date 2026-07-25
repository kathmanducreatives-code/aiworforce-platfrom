/**
 * Legacy AgentProfile export — retained for backward compatibility with the
 * many components that already import from '@/data/agentProfiles'.
 *
 * The public identity data (Pilot / Lyra / Atlas / Mira / Orion) is derived
 * from the canonical registry at `@/config/agentRegistry`. Historical legacy
 * slugs (scout / aria / hawk / penn / scribe) are still resolvable via
 * AGENT_BY_ID / AGENT_BY_NAME so historical rows continue to render the
 * correct public identity.
 */

import {
  PUBLIC_AGENTS,
  PUBLIC_AGENT_ORDER,
  LEGACY_TO_PUBLIC,
  type PublicAgentProfile,
  type PublicAgentId,
  type LegacyAgentId,
  type AgentDept as RegistryAgentDept,
} from '@/config/agentRegistry';

export type AgentDept = RegistryAgentDept;
export type AgentModelKey = 'gpt-4o' | 'claude-sonnet' | 'claude-haiku' | 'gemini-pro';

/**
 * Backwards-compatible shape. `id` is the canonical public id (e.g. 'lyra').
 * The `image` field is nullable in the legacy type — we always provide one.
 */
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

const MODEL_BY_PUBLIC_ID: Record<PublicAgentId, AgentModelKey> = {
  pilot: 'claude-sonnet',
  lyra: 'gpt-4o',
  atlas: 'claude-sonnet',
  mira: 'claude-haiku',
  orion: 'claude-sonnet',
};

function toLegacyProfile(p: PublicAgentProfile): AgentProfile {
  return {
    id: p.id,
    name: p.name,
    role: p.title,
    department: p.department,
    image: p.avatar,
    model: MODEL_BY_PUBLIC_ID[p.id],
    accentHex: p.accentHex,
    description: p.shortDescription,
  };
}

/** Public specialist list (Pilot handled separately, mirroring prior shape). */
export const AGENT_PROFILES: AgentProfile[] = PUBLIC_AGENT_ORDER
  .filter((id) => id !== 'pilot')
  .map((id) => toLegacyProfile(PUBLIC_AGENTS[id]));

/** Pilot profile — kept separate so iterators over AGENT_PROFILES are unchanged. */
export const PILOT_PROFILE: AgentProfile = toLegacyProfile(PUBLIC_AGENTS.pilot);

/**
 * AGENT_BY_ID indexes BOTH canonical public ids AND legacy backend slugs so
 * historical rows (`agent_slug='scout'`, etc.) continue to render the public
 * identity (Lyra). Values are legacy-shape AgentProfile objects.
 */
export const AGENT_BY_ID: Record<string, AgentProfile> = (() => {
  const out: Record<string, AgentProfile> = {};
  for (const id of PUBLIC_AGENT_ORDER) {
    out[id] = toLegacyProfile(PUBLIC_AGENTS[id]);
  }
  for (const legacy of Object.keys(LEGACY_TO_PUBLIC) as LegacyAgentId[]) {
    const publicId = LEGACY_TO_PUBLIC[legacy];
    out[legacy] = toLegacyProfile(PUBLIC_AGENTS[publicId]);
  }
  return out;
})();

export const AGENT_BY_NAME: Record<string, AgentProfile> = (() => {
  const out: Record<string, AgentProfile> = {};
  for (const id of PUBLIC_AGENT_ORDER) {
    const p = PUBLIC_AGENTS[id];
    out[p.name.toLowerCase()] = toLegacyProfile(p);
  }
  // Also resolve historical names (scout / aria / hawk / penn / scribe) so
  // any component that stored the legacy display name still resolves.
  const legacyNames: Record<LegacyAgentId, string> = {
    pilot: 'pilot',
    scout: 'scout',
    aria: 'aria',
    hawk: 'hawk',
    penn: 'penn',
    scribe: 'scribe',
  };
  for (const legacy of Object.keys(LEGACY_TO_PUBLIC) as LegacyAgentId[]) {
    out[legacyNames[legacy]] = toLegacyProfile(PUBLIC_AGENTS[LEGACY_TO_PUBLIC[legacy]]);
  }
  return out;
})();

export const deptRing: Record<AgentDept, string> = {
  talent:       'ring-emerald-500/70',
  growth:       'ring-blue-500/70',
  intelligence: 'ring-amber-500/70',
  content:      'ring-violet-500/70',
  operations:   'ring-emerald-500/70',
};

export const deptDot: Record<AgentDept, string> = {
  talent:       'bg-emerald-500',
  growth:       'bg-blue-500',
  intelligence: 'bg-amber-500',
  content:      'bg-violet-500',
  operations:   'bg-emerald-500',
};

export const deptText: Record<AgentDept, string> = {
  talent:       'text-emerald-400',
  growth:       'text-blue-400',
  intelligence: 'text-amber-400',
  content:      'text-violet-400',
  operations:   'text-emerald-400',
};
