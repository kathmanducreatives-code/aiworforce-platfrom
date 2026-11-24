/**
 * Canonical public identity registry for Agentory's AI workforce.
 *
 * This is the single source of truth for how agents are presented in the UI.
 * Backend execution paths (Supabase functions, task_type, prompts,
 * orchestration routing, ariaScoring, competitorDiscovery, draftGate) are
 * intentionally untouched — the legacy internal identities (scout / aria /
 * hawk / penn / scribe) continue to power execution and are preserved below
 * for backend compatibility, but they must NEVER be rendered publicly.
 *
 * Public lineup (Workforce V2 — the four departments):
 *   Orion  — Executive Intelligence      (coordinator + briefs; legacy slug pilot)
 *   Atlas  — Sales & Lead Intelligence   (legacy slugs scout sourcing, aria qualification, hawk research)
 *   Lisa   — Signals & Market Intelligence (radar / monitoring / LISA V2)
 *   Lyra   — Content & Marketing         (legacy slugs scribe content, penn outreach drafts)
 *
 * `pilot` and `mira` remain as HIDDEN ids so historical rows and stored
 * references keep resolving; both alias to their department (pilot → Orion,
 * mira → Lyra). The same map is mirrored server-side in
 * supabase/functions/_shared/departments.ts and pinned to it by test.
 */

// Canonical public identity assets. Legacy files (scout.png, aria.png,
// hawk.png, penn.png, scribe.png) remain on disk for backend-history
// compatibility but are no longer imported by public UI as of Phase 1.6.
//
// Lyra was the one exception: her avatar was read from `lyra.png.asset.json`,
// whose `/__l5e/...` URL is a Lovable-hosted path that resolves to index.html
// in a normal build — every product surface rendered her as a broken image.
// She now imports a real local asset like Atlas, Mira and Orion do.
import pilotImg from '@/assets/agents/pilot.webp';
import atlasImg from '@/assets/agents/public/atlas-cinematic.webp';
import miraImg from '@/assets/agents/public/mira-cinematic.webp';
import orionImg from '@/assets/agents/public/orion-cinematic.webp';
import lyraImg from '@/assets/agents/public/lyra-cinematic.webp';
import unknownAgentImg from '@/assets/agents/public/unknown-agent.png';

export type PublicAgentId = 'pilot' | 'lyra' | 'atlas' | 'mira' | 'orion' | 'lisa';
export type LegacyAgentId = 'pilot' | 'scout' | 'aria' | 'hawk' | 'penn' | 'scribe';
export type AnyAgentId = PublicAgentId | LegacyAgentId;

export type AgentAccent = 'emerald' | 'blue' | 'amber' | 'purple' | 'slate';
export type AgentDept = 'operations' | 'growth' | 'intelligence' | 'content' | 'talent';
export type AgentStatus = 'active' | 'idle' | 'monitoring' | 'awaiting';

export interface AgentImageCrop {
  objectPosition?: string;
  scale?: number;
}

export interface PublicAgentProfile {
  /** Canonical public id — e.g. 'lyra'. */
  id: PublicAgentId;
  /** Public display name — e.g. 'Lyra'. */
  name: string;
  /** Public title — e.g. 'AI Signal Scout'. */
  title: string;
  /** Short description shown in avatars/tooltips. */
  shortDescription: string;
  /** Longer description shown in profile cards / drawers. */
  description: string;
  /** Primary avatar asset (square). */
  avatar: string;
  /** Optional portrait/card asset. Falls back to avatar. */
  portrait?: string;
  /** Tailwind accent hue token. */
  accent: AgentAccent;
  /** Hex accent used inline for glow/badge/style. */
  accentHex: string;
  /** Product department this agent belongs to publicly. */
  department: AgentDept;
  /** Capability keywords (public-facing). */
  capabilities: readonly string[];
  /**
   * Descriptive metadata about internal capabilities this public identity
   * currently unites. Phase 0/1: informational only — execution routing is
   * NOT changed here.
   */
  internalCapabilities?: Record<string, LegacyAgentId>;
  /** Legacy backend slugs that resolve to this public identity. */
  legacySlugs: readonly LegacyAgentId[];
  /** Whether this identity is shown in public agent selectors. */
  publiclyVisible: boolean;
  /** Optional single-letter fallback if avatar image fails to load. */
  fallbackInitial: string;
  /** Optional avatar crop. */
  imageCrop?: AgentImageCrop;
  /** Default status for card presentation. */
  status: AgentStatus;
  /**
   * True when the canonical portrait has not yet been supplied and a
   * neutral placeholder is shown. UI can badge these differently.
   */
  isPlaceholder?: boolean;
}

/**
 * Canonical public roster.
 */
export const PUBLIC_AGENTS: Record<PublicAgentId, PublicAgentProfile> = {
  orion: {
    id: 'orion',
    name: 'Orion',
    title: 'Executive Intelligence',
    shortDescription:
      'Your AI chief of staff: answers business questions, briefs you on what matters, and coordinates the team.',
    description:
      'Executive Intelligence and the primary interface. Combines signals, leads, content and approvals with your Company Brain into evidence-backed answers and briefs, delegates work to Atlas, Lisa and Lyra, and asks for your approval before anything consequential.',
    avatar: orionImg,
    portrait: orionImg,
    accent: 'purple',
    accentHex: '#A855F7',
    department: 'operations',
    capabilities: [
      'business Q&A',
      'executive briefings',
      'priority ranking',
      'delegation',
      'approval requests',
    ],
    legacySlugs: ['pilot'],
    publiclyVisible: true,
    fallbackInitial: 'O',
    status: 'active',
  },
  atlas: {
    id: 'atlas',
    name: 'Atlas',
    title: 'Sales & Lead Intelligence',
    shortDescription:
      'Finds and researches companies, qualifies them against your Company Brain, and explains every verdict.',
    description:
      'Discovers relevant companies, researches accounts and decision-makers, qualifies or disqualifies them against your ICP and exclusions, and explains why. Never contacts anyone.',
    avatar: atlasImg,
    portrait: atlasImg,
    accent: 'amber',
    accentHex: '#F59E0B',
    department: 'intelligence',
    capabilities: [
      'company discovery',
      'account research',
      'qualification',
      'evidence analysis',
      'opportunity ranking',
    ],
    internalCapabilities: {
      sourcing_engine: 'scout',
      qualification_engine: 'aria',
      research_engine: 'hawk',
    },
    legacySlugs: ['scout', 'aria', 'hawk'],
    publiclyVisible: true,
    fallbackInitial: 'A',
    status: 'active',
  },
  lisa: {
    id: 'lisa',
    name: 'Lisa',
    title: 'Signals & Market Intelligence',
    shortDescription: 'Watches competitors and markets, verifies what changed, and flags what matters to you.',
    description:
      'Monitors competitors and markets for expansion, hiring, funding and launch signals, verifies them against independent sources, and scores their relevance to your Company Brain. Never presents an unverified report as fact.',
    avatar: miraImg,
    portrait: miraImg,
    accent: 'blue',
    accentHex: '#3B82F6',
    department: 'intelligence',
    capabilities: ['signal discovery', 'source verification', 'competitor monitoring', 'relevance scoring'],
    legacySlugs: [],
    publiclyVisible: true,
    fallbackInitial: 'L',
    status: 'monitoring',
  },
  lyra: {
    id: 'lyra',
    name: 'Lyra',
    title: 'Content & Marketing',
    shortDescription: 'Writes posts and outreach drafts in your brand voice, citing approved evidence.',
    description:
      'Turns approved research and verified signals into LinkedIn content, campaign ideas and personalised outreach drafts in your brand voice. Nothing is published or sent without your approval.',
    avatar: lyraImg,
    portrait: lyraImg,
    accent: 'emerald',
    accentHex: '#22C55E',
    department: 'content',
    capabilities: ['LinkedIn content', 'outreach drafts', 'campaign ideas', 'brand voice', 'evidence citation'],
    internalCapabilities: {
      content_engine: 'scribe',
      outreach_engine: 'penn',
    },
    legacySlugs: ['scribe', 'penn'],
    publiclyVisible: true,
    fallbackInitial: 'L',
    imageCrop: { objectPosition: 'center 20%' },
    status: 'active',
  },
  // ── HIDDEN COMPATIBILITY IDS ───────────────────────────────────────────
  // Stored rows and links still carry these. They alias to their department
  // (see PUBLIC_ALIASES) and are never shown in selectors.
  pilot: {
    id: 'pilot',
    name: 'Orion',
    title: 'Executive Intelligence',
    shortDescription: "Coordinates Agentory's departments.",
    description: "Coordinates Agentory's departments and presents each result for review.",
    avatar: orionImg,
    accent: 'purple',
    accentHex: '#A855F7',
    department: 'operations',
    capabilities: ['delegation', 'workflow coordination'],
    legacySlugs: ['pilot'],
    publiclyVisible: false,
    fallbackInitial: 'O',
    status: 'active',
  },
  mira: {
    id: 'mira',
    name: 'Lyra',
    title: 'Content & Marketing',
    shortDescription: 'Outreach drafts, now part of Lyra.',
    description: 'Outreach drafting is part of Lyra. Every draft waits for your approval.',
    avatar: lyraImg,
    accent: 'emerald',
    accentHex: '#22C55E',
    department: 'content',
    capabilities: ['outreach drafts'],
    legacySlugs: ['penn'],
    publiclyVisible: false,
    fallbackInitial: 'L',
    status: 'active',
  },
};

/** Hidden ids that DISPLAY as their department. */
export const PUBLIC_ALIASES: Readonly<Partial<Record<PublicAgentId, PublicAgentId>>> = { pilot: 'orion', mira: 'lyra' };

export const PUBLIC_AGENT_ORDER: readonly PublicAgentId[] = [
  'orion',
  'atlas',
  'lisa',
  'lyra',
];

/**
 * Legacy → public alias map for DISPLAY resolution ONLY.
 * Do not use this to reroute execution.
 */
export const LEGACY_TO_PUBLIC: Readonly<Record<LegacyAgentId, PublicAgentId>> = {
  pilot: 'orion',
  scout: 'atlas',
  aria: 'atlas',
  hawk: 'atlas',
  penn: 'lyra',
  scribe: 'lyra',
};

/**
 * Legacy backend identities retained for backend compatibility and
 * historical attribution. These are hidden from public selectors.
 */
export interface LegacyAgentEntry {
  id: LegacyAgentId;
  publicId: PublicAgentId;
  internal: true;
  hiddenFromPublicSelectors: true;
}

export const LEGACY_AGENTS: Readonly<Record<LegacyAgentId, LegacyAgentEntry>> = Object.freeze(
  (Object.keys(LEGACY_TO_PUBLIC) as LegacyAgentId[]).reduce((acc, k) => {
    acc[k] = {
      id: k,
      publicId: LEGACY_TO_PUBLIC[k],
      internal: true,
      hiddenFromPublicSelectors: true,
    };
    return acc;
  }, {} as Record<LegacyAgentId, LegacyAgentEntry>),
);

const NAME_INDEX: Record<string, PublicAgentId> = {};
for (const id of PUBLIC_AGENT_ORDER) {
  NAME_INDEX[PUBLIC_AGENTS[id].name.toLowerCase()] = id;
}

/**
 * DISPLAY resolver. Maps any known slug (public or legacy), case-insensitive
 * name, or null/unknown value to a public profile.
 *
 * Behavior:
 *   - Known public id           → that profile
 *   - Known legacy backend slug → aliased public profile
 *   - Public name (any case)    → that profile
 *   - null / undefined / empty  → null (caller decides fallback)
 *   - Unknown string            → null  (caller decides fallback)
 *
 * IMPORTANT: unknown values do NOT silently resolve to Pilot. Callers that
 * need a display fallback should use `resolveAgentForDisplay` which returns
 * a neutral "Unknown" placeholder rather than falsely attributing work.
 */
export function lookupPublicAgent(input?: string | null): PublicAgentProfile | null {
  if (!input) return null;
  const key = String(input).trim().toLowerCase();
  if (!key) return null;
  if (key in PUBLIC_ALIASES) return PUBLIC_AGENTS[PUBLIC_ALIASES[key as PublicAgentId]!];
  if (key in PUBLIC_AGENTS) return PUBLIC_AGENTS[key as PublicAgentId];
  if (key in LEGACY_TO_PUBLIC) return PUBLIC_AGENTS[LEGACY_TO_PUBLIC[key as LegacyAgentId]];
  if (key in NAME_INDEX) return PUBLIC_AGENTS[NAME_INDEX[key]];
  return null;
}

/**
 * Neutral display placeholder for unknown / missing identities.
 * Never claims Pilot performed the work.
 */
export const UNKNOWN_AGENT_DISPLAY: PublicAgentProfile = {
  id: 'pilot', // shape-compatible; consumers should check `isUnknown` via name.
  name: 'Unknown agent',
  title: 'Unattributed',
  shortDescription: 'This activity has no attributed agent.',
  description: 'This activity was recorded without a resolvable agent identity.',
  avatar: unknownAgentImg,
  portrait: unknownAgentImg,
  accent: 'slate',
  accentHex: '#94A3B8',
  department: 'operations',
  capabilities: [],
  legacySlugs: [],
  publiclyVisible: false,
  fallbackInitial: '?',
  status: 'idle',
};

/**
 * DISPLAY resolver with neutral fallback for unknown identities.
 * Only use `pilotFallback: true` in surfaces where execution logic
 * legitimately requires Pilot as the default coordinator.
 */
export function resolveAgentForDisplay(
  input?: string | null,
  opts: { pilotFallback?: boolean } = {},
): PublicAgentProfile {
  const found = lookupPublicAgent(input);
  if (found) return found;
  if (opts.pilotFallback) return PUBLIC_AGENTS.orion;
  return UNKNOWN_AGENT_DISPLAY;
}

/** Convenience — list of publicly visible agents in canonical order. */
export const PUBLIC_AGENT_LIST: readonly PublicAgentProfile[] = PUBLIC_AGENT_ORDER
  .map((id) => PUBLIC_AGENTS[id])
  .filter((p) => p.publiclyVisible);

export const accentTailwind: Record<AgentAccent, { text: string; ring: string; dot: string; bg: string; border: string }> = {
  emerald: { text: 'text-emerald-400', ring: 'ring-emerald-500/60', dot: 'bg-emerald-500', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  blue:    { text: 'text-blue-400',    ring: 'ring-blue-500/60',    dot: 'bg-blue-500',    bg: 'bg-blue-500/10',    border: 'border-blue-500/30' },
  amber:   { text: 'text-amber-400',   ring: 'ring-amber-500/60',   dot: 'bg-amber-500',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30' },
  purple:  { text: 'text-purple-400',  ring: 'ring-purple-500/60',  dot: 'bg-purple-500',  bg: 'bg-purple-500/10',  border: 'border-purple-500/30' },
  slate:   { text: 'text-slate-300',   ring: 'ring-slate-400/60',   dot: 'bg-slate-400',   bg: 'bg-slate-400/10',   border: 'border-slate-400/30' },
};
