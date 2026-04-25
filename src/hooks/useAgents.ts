import { useEffect, useState } from 'react';
import {
  fetchAgents, subscribeAgents, type DBAgent,
} from '@/lib/orchestration';

export function useAgents(workspaceId: string | null) {
  const [agents, setAgents] = useState<DBAgent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId) { setAgents([]); setLoading(false); return; }
    let cancelled = false;
    const load = () => fetchAgents(workspaceId).then((rows) => {
      if (!cancelled) { setAgents(rows); setLoading(false); }
    });
    load();
    const unsub = subscribeAgents(workspaceId, load);
    return () => { cancelled = true; unsub(); };
  }, [workspaceId]);

  return { agents, loading };
}
