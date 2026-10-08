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
