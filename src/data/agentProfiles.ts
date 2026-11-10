/**
 * Legacy AgentProfile export — retained for backward compatibility with the
 * many components that already import from '@/data/agentProfiles'.
 *
 * The public identity data (Orion / Atlas / Lisa / Lyra; hidden pilot/mira aliases) is derived
 * from the canonical registry at `@/config/agentRegistry`. Historical legacy
 * slugs (scout / aria / hawk / penn / scribe) are still resolvable via
 * AGENT_BY_ID / AGENT_BY_NAME so historical rows continue to render the
 * correct public identity.
 */

import {
  PUBLIC_AGENTS,
  PUBLIC_AGENT_ORDER,
  LEGACY_TO_PUBLIC,
  PUBLIC_ALIASES,
  type PublicAgentProfile,
  type PublicAgentId,
  type LegacyAgentId,
  type AgentDept as RegistryAgentDept,
} from '@/config/agentRegistry';

export type AgentDept = RegistryAgentDept;
export type AgentModelKey = 'gpt-4o' | 'claude-sonnet' | 'claude-haiku' | 'gemini-pro' | 'gpt-5.6-luna';

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

// THE MODEL EACH DEPARTMENT ACTUALLY WRITES WITH, for the badge — not a
// marketing choice. Mirrors the server routing (aiProvider TASK_MODELS and
// gptModelRouter): prose (ORION answers and briefs, LYRA drafts) is Claude
// Haiku 4.5; ATLAS's and LISA's decisions are GPT-5.6 Luna. Pinned by
// tests/frontend/workforceIdentity.test.ts against the server tables.
const MODEL_BY_PUBLIC_ID: Record<PublicAgentId, AgentModelKey> = {
  orion: 'claude-haiku',
  atlas: 'gpt-5.6-luna',
  lisa: 'gpt-5.6-luna',
  lyra: 'claude-haiku',
  pilot: 'claude-haiku',
  mira: 'claude-haiku',
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
export const PILOT_PROFILE: AgentProfile = toLegacyProfile(PUBLIC_AGENTS.orion);

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
  // Hidden compatibility ids (pilot → Orion, mira → Lyra) still resolve.
  for (const [hidden, target] of Object.entries(PUBLIC_ALIASES)) {
    out[hidden] = toLegacyProfile(PUBLIC_AGENTS[target as PublicAgentId]);
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
