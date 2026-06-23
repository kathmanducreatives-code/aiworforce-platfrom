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
  if (/(source|sourcing|signal|find_leads|leads|companies|people|hiring|linkedin|scrape)/.test(s)) return 'scout';
  if (/(rank|score|prioriti|fit_|filter)/.test(s)) return 'aria';
  if (/(enrich|research|firecrawl|website|competitor|audit|market)/.test(s)) return 'hawk';
  if (/(draft|outreach|message|email|follow_?up|reply)/.test(s)) return 'penn';
  if (/(content|post_|report|summary|brief|writeup)/.test(s)) return 'scribe';
  return 'pilot';
}

/** Resolve an agent from common metadata shapes used across chat + activity. */
export function resolveAgentFromMetadata(
  meta?: Record<string, any> | null,
  fallbackSlug?: string | null,
): AgentProfile {
  if (meta) {
    const candidate =
      meta.agent_slug ?? meta.agent ?? meta.agent_name ?? meta.assigned_agent ?? meta.author_agent ?? null;
    if (candidate) return resolveAgent(candidate);
    if (meta.workflow_step) return resolveAgent(inferAgentFromAction(meta.workflow_step));
    if (meta.tool_name) return resolveAgent(inferAgentFromAction(meta.tool_name));
  }
  if (fallbackSlug) return resolveAgent(fallbackSlug);
  return PILOT_PROFILE;
}
