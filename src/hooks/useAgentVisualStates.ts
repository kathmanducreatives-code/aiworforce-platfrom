import { useEffect, useMemo, useRef, useState } from 'react';
import { useApprovals } from './useApprovals';
import { useCompanyBrain } from './useCompanyBrain';
import { useChatWorkspace } from '@/contexts/ChatWorkspaceContext';
import { subscribeActivityFeed } from '@/lib/orchestration';
import { coalesceLoads } from '@/lib/chat/coalescedLoad';
import { fetchAgentSlugs, fetchLiveTasks, fetchPlanningPlans, fetchTaskSlugs } from '@/lib/agent3d/liveSources';
import {
  anyAgentWorking, attributeApprovals, deriveAgentVisualStates, nextVisualExpiry,
  type AgentVisualState, type LiveChat, type LivePlan, type LiveSnapshot, type LiveTask, type VisualAgentKey,
} from '@/lib/agent3d/visualState';

/** While something is demonstrably running, re-read this often to catch it finishing. */
const WORKING_HEARTBEAT_MS = 30_000;

/**
 * Every agent's TRUTHFUL visual state, live.
 *
 * Sources, and only these:
 *   tasks       — `running` (fresh) → working; a recent finish → one event
 *   approvals   — pending and attributed by id → awaiting
 *   chat        — a reply being produced in the visible chat → thinking
 *   task_plans  — `planning` → Pilot thinking
 *   Company Brain — incomplete (once known) → Atlas blocked
 *
 * Deliberately NOT a source: signal, draft or content counts, and the legacy
 * `AgentState.status` built from them (useWorkforceState). A count says an
 * agent worked once; it never says an agent is working now.
 *
 * Cost: scalar-column reads only (see liveSources.ts). Re-read on mount, on an
 * activity-feed event, when a chat reply settles, when the tab returns, and
 * every 30 s only while some agent is actually running. Time-based changes
 * (a run going stale, a finish leaving its window) use one timer, no reads.
 */
export function useAgentVisualStates(workspaceId: string | null): { states: Record<VisualAgentKey, AgentVisualState>; ready: boolean } {
  const { approvals } = useApprovals(workspaceId);
  const { data: brain } = useCompanyBrain();
  const { pending, view } = useChatWorkspace();

  const [tasks, setTasks] = useState<LiveTask[]>([]);
  const [plans, setPlans] = useState<LivePlan[]>([]);
  const [agentSlugs, setAgentSlugs] = useState<Record<string, string>>({});
  const [olderTaskSlugs, setOlderTaskSlugs] = useState<Record<string, string | null>>({});
  const [now, setNow] = useState(() => Date.now());
  const [ready, setReady] = useState(false);
  const reload = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    setTasks([]); setPlans([]); setAgentSlugs({}); setOlderTaskSlugs({}); setReady(false);
    if (!workspaceId) return;
    let cancelled = false;
    const load = coalesceLoads(async () => {
      const [t, p] = await Promise.all([fetchLiveTasks(workspaceId, Date.now()), fetchPlanningPlans(workspaceId)]);
      if (cancelled) return;
      setTasks(t); setPlans(p); setNow(Date.now()); setReady(true);
    }, {
      isCancelled: () => cancelled,
      onError: (e) => { if (import.meta.env.DEV) console.warn('[agent-visual] live read failed', e); },
    });
    reload.current = load;
    void load();
    fetchAgentSlugs(workspaceId).then((m) => { if (!cancelled) setAgentSlugs(m); }).catch(() => {});
    const unsubActivity = subscribeActivityFeed(workspaceId, () => void load());
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      reload.current = async () => {};
      unsubActivity();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [workspaceId]);

  // A reply settling is when a chat most often starts work — look once.
  const awaitingReply = !!pending?.awaiting;
  const wasAwaiting = useRef(awaitingReply);
  useEffect(() => {
    if (wasAwaiting.current && !awaitingReply) void reload.current();
    wasAwaiting.current = awaitingReply;
  }, [awaitingReply]);

  // Approvals whose task fell outside the live window still need an owner.
  const taskSlugById = useMemo(() => ({ ...olderTaskSlugs, ...Object.fromEntries(tasks.map((t) => [t.id, t.agentSlug])) }), [tasks, olderTaskSlugs]);
  useEffect(() => {
    const missing = approvals
      .filter((a) => !(a.agent_id && agentSlugs[a.agent_id]) && a.task_id && !(a.task_id in taskSlugById))
      .map((a) => a.task_id as string);
    if (!missing.length) return;
    let cancelled = false;
    fetchTaskSlugs(missing).then((m) => { if (!cancelled) setOlderTaskSlugs((prev) => ({ ...prev, ...m })); }).catch(() => {});
    return () => { cancelled = true; };
  }, [approvals, agentSlugs, taskSlugById]);

  const chat: LiveChat | null = awaitingReply && pending
    ? { awaitingReply: true, agentSlug: view.kind === 'chat' && view.conversationId === pending.conversationId ? view.agentSlug : null }
    : null;
  const chatSlug = chat?.agentSlug ?? null;

  const snapshot: LiveSnapshot = useMemo(() => ({
    now,
    tasks,
    plans,
    approvals: attributeApprovals(approvals, agentSlugs, taskSlugById),
    chat: chat ? { awaitingReply: true, agentSlug: chatSlug } : null,
    // Unknown is not blocked: only a loaded, incomplete Brain gates Atlas.
    setupBlocked: brain && !brain.onboarding_completed ? { atlas: 'Needs your Company Brain' } : {},
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [now, tasks, plans, approvals, agentSlugs, taskSlugById, !!chat, chatSlug, brain]);

  const states = useMemo(() => deriveAgentVisualStates(snapshot), [snapshot]);

  // One timer for the next time-driven change — no reads.
  useEffect(() => {
    const at = nextVisualExpiry(snapshot);
    if (at === null) return;
    const id = window.setTimeout(() => setNow(Date.now()), Math.max(250, at - Date.now()));
    return () => window.clearTimeout(id);
  }, [snapshot]);

  // Heartbeat only while an agent is demonstrably running and the tab is visible.
  const working = anyAgentWorking(states) || plans.length > 0;
  useEffect(() => {
    if (!working) return;
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') void reload.current(); }, WORKING_HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [working]);

  return { states, ready };
}
