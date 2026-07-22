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
 * Public lineup (Phase 0/1):
 *   Pilot  — AI Workforce Coordinator
 *   Nova   — AI Signal Scout          (execution: scout)
 *   Atlas  — AI Account Analyst       (execution: aria qualification + hawk research)
 *   Mira   — AI Message Strategist    (execution: penn, approval-first preserved)
 *   Orion  — AI Pipeline Operator     (execution: operational summaries)
 */

// Canonical public identity assets. Legacy files (scout.png, aria.png,
// hawk.png, penn.png, scribe.png) remain on disk for backend-history
// compatibility but are no longer imported by public UI as of Phase 1.6.
import pilotImg from '@/assets/agents/pilot.png';
import atlasImg from '@/assets/agents/public/atlas.png';
import miraImg from '@/assets/agents/public/mira.png';
import orionImg from '@/assets/agents/public/orion.png';
import novaPlaceholderImg from '@/assets/agents/public/nova-placeholder.png';
import unknownAgentImg from '@/assets/agents/public/unknown-agent.png';

export type PublicAgentId = 'pilot' | 'nova' | 'atlas' | 'mira' | 'orion';
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
  /** Canonical public id — e.g. 'nova'. */
  id: PublicAgentId;
  /** Public display name — e.g. 'Nova'. */
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
  pilot: {
    id: 'pilot',
    name: 'Pilot',
    title: 'AI Workforce Coordinator',
    shortDescription: "Coordinates Agentory's specialists and presents work for founder review.",
    description:
      "Coordinates Agentory's specialist agents, delegates work, and presents each result for founder review.",
    avatar: pilotImg,
    accent: 'emerald',
    accentHex: '#10B981',
    department: 'operations',
    capabilities: ['delegation', 'workflow coordination', 'workforce briefing', 'founder review'],
    legacySlugs: ['pilot'],
    publiclyVisible: true,
    fallbackInitial: 'P',
    status: 'active',
  },
  nova: {
    id: 'nova',
    name: 'Nova',
    title: 'AI Signal Scout',
    shortDescription: 'Finds companies showing meaningful signs they may be ready to buy.',
    description:
      'Continuously scans hiring, funding, growth, and product signals to surface accounts that may be ready to buy.',
    avatar: novaPlaceholderImg,
    portrait: novaPlaceholderImg,
    accent: 'blue',
    accentHex: '#3B82F6',
    department: 'growth',
    capabilities: [
      'signal discovery',
      'buying-moment detection',
      'opportunity discovery',
      'market monitoring',
    ],
    legacySlugs: ['scout'],
    publiclyVisible: true,
    fallbackInitial: 'N',
    status: 'active',
    isPlaceholder: true,
  },
  atlas: {
    id: 'atlas',
    name: 'Atlas',
    title: 'AI Account Analyst',
    shortDescription:
      'Researches every account, qualifies it against the Company Brain, and ranks the strongest opportunities.',
    description:
      'Researches accounts, cross-checks evidence against the Company Brain, and ranks the strongest opportunities so founders review what matters first.',
    avatar: atlasImg,
    portrait: atlasImg,
    accent: 'amber',
    accentHex: '#F59E0B',
    department: 'intelligence',
    capabilities: [
      'account research',
      'company enrichment',
      'qualification',
      'evidence analysis',
      'opportunity ranking',
    ],
    // Descriptive only — execution stays split across aria + hawk.
    internalCapabilities: {
      qualification_engine: 'aria',
      research_engine: 'hawk',
    },
    legacySlugs: ['aria', 'hawk'],
    publiclyVisible: true,
    fallbackInitial: 'A',
    status: 'active',
  },
  mira: {
    id: 'mira',
    name: 'Mira',
    title: 'AI Message Strategist',
    shortDescription:
      'Turns account research into clear, relevant outreach prepared for founder approval.',
    description:
      'Turns account research into clear, relevant outreach. Every draft is prepared for founder approval — Mira never sends without a human.',
    avatar: miraImg,
    portrait: miraImg,
    accent: 'emerald',
    accentHex: '#22C55E',
    department: 'growth',
    capabilities: [
      'outreach strategy',
      'message drafting',
      'personalization',
      'angle selection',
      'CTA development',
    ],
    legacySlugs: ['penn'],
    publiclyVisible: true,
    fallbackInitial: 'M',
    status: 'active',
  },
  orion: {
    id: 'orion',
    name: 'Orion',
    title: 'AI Pipeline Operator',
    shortDescription:
      'Organizes what should be reviewed, approved, contacted, watched, or skipped next.',
    description:
      'Organizes pipeline state, surfaces approval queues, and recommends the next action so founders always know what to review, approve, contact, watch, or skip.',
    avatar: orionImg,
    portrait: orionImg,
    accent: 'purple',
    accentHex: '#A855F7',
    department: 'operations',
    capabilities: [
      'approval queues',
      'next-action recommendations',
      'pipeline organization',
      'status summaries',
      'review management',
    ],
    // Scribe's generic content-generation capability is intentionally NOT
    // migrated to Orion yet — that surface stays on legacy Scribe until a
    // separate phase reviews it.
    legacySlugs: ['scribe'],
    publiclyVisible: true,
    fallbackInitial: 'O',
    status: 'active',
  },
};

export const PUBLIC_AGENT_ORDER: readonly PublicAgentId[] = [
  'pilot',
  'nova',
  'atlas',
  'mira',
  'orion',
];

/**
 * Legacy → public alias map for DISPLAY resolution ONLY.
 * Do not use this to reroute execution.
 */
export const LEGACY_TO_PUBLIC: Readonly<Record<LegacyAgentId, PublicAgentId>> = {
  pilot: 'pilot',
  scout: 'nova',
  aria: 'atlas',
  hawk: 'atlas',
  penn: 'mira',
  scribe: 'orion',
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
  avatar: pilotImg,
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
  if (opts.pilotFallback) return PUBLIC_AGENTS.pilot;
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
