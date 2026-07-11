// Signal Feed v1 — data + actions. Reuses the existing fetcher and adds the
// `runRadarScan` invocation + per-category capability/status read-out.
import { useCallback, useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchSignals, fetchOutreachDrafts, fetchSavedOutputs, type DraftRow, type SavedOutputRow } from "@/lib/signalsFeed";
import type { FeedSignal } from "@/lib/signalFeedModel";

export type RadarMode = "default" | "load_more" | "category";
export type RadarCategory = "hiring" | "linkedin_intent" | "competitor" | "workflow_trend" | "people";

export interface CategoryStatus {
  found: number;
  accepted: number;
  status: "ready" | "setup_needed" | "skipped";
  reason?: string;
}

export interface RadarRunResult {
  ok: boolean;
  inserted: number;
  per_category: Record<RadarCategory, CategoryStatus>;
  capabilities: Record<RadarCategory, { ready: boolean; reason?: string }>;
  mode: RadarMode;
  /** Company-Brain honesty layer surfaced by run-radar-scan. */
  setup_required?: boolean;
  brain_confidence?: "strong" | "medium" | "weak";
  warnings?: string[];
}

export function useSignalFeed(workspaceId: string | null, limit = 100) {
  const [signals, setSignals] = useState<FeedSignal[]>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [savedOutputs, setSavedOutputs] = useState<SavedOutputRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [lastRun, setLastRun] = useState<RadarRunResult | null>(null);

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
      setSignals(s); setDrafts(d); setSavedOutputs(o);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load signals");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, limit]);

  useEffect(() => { void load(); }, [load]);

  const runRadarScan = useCallback(async (opts: { mode?: RadarMode; category?: RadarCategory; confirmed?: boolean; limit?: number } = {}) => {
    if (!workspaceId) throw new Error("No workspace");
    setScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke("run-radar-scan", {
        body: {
          workspace_id: workspaceId,
          mode: opts.mode ?? "default",
          category: opts.category,
          confirmed: opts.confirmed ?? false,
          limit: opts.limit,
        },
      });
      if (error) throw error;
      setLastRun(data as RadarRunResult);
      await load();
      return data as RadarRunResult;
    } finally {
      setScanning(false);
    }
  }, [workspaceId, load]);

  const lastScanAt = useMemo<string | null>(() => signals[0]?.created_at ?? null, [signals]);

  return { signals, drafts, savedOutputs, loading, error, refresh: load, runRadarScan, scanning, lastRun, lastScanAt };
}
