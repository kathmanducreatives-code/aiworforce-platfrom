import { AGENT_BY_ID, AGENT_BY_NAME, PILOT_PROFILE, type AgentProfile } from '@/data/agentProfiles';

/** Resolve a slug or name to a profile, falling back to Pilot. */
export function resolveAgent(input?: string | null): AgentProfile {
  if (!input) return PILOT_PROFILE;
  const key = String(input).trim().toLowerCase();
  return AGENT_BY_ID[key] ?? AGENT_BY_NAME[key] ?? PILOT_PROFILE;
}

/** Infer the responsible agent slug from a workflow step / event_type / tool name. */
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
  // Explicit "Agent ..." attribution wins.
  const named = s.match(/\b(scout|aria|hawk|penn|scribe|pilot)\b/);
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
  // Last-resort content inference for legacy Pilot-attributed messages.
  const inferred = inferAgentFromContent(content);
  if (inferred) return resolveAgent(inferred);
  if (fallbackSlug) return resolveAgent(fallbackSlug);
  return PILOT_PROFILE;
}
