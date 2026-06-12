import { useCallback, useEffect, useState } from "react";
import { fetchSignals, fetchOutreachDrafts, fetchSavedOutputs, type DraftRow, type SavedOutputRow } from "@/lib/signalsFeed";
import type { FeedSignal } from "@/lib/signalFeedModel";

export function useSignalFeed(workspaceId: string | null, limit = 100) {
  const [signals, setSignals] = useState<FeedSignal[]>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [savedOutputs, setSavedOutputs] = useState<SavedOutputRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) { setSignals([]); setDrafts([]); setSavedOutputs([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [s, d, o] = await Promise.all([
        fetchSignals(workspaceId, limit),
        fetchOutreachDrafts(workspaceId, 50),
        fetchSavedOutputs(workspaceId, 50),
      ]);
      setSignals(s);
      setDrafts(d);
      setSavedOutputs(o);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load signals");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, limit]);

  useEffect(() => { void load(); }, [load]);

  return { signals, drafts, savedOutputs, loading, error, refresh: load };
}
