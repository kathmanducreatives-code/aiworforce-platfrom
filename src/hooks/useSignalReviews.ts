// Phase 6 — load + mutate per-user signal review state. Optimistic updates with
// rollback on failure. Uses the anon Supabase client over RLS (no service role).
import { useCallback, useEffect, useState } from "react";
import { fetchSignalReviews, upsertSignalReview, bulkUpdateSignalReviews } from "@/lib/signalReviews";
import { indexReviewsBySignal, type ReviewStatus, type SignalReviewRow } from "@/lib/signalReviewModel";

export function useSignalReviews(workspaceId: string | null) {
  const [reviewsBySignal, setReviewsBySignal] = useState<Record<string, SignalReviewRow>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) { setReviewsBySignal({}); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchSignalReviews(workspaceId);
      setReviewsBySignal(indexReviewsBySignal(rows));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load review state");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  // Single-signal status change, optimistic with rollback.
  const setReview = useCallback(async (signalId: string, status: ReviewStatus) => {
    if (!workspaceId) return;
    const prev = reviewsBySignal[signalId];
    setReviewsBySignal((m) => ({ ...m, [signalId]: { ...(m[signalId] ?? {}), signal_id: signalId, status } }));
    try {
      const saved = await upsertSignalReview({ workspaceId, signalId, status });
      setReviewsBySignal((m) => ({ ...m, [signalId]: saved }));
    } catch (e) {
      // rollback
      setReviewsBySignal((m) => {
        const next = { ...m };
        if (prev) next[signalId] = prev; else delete next[signalId];
        return next;
      });
      throw e;
    }
  }, [workspaceId, reviewsBySignal]);

  // Bulk status change, optimistic with rollback.
  const bulkSetReview = useCallback(async (signalIds: string[], status: ReviewStatus) => {
    if (!workspaceId || signalIds.length === 0) return;
    const prev = reviewsBySignal;
    setReviewsBySignal((m) => {
      const next = { ...m };
      for (const id of signalIds) next[id] = { ...(next[id] ?? {}), signal_id: id, status };
      return next;
    });
    try {
      await bulkUpdateSignalReviews({ workspaceId, signalIds, status });
      // re-sync timestamps/ids from server
      const rows = await fetchSignalReviews(workspaceId);
      setReviewsBySignal(indexReviewsBySignal(rows));
    } catch (e) {
      setReviewsBySignal(prev);
      throw e;
    }
  }, [workspaceId, reviewsBySignal]);

  return { reviewsBySignal, loading, error, refresh: load, setReview, bulkSetReview };
}
