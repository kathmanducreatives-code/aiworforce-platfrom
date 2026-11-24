import { useAgentVisualStates } from './useAgentVisualStates';
import { statusWordOf, visualAgentKey } from '@/lib/agent3d/visualState';

/**
 * The live status word for a department's agent — the SAME source the dashboard
 * agent cards use (useAgentVisualStates: running tasks, pending approvals, the
 * chat reply in progress, setup blocks). `slug` may be public ('lyra') or a
 * backend slug ('scribe'); it resolves through the one legacy map, exactly as
 * task rows are attributed. Null until the live state has loaded — the badge
 * then shows nothing rather than a guess.
 */
export function useDepartmentAgentStatus(workspaceId: string | null, slug: string): string | null {
  const { states, ready } = useAgentVisualStates(workspaceId);
  const key = visualAgentKey(slug);
  return ready && key ? statusWordOf(states[key]) : null;
}

/**
 * WHY an agent is blocked, in plain language ("Needs your Company Brain"), or
 * null when it is not blocked. A bare "Blocked" badge next to leads that exist
 * read as a fault (TEST, 2026-11-12); the reason makes the gate legible.
 */
export function useDepartmentAgentBlockReason(workspaceId: string | null, slug: string): string | null {
  const { states, ready } = useAgentVisualStates(workspaceId);
  const key = visualAgentKey(slug);
  const st = ready && key ? states[key] : null;
  return st && st.base === 'blocked' ? st.reason : null;
}
