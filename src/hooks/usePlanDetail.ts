import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchPlan, fetchTasksForPlan, fetchActivityForPlan, fetchApprovalsForPlan, fetchToolCallsForPlan,
  subscribePlan, type DBPlan, type DBTask, type DBActivity, type DBApproval, type DBToolCall,
} from '@/lib/orchestration';
import { deriveWorkflowUiState, isWorkflowActive, type WorkflowRunUiState } from '@/lib/chat/state';

function latestActivityTs(plan: DBPlan | null, tasks: DBTask[], activity: DBActivity[], toolCalls: DBToolCall[]): string | null {
  const candidates: (string | null)[] = [
    plan?.completed_at ?? null,
    plan?.created_at ?? null,
    ...tasks.map((t) => t.finished_at ?? t.started_at ?? t.created_at ?? null),
    ...activity.map((a) => a.created_at ?? null),
    ...toolCalls.map((c) => c.completed_at ?? c.started_at ?? c.created_at ?? null),
  ];
  let best: number = -Infinity;
  let bestStr: string | null = null;
  for (const c of candidates) {
    if (!c) continue;
    const t = Date.parse(c);
    if (Number.isFinite(t) && t > best) { best = t; bestStr = c; }
  }
  return bestStr;
}

export function usePlanDetail(planId: string | null) {
  const [plan, setPlan] = useState<DBPlan | null>(null);
  const [tasks, setTasks] = useState<DBTask[]>([]);
  const [activity, setActivity] = useState<DBActivity[]>([]);
  const [approvals, setApprovals] = useState<DBApproval[]>([]);
  const [toolCalls, setToolCalls] = useState<DBToolCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const lastActivityRef = useRef<string | null>(null);
  const lastChangeAtRef = useRef<number>(Date.now());
  const [, forceTick] = useState(0);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  useEffect(() => {
    if (!planId) {
      setPlan(null); setTasks([]); setActivity([]); setApprovals([]); setToolCalls([]); setLoading(false);
      return;
    }
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      const [p, t, a, ap, tc] = await Promise.all([
        fetchPlan(planId),
        fetchTasksForPlan(planId),
        fetchActivityForPlan(planId),
        fetchApprovalsForPlan(planId),
        fetchToolCallsForPlan(planId),
      ]);
      if (cancelled) return;
      const newLatest = latestActivityTs(p, t, a, tc);
      if (newLatest !== lastActivityRef.current) {
        lastActivityRef.current = newLatest;
        lastChangeAtRef.current = Date.now();
      }
      setPlan(p); setTasks(t); setActivity(a); setApprovals(ap); setToolCalls(tc); setLoading(false);
    };
    load();
    const unsub = subscribePlan(planId, load);

    // Heartbeat: poll while the workflow is still active so a dropped
    // realtime socket can never strand the UI in a frozen "Executing" state.
    const interval = window.setInterval(() => {
      const uiState = deriveWorkflowUiState({
        plan, tasks, approvals,
        lastActivityAt: lastActivityRef.current,
      });
      if (isWorkflowActive(uiState)) load();
      // Force a re-render so consumers can re-evaluate "still working" labels.
      forceTick((x) => x + 1);
    }, 4000);

    return () => { cancelled = true; unsub(); window.clearInterval(interval); };
  }, [planId, refreshTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const uiState: WorkflowRunUiState = deriveWorkflowUiState({
    plan, tasks, approvals,
    lastActivityAt: lastActivityRef.current,
  });
  const secondsSinceChange = Math.floor((Date.now() - lastChangeAtRef.current) / 1000);

  return {
    plan, tasks, activity, approvals, toolCalls,
    loading, refresh,
    uiState,
    lastActivityAt: lastActivityRef.current,
    secondsSinceChange,
  };
}
