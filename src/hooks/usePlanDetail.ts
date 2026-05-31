import { useEffect, useState } from 'react';
import {
  fetchPlan, fetchTasksForPlan, fetchActivityForPlan, fetchApprovalsForPlan, fetchToolCallsForPlan,
  subscribePlan, type DBPlan, type DBTask, type DBActivity, type DBApproval, type DBToolCall,
} from '@/lib/orchestration';

export function usePlanDetail(planId: string | null) {
  const [plan, setPlan] = useState<DBPlan | null>(null);
  const [tasks, setTasks] = useState<DBTask[]>([]);
  const [activity, setActivity] = useState<DBActivity[]>([]);
  const [approvals, setApprovals] = useState<DBApproval[]>([]);
  const [toolCalls, setToolCalls] = useState<DBToolCall[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!planId) {
      setPlan(null); setTasks([]); setActivity([]); setApprovals([]); setToolCalls([]); setLoading(false);
      return;
    }
    let cancelled = false;

    const load = async () => {
      const [p, t, a, ap, tc] = await Promise.all([
        fetchPlan(planId),
        fetchTasksForPlan(planId),
        fetchActivityForPlan(planId),
        fetchApprovalsForPlan(planId),
        fetchToolCallsForPlan(planId),
      ]);
      if (cancelled) return;
      setPlan(p); setTasks(t); setActivity(a); setApprovals(ap); setToolCalls(tc); setLoading(false);
    };
    load();
    const unsub = subscribePlan(planId, load);
    return () => { cancelled = true; unsub(); };
  }, [planId]);

  return { plan, tasks, activity, approvals, toolCalls, loading };
}
