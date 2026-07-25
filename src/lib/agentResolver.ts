import {
  AGENT_BY_ID,
  AGENT_BY_NAME,
  PILOT_PROFILE,
  type AgentProfile,
} from '@/data/agentProfiles';
import { lookupPublicAgent } from '@/config/agentRegistry';

/**
 * DISPLAY resolver — returns a public-facing profile.
 *
 * Historical legacy slugs (scout / aria / hawk / penn / scribe) are aliased
 * to their public identity (Lyra / Atlas / Atlas / Mira / Orion) so activity
 * rows, chat attribution, and dock surfaces always render the public name.
 *
 * NOTE: this resolver is intentionally used by presentation code only. It
 * MUST NOT be used to reroute execution — orchestration continues to route
 * by the underlying legacy slug.
 *
 * Fallback policy:
 *   - null / undefined / empty / unknown → Pilot (kept for backward
 *     compatibility with existing call sites that assumed Pilot fallback).
 *     Prefer `resolveAgentForDisplay(..., { pilotFallback: false })` from
 *     `@/config/agentRegistry` for new surfaces that need a neutral
 *     "Unattributed" fallback instead of silently attributing to Pilot.
 */
export function resolveAgent(input?: string | null): AgentProfile {
  if (!input) return PILOT_PROFILE;
  const key = String(input).trim().toLowerCase();
  // Legacy compat table already includes both public and legacy keys.
  return AGENT_BY_ID[key] ?? AGENT_BY_NAME[key] ?? PILOT_PROFILE;
}

/** Infer the responsible agent slug from a workflow step / event_type / tool name.
 *  Returns a LEGACY slug — callers that display should run it through
 *  `resolveAgent()` so the public identity is shown.
 */
export function inferAgentFromAction(action?: string | null): string {
  if (!action) return 'pilot';
  const s = String(action).toLowerCase();
  if (/(source|sourcing|signal|find_leads|leads|companies|people|hiring|linkedin|scrape|apify|decision[_-]?makers?|find_contacts?)/.test(s)) return 'scout';
  if (/(rank|score|prioriti|fit_|filter)/.test(s)) return 'aria';
  if (/(enrich|research|firecrawl|website|competitor|audit|market)/.test(s)) return 'hawk';
  if (/(draft|outreach|message|email|follow_?up|reply|cold[_-]?call|opener)/.test(s)) return 'penn';
  if (/(content|post_|report|summary|brief|writeup|blog|linkedin[_-]?post)/.test(s)) return 'scribe';
  return 'pilot';
}

/**
 * Content-based fallback inference for legacy messages that were saved with
 * agent_slug="pilot" but actually describe Scout/Aria/Hawk/Penn/Scribe work.
 * Used as last-resort before defaulting to Pilot.
 */
export function inferAgentFromContent(text?: string | null): string | null {
  if (!text) return null;
  const s = String(text).toLowerCase();
  // Explicit named attribution wins — accept both legacy and public names.
  const named = s.match(/\b(scout|aria|hawk|penn|scribe|pilot|lyra|atlas|mira|orion)\b/);
  if (named) return named[1];

  if (/\b(sourc(?:e|ed|ing)|raw results?|accepted \d+ qualified|apify|hiring signal|find (?:decision|contacts?))/.test(s)) return 'scout';
  if (/\b(rank(?:ed|ing)?|fit score|prioriti[sz]ed|ranked against)/.test(s)) return 'aria';
  if (/\b(research(?:ed|ing)?|firecrawl|enrich(?:ed|ing)?|website analysis|competitor analysis)/.test(s)) return 'hawk';
  if (/\b(draft(?:ed|ing)?|outreach|follow[- ]?up|cold call|email copy|approval[- ]gated)/.test(s)) return 'penn';
  if (/\b(linkedin post|content idea|wrote a (?:post|report|summary)|content brief)/.test(s)) return 'scribe';
  return null;
}

/** Resolve an agent from common metadata shapes used across chat + activity. */
export function resolveAgentFromMetadata(
  meta?: Record<string, any> | null,
  fallbackSlug?: string | null,
  content?: string | null,
): AgentProfile {
  if (meta) {
    const candidate =
      meta.agent_id ?? meta.agent_slug ?? meta.agent ?? meta.agent_name ?? meta.assigned_agent ?? meta.author_agent ?? null;
    if (candidate) return resolveAgent(candidate);
    if (meta.workflow_step) return resolveAgent(inferAgentFromAction(meta.workflow_step));
    if (meta.tool_name) return resolveAgent(inferAgentFromAction(meta.tool_name));
  }
  if (fallbackSlug && fallbackSlug.toLowerCase() !== 'pilot') {
    return resolveAgent(fallbackSlug);
  }
  const inferred = inferAgentFromContent(content);
  if (inferred) return resolveAgent(inferred);
  if (fallbackSlug) return resolveAgent(fallbackSlug);
  return PILOT_PROFILE;
}

/**
 * Public identity accessor — returns the canonical public identity for any
 * legacy or public slug/name. Prefer this in new display surfaces.
 */
export function resolvePublicAgent(input?: string | null) {
  return lookupPublicAgent(input);
}
