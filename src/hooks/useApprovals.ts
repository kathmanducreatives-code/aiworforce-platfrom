import { useEffect, useState } from 'react';
import { fetchPendingApprovals, subscribeApprovals, type DBApproval } from '@/lib/orchestration';

export function useApprovals(workspaceId: string | null) {
  const [approvals, setApprovals] = useState<DBApproval[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId) { setApprovals([]); setLoading(false); return; }
    let cancelled = false;
    const load = () => fetchPendingApprovals(workspaceId).then((rows) => {
      if (!cancelled) { setApprovals(rows); setLoading(false); }
    });
    load();
    const unsub = subscribeApprovals(workspaceId, load);
    return () => { cancelled = true; unsub(); };
  }, [workspaceId]);

  return { approvals, loading, count: approvals.length };
}
