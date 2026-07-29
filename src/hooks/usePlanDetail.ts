import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchPlan, fetchTasksForPlan, fetchActivityForPlan, fetchApprovalsForPlan, fetchToolCallsForPlan,
  subscribePlan, type DBPlan, type DBTask, type DBActivity, type DBApproval, type DBToolCall,
} from '@/lib/orchestration';
import { deriveWorkflowUiState, type WorkflowRunUiState } from '@/lib/chat/state';
import { decidePlanRefetch } from '@/lib/chat/planRefetch';

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

  // CURRENT STATE, READABLE FROM A LONG-LIVED CALLBACK.
  //
  // The heartbeat and the focus handler are created once per `planId` and must
  // judge whether to re-read using what we hold NOW. Reading the state variables
  // directly captures them at effect-creation time — `plan: null`, `tasks: []` —
  // which is precisely the bug that made the old heartbeat inert for the whole
  // life of the component. Refs are the state; the setters below keep them so.
  const planRef = useRef<DBPlan | null>(null);
  const tasksRef = useRef<DBTask[]>([]);
  const approvalsRef = useRef<DBApproval[]>([]);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  useEffect(() => {
    if (!planId) {
      planRef.current = null; tasksRef.current = []; approvalsRef.current = [];
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
      planRef.current = p; tasksRef.current = t; approvalsRef.current = ap;
      setPlan(p); setTasks(t); setActivity(a); setApprovals(ap); setToolCalls(tc); setLoading(false);
    };
    load();

    // PRIMARY PATH. Realtime pushes plan, task, activity, approval and tool-call
    // changes; the migration in this PR is what makes those events reach us.
    const unsub = subscribePlan(planId, load);

    // Heartbeat: a safety net for a dropped socket, a missed event, or the ~2s
    // race where the plan exists and run-agent has not inserted its task yet.
    // It reads the REFS, so it sees what we hold now rather than what we held at
    // mount — the distinction that made the previous heartbeat never fire.
    const interval = window.setInterval(() => {
      const decision = decidePlanRefetch({
        plan: planRef.current, tasks: tasksRef.current, approvals: approvalsRef.current,
        lastActivityAt: lastActivityRef.current,
      });
      if (decision.should) load();
      // Force a re-render so consumers can re-evaluate "still working" labels.
      forceTick((x) => x + 1);
    }, 4000);

    // Realtime does not replay what was missed while the tab was hidden, and a
    // socket dropped in the background reconnects with a gap. One read on
    // refocus closes it. Not polling: it fires on a user action, never on a timer.
    const onFocus = () => {
      // `visibilitychange` also fires on HIDE. Reading then is pointless work
      // against a tab nobody is looking at.
      if (typeof document !== 'undefined' && document.hidden) return;
      const decision = decidePlanRefetch({
        plan: planRef.current, tasks: tasksRef.current, approvals: approvalsRef.current,
        lastActivityAt: lastActivityRef.current, regainedFocus: true,
      });
      if (decision.should) load();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);

    return () => {
      cancelled = true;
      unsub();
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
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
