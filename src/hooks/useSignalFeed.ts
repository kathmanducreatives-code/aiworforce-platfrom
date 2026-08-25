// Signal Feed v1 — data + actions. Reuses the existing fetcher and adds the
// `runRadarScan` invocation + per-category capability/status read-out.
import { useCallback, useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchOutreachDrafts, fetchSavedOutputs, type DraftRow, type SavedOutputRow } from "@/lib/signalsFeed";
import { fetchSignalFeed, type SignalFeedResult } from "@/lib/signalEventsFeed";
import type { SignalCluster } from "../../supabase/functions/_shared/signalCluster.ts";
import type { FeedSignal } from "@/lib/signalFeedModel";

export type RadarMode = "default" | "load_more" | "category";
export type RadarCategory = "hiring" | "linkedin_intent" | "competitor" | "workflow_trend" | "people";

export interface CategoryStatus {
  found: number;
  accepted: number;
  status: "ready" | "setup_needed" | "skipped";
  reason?: string;
}

export interface SourceDiagnostic {
  source: string;
  readiness: string;
  execution_status?: string;
  queries_attempted?: string[];
  raw_count?: number;
  normalized_count?: number;
  duplicate_count?: number;
  rejected_count?: number;
  accepted_count?: number;
  verified_count?: number;
  needs_review_count?: number;
  rejection_reasons?: Record<string, number>;
  provider_error?: string | null;
  elapsed_ms?: number;
  provider_items_consumed?: number;
  estimated_cost_usd?: number;
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
  /** Per-source diagnostics + run id (radarDiagnostics / scan_run_id). */
  diagnostics?: SourceDiagnostic[];
  scan_run_id?: string;
  dropped?: number;
  decision_counts?: Record<string, number>;
  adapters?: Record<string, { configured: boolean; actor: string | null; env_var: string; reason: string }>;
  /**
   * What the scan spent and why it stopped.
   *
   * A scan returning zero signals must say WHICH zero it is — quiet market,
   * provider refusal, budget ceiling, or declined credits. Those were one
   * answer, which is how ninety consecutive Firecrawl 429s read as "nothing
   * found" for the entire life of the feature.
   */
  credit_spend?: {
    used: number;
    ceiling: number;
    limited_by: "scan_cap" | "workspace_balance" | "unlimited";
    exhausted: boolean;
    price_per_search: number;
    mode: "observe" | "enforce";
    refused: number;
    /** Requests/minute the scan planned around — see RADAR_PROVIDER_RPM. */
    provider_rpm?: number;
    /** How many searches fit the wall clock at that rate. */
    time_capacity?: number;
  };
}

export function useSignalFeed(workspaceId: string | null, limit = 100) {
  const [signals, setSignals] = useState<FeedSignal[]>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [savedOutputs, setSavedOutputs] = useState<SavedOutputRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  /** What the feed is made of. Exposed so the read switch is inspectable. */
  const [coverage, setCoverage] = useState<SignalFeedResult["coverage"] | null>(null);
  /** The same intelligence as `signals`, grouped into situations. */
  const [clusters, setClusters] = useState<SignalCluster[]>([]);
  /** Relevance verdicts by cluster key. Empty when no judge has run. */
  const [relevance, setRelevance] = useState<SignalFeedResult["relevance"]>({});
  const [lastRun, setLastRun] = useState<RadarRunResult | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) { setSignals([]); setClusters([]); setRelevance({}); setDrafts([]); setSavedOutputs([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      // PHASE 3G — the feed reads `signal_events`, the canonical store every
      // origin writes to. `fetchSignalFeed` carries through any legacy row the
      // canonical store has no counterpart for, so nothing collected before the
      // dual-write disappears from a feed that showed it yesterday.
      const [s, d, o] = await Promise.all([
        fetchSignalFeed(workspaceId, limit),
        fetchOutreachDrafts(workspaceId, 50),
        fetchSavedOutputs(workspaceId, 50),
      ]);
      setSignals(s.signals); setCoverage(s.coverage); setClusters(s.clusters);
      setRelevance(s.relevance);
      setDrafts(d); setSavedOutputs(o);
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

  return { signals, clusters, relevance, coverage, drafts, savedOutputs, loading, error, refresh: load, runRadarScan, scanning, lastRun, lastScanAt };
}
