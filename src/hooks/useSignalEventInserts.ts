import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { normalizeSignalEventRow, type RawSignalEventRow } from '@/lib/signalEventProjection';
import { acceptArrival } from '@/lib/liveIntelligence';
import type { FeedSignal } from '@/lib/signalFeedModel';

/** A scan writes its signals in a burst; they arrive as one batch, not twenty ripples. */
const BATCH_WINDOW_MS = 1500;
/** Only a long absence warrants a catch-up read — never a poll. */
const STALE_AFTER_HIDDEN_MS = 5 * 60_000;

/**
 * NEW SIGNALS, AS THEY ARE WRITTEN.
 *
 * Subscribes to INSERTs on `signal_events` for one workspace. Writers upsert
 * with `ignoreDuplicates`, so an INSERT is a genuinely new real-world event — a
 * re-detection writes nothing and therefore announces nothing.
 *
 * Requires `signal_events` in the `supabase_realtime` publication
 * (20260917120000_signal_events_realtime_publication.sql). Without it the
 * channel still reaches SUBSCRIBED and simply never delivers — the bar then
 * behaves as a static, reload-fresh surface, which is safe.
 *
 * `onReconcile` asks the owner to re-read the feed: after the channel recovers
 * from an error, or when a tab returns from a long absence, because rows written
 * while nobody was listening are not replayed.
 */
export function useSignalEventInserts(
  workspaceId: string | null,
  onArrivals: (signals: FeedSignal[]) => void,
  onReconcile: () => void,
) {
  const arrivals = useRef(onArrivals);
  const reconcile = useRef(onReconcile);
  arrivals.current = onArrivals;
  reconcile.current = onReconcile;

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    let buffer: FeedSignal[] = [];
    let flushTimer = 0;
    let degraded = false;
    let hiddenAt: number | null = null;

    const flush = () => {
      flushTimer = 0;
      if (cancelled || !buffer.length) return;
      const batch = buffer;
      buffer = [];
      arrivals.current(batch);
    };

    const topic = `live-intelligence:${workspaceId}:${
      typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)
    }`;
    const channel = supabase.channel(topic);
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'signal_events', filter: `workspace_id=eq.${workspaceId}` },
      (payload) => {
        const row = payload.new as (RawSignalEventRow & { lifecycle_status?: string }) | undefined;
        // RLS and the filter already scope this; the client checks again so a
        // channel left over from a previous workspace can never paint this one.
        if (cancelled || !acceptArrival(row, workspaceId)) return;
        buffer.push(normalizeSignalEventRow(row!));
        if (!flushTimer) flushTimer = window.setTimeout(flush, BATCH_WINDOW_MS);
      },
    );
    channel.subscribe((status) => {
      if (cancelled) return;
      if (status === 'SUBSCRIBED') {
        // The first subscribe follows a fresh read; only a RECOVERY needs one.
        if (degraded) { degraded = false; reconcile.current(); }
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        degraded = true;
        if (import.meta.env.DEV) console.warn('[live-intelligence] realtime unavailable; the bar stays reload-fresh', { status });
      }
    });

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      if (hiddenAt !== null && Date.now() - hiddenAt > STALE_AFTER_HIDDEN_MS) reconcile.current();
      hiddenAt = null;
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      window.clearTimeout(flushTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      supabase.removeChannel(channel);
    };
  }, [workspaceId]);
}
