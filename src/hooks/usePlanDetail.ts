import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  fetchPlan, fetchTasksForPlan, fetchActivityForPlan, fetchApprovalsForPlan, fetchToolCallsForPlan,
  subscribePlan, type DBPlan, type DBTask, type DBActivity, type DBApproval, type DBToolCall,
} from '@/lib/orchestration';
import { deriveWorkflowUiState, type WorkflowRunUiState } from '@/lib/chat/state';
import {
  createPlanStoreRegistry, type PlanSnapshot, type PlanStore, type PlanStoreRegistry,
} from '@/lib/chat/planStore';

/**
 * THE BROWSER'S SIDE OF THE PLAN STORE.
 *
 * The reads, the realtime subscription and the heartbeat live in
 * `planStore.ts`, one per plan id however many components ask for it: four do
 * (ConversationView, ExecutionPlanCard, PlanDetailView, the Workbench), and
 * before this each ran its own loop against the same rows. The heartbeat is
 * also quiet while the tab is hidden — see the module header for what that
 * cost.
 */
export const planStores: PlanStoreRegistry = createPlanStoreRegistry({
  read: async (planId) => {
    const [plan, tasks, activity, approvals, toolCalls] = await Promise.all([
      fetchPlan(planId),
      fetchTasksForPlan(planId),
      fetchActivityForPlan(planId),
      fetchApprovalsForPlan(planId),
      fetchToolCallsForPlan(planId),
    ]);
    return { plan, tasks, activity, approvals, toolCalls };
  },
  subscribe: (planId, onChange) => subscribePlan(planId, onChange),
  isHidden: () => typeof document !== 'undefined' && document.hidden,
  onFocus: (handler) => {
    if (typeof window === 'undefined') return () => {};
    window.addEventListener('focus', handler);
    document.addEventListener('visibilitychange', handler);
    return () => {
      window.removeEventListener('focus', handler);
      document.removeEventListener('visibilitychange', handler);
    };
  },
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (id) => window.clearInterval(id),
  now: () => Date.now(),
});

const IDLE: PlanSnapshot = {
  plan: null, tasks: [], activity: [], approvals: [], toolCalls: [],
  loading: false, lastActivityAt: null, lastChangeAt: 0,
};

export function usePlanDetail(planId: string | null) {
  const storeRef = useRef<PlanStore | null>(null);
  // Acquired in a ref during render and released on unmount, so the store
  // exists before the first `getSnapshot` and is shared by every consumer of
  // this plan id.
  const held = useRef<string | null>(null);
  if (planId !== held.current) {
    if (held.current) planStores.release(held.current);
    held.current = planId;
    storeRef.current = planId ? planStores.acquire(planId) : null;
  }
  useEffect(() => () => {
    if (held.current) planStores.release(held.current);
    held.current = null;
    storeRef.current = null;
  }, []);

  const subscribe = useCallback(
    (listener: () => void) => storeRef.current?.subscribe(listener) ?? (() => {}),
    [planId],
  );
  const getSnapshot = useCallback(
    () => storeRef.current?.snapshot() ?? IDLE,
    [planId],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => IDLE);
  const refresh = useCallback(() => { storeRef.current?.refresh(); }, [planId]);

  const uiState: WorkflowRunUiState = useMemo(() => deriveWorkflowUiState({
    plan: snapshot.plan, tasks: snapshot.tasks, approvals: snapshot.approvals,
    lastActivityAt: snapshot.lastActivityAt,
  }), [snapshot]);

  return {
    plan: snapshot.plan as DBPlan | null,
    tasks: snapshot.tasks as DBTask[],
    activity: snapshot.activity as DBActivity[],
    approvals: snapshot.approvals as DBApproval[],
    toolCalls: snapshot.toolCalls as DBToolCall[],
    loading: snapshot.loading,
    refresh,
    uiState,
    lastActivityAt: snapshot.lastActivityAt,
    secondsSinceChange: Math.floor((Date.now() - snapshot.lastChangeAt) / 1000),
  };
}
