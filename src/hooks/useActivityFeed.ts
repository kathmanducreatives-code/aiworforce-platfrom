import { useEffect, useState } from 'react';
import { fetchActivityFeed, subscribeActivityFeed, type DBActivity } from '@/lib/orchestration';

export function useActivityFeed(workspaceId: string | null, limit = 30) {
  const [events, setEvents] = useState<DBActivity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId) { setEvents([]); setLoading(false); return; }
    let cancelled = false;
    const load = () => fetchActivityFeed(workspaceId, limit).then((rows) => {
      if (!cancelled) { setEvents(rows); setLoading(false); }
    });
    load();
    const unsub = subscribeActivityFeed(workspaceId, load);
    return () => { cancelled = true; unsub(); };
  }, [workspaceId, limit]);

  return { events, loading };
}
