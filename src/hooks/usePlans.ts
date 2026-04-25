import { useEffect, useState } from 'react';
import { fetchPlans, subscribePlans, type DBPlan } from '@/lib/orchestration';

export function useAllPlans(workspaceId: string | null, limit = 50) {
  const [plans, setPlans] = useState<DBPlan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId) { setPlans([]); setLoading(false); return; }
    let cancelled = false;
    const load = () => fetchPlans(workspaceId, limit).then((rows) => {
      if (!cancelled) { setPlans(rows); setLoading(false); }
    });
    load();
    const unsub = subscribePlans(workspaceId, load);
    return () => { cancelled = true; unsub(); };
  }, [workspaceId, limit]);

  return { plans, loading };
}
