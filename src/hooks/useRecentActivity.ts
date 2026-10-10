import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchAgentSlugs } from '@/lib/agent3d/liveSources';
import {
  fetchActivityRows, fetchDraftRows, fetchFailedTaskRows, fetchPlanInstructions, fetchSignalRows,
  fetchTaskOutcomes, subscribeActivityInserts, type LiveStatus,
} from '@/lib/activity/activitySources';
import {
  acceptRow, buildActivityFeed, CURATED_EVENT_TYPES, EMPTY_ENRICHMENT, enrichmentNeeds, mergeRows,
  type ActivityItem, type ActivityRow, type DraftRow, type Enrichment, type FailedTaskRow, type SignalRow,
} from '@/lib/activity/activityFeedModel';

/** Sources without realtime (signals, drafts, failed tasks) are re-read this often while visible. */
const POLL_MS = 60_000;
/** After any activity insert, re-read those sources once things settle (a run writes in bursts). */
const SETTLE_MS = 4_000;
const CURATED = new Set<string>(CURATED_EVENT_TYPES);

export type FeedState = 'loading' | 'ready' | 'error';

/**
 * RECENT ACTIVITY, LIVE.
 *
 *   history   — read from persistent tables on mount (survives refresh)
 *   live      — activity_feed INSERTs over Supabase Realtime
 *   catch-up  — signal_events / outreach_drafts / failed tasks are not in the
 *               realtime publication, so they are re-read after activity
 *               settles and every 60 s while the tab is visible
 *
 * Everything is scoped to `workspaceId` (query filter + RLS + acceptRow) and
 * torn down on unmount or workspace change.
 */
export function useRecentActivity(workspaceId: string | null, limit = 4) {
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [failedTasks, setFailedTasks] = useState<FailedTaskRow[]>([]);
  const [enrichment, setEnrichment] = useState<Enrichment>(EMPTY_ENRICHMENT);
  const [state, setState] = useState<FeedState>('loading');
  const [live, setLive] = useState<LiveStatus>('connecting');
  const [arrivedKey, setArrivedKey] = useState<string | null>(null);
  const enrichRef = useRef<Enrichment>(EMPTY_ENRICHMENT);
  const reloadRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    setActivity([]); setSignals([]); setDrafts([]); setFailedTasks([]);
    setEnrichment(EMPTY_ENRICHMENT); enrichRef.current = EMPTY_ENRICHMENT;
    setState('loading'); setLive('connecting'); setArrivedKey(null);
    if (!workspaceId) { setState('ready'); return; }

    let cancelled = false;
    let settleTimer = 0;
    let pollTimer = 0;
    let liveNow: LiveStatus = 'connecting';

    const patchEnrichment = (p: Partial<Enrichment>) => {
      const next = {
        agentSlugs: { ...enrichRef.current.agentSlugs, ...p.agentSlugs },
        tasks: { ...enrichRef.current.tasks, ...p.tasks },
        plans: { ...enrichRef.current.plans, ...p.plans },
      };
      enrichRef.current = next;
      if (!cancelled) setEnrichment(next);
    };

    const enrich = async (rows: readonly ActivityRow[]) => {
      const { taskIds, planIds } = enrichmentNeeds(rows, enrichRef.current);
      const [tasks, plans] = await Promise.all([fetchTaskOutcomes(workspaceId, taskIds), fetchPlanInstructions(workspaceId, planIds)]);
      if (!cancelled) patchEnrichment({ tasks, plans });
    };

    const readSecondary = async () => {
      const [s, d, f] = await Promise.all([
        fetchSignalRows(workspaceId), fetchDraftRows(workspaceId), fetchFailedTaskRows(workspaceId),
      ]);
      if (cancelled) return;
      setSignals(s); setDrafts(d); setFailedTasks(f);
      const planIds = f.map((t) => t.plan_id ?? t.task_plan_id).filter((p): p is string => !!p && !(p in enrichRef.current.plans));
      if (planIds.length) patchEnrichment({ plans: await fetchPlanInstructions(workspaceId, planIds) });
    };

    const load = async () => {
      try {
        const [rows, slugs] = await Promise.all([fetchActivityRows(workspaceId), fetchAgentSlugs(workspaceId)]);
        if (cancelled) return;
        patchEnrichment({ agentSlugs: slugs });
        await Promise.all([enrich(rows), readSecondary()]);
        if (cancelled) return;
        setActivity(rows);
        setState('ready');
      } catch (e) {
        if (cancelled) return;
        if (import.meta.env.DEV) console.warn('[recent-activity] read failed', e);
        setState((s) => (s === 'ready' ? s : 'error'));
      }
    };
    reloadRef.current = load;
    void load();

    const settle = () => {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => { void readSecondary().catch(() => {}); }, SETTLE_MS);
    };

    const unsubscribe = subscribeActivityInserts(
      workspaceId,
      (row) => {
        // RLS and the channel filter scope delivery; check once more on the client.
        if (cancelled || !acceptRow(row, workspaceId)) return;
        // Any write means work is happening: catch up the non-realtime sources.
        settle();
        if (!CURATED.has(row.event_type)) return;
        void (async () => {
          // A new agent id (a workspace agent created mid-session) needs its slug.
          if (row.agent_id && !enrichRef.current.agentSlugs[row.agent_id]) {
            patchEnrichment({ agentSlugs: await fetchAgentSlugs(workspaceId).catch(() => ({})) });
          }
          await enrich([row]).catch(() => {});
          if (cancelled) return;
          setActivity((prev) => mergeRows(prev, [row]));
          setArrivedKey(`activity:${row.id}`);
        })();
      },
      (s) => {
        if (cancelled) return;
        const recovered = liveNow === 'offline' && s === 'live';
        liveNow = s;
        setLive(s);
        // Back from a drop: anything written meanwhile was missed — read it.
        if (recovered) void load();
      },
    );

    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      // While realtime is down the activity table is polled too.
      void (liveNow === 'live' ? readSecondary() : load()).catch(() => {});
    };
    pollTimer = window.setInterval(tick, POLL_MS);
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      if (hiddenAt !== null && Date.now() - hiddenAt > POLL_MS) void load();
      hiddenAt = null;
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      reloadRef.current = async () => {};
      window.clearTimeout(settleTimer);
      window.clearInterval(pollTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      unsubscribe();
    };
  }, [workspaceId]);

  const items: ActivityItem[] = useMemo(
    () => buildActivityFeed({ workspaceId, activity, signals, drafts, failedTasks, enrichment, limit }),
    [workspaceId, activity, signals, drafts, failedTasks, enrichment, limit],
  );

  const retry = useCallback(() => { setState('loading'); void reloadRef.current(); }, []);

  return { items, state, live, arrivedKey, retry };
}
