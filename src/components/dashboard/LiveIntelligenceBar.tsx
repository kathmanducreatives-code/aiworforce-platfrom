import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion, type TargetAndTransition } from 'framer-motion';
import SignalDetailDrawer from '@/components/signals/SignalDetailDrawer';
import { useSignalReviews } from '@/hooks/useSignalReviews';
import { useSignalEventInserts } from '@/hooks/useSignalEventInserts';
import type { useWorkforceState } from '@/hooks/useWorkforceState';
import type { FeedSignal } from '@/lib/signalFeedModel';
import type { ReviewStatus } from '@/lib/signalReviewModel';
import {
  allUnverified, contextOf, incomingHighlight, mergeArrivals, rankLiveItems, type LiveItem,
} from '@/lib/liveIntelligence';
import './live-intelligence.css';

type SignalFeed = ReturnType<typeof useWorkforceState>['signalFeed'];

/** How long each item holds before the quiet rotation. */
const DWELL_MS = 8000;
/** The feed reads this many canonical rows; fewer means the set is complete. */
const FEED_LIMIT = 100;
/** When, inside the arrival ripple, the new signal replaces the old one. */
const ARRIVAL_SWAP_MS = 380;
const ARRIVAL_TOTAL_MS = 1300;

const pad = (n: number) => String(n).padStart(2, '0');

type Presence = { initial: TargetAndTransition; animate: TargetAndTransition; exit: TargetAndTransition };
const EASE_OUT: [number, number, number, number] = [0.22, 0.8, 0.3, 1];
const EASE_IN: [number, number, number, number] = [0.4, 0, 1, 1];
const FADE: Presence = { initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: 0.25 } }, exit: { opacity: 0, transition: { duration: 0.15 } } };

/**
 * LIVE INTELLIGENCE — the dashboard's window onto what Agentory has detected.
 *
 * Reads the signal feed the dashboard already loaded (no second query), ranks
 * it with `rankLiveItems`, rotates quietly, and — when a genuinely new signal is
 * written while the page is open — lets it arrive with a ripple through the
 * glass. Opening an item reuses the existing SignalDetailDrawer.
 */
export default function LiveIntelligenceBar({ workspaceId, feed }: { workspaceId: string | null; feed: SignalFeed }) {
  const navigate = useNavigate();
  const reduced = useReducedMotion() ?? false;
  const host = useRef<HTMLElement>(null);
  const dot = useRef<HTMLSpanElement>(null);

  // ── data ────────────────────────────────────────────────────────────────
  const { reviewsBySignal, setReview } = useSignalReviews(workspaceId);
  const [arrivals, setArrivals] = useState<FeedSignal[]>([]);
  useEffect(() => { setArrivals([]); }, [workspaceId]);

  const ignoredIds = useMemo(
    () => new Set(Object.entries(reviewsBySignal).filter(([, r]) => r?.status === 'ignored').map(([id]) => id)),
    [reviewsBySignal],
  );
  const signals = useMemo(() => mergeArrivals(feed.signals, arrivals), [feed.signals, arrivals]);
  const complete = (feed.coverage?.canonical ?? 0) < FEED_LIMIT;
  // Ranked when the DATA changes, not on a clock: a ticking freshness score
  // would reorder the rotation under the reader's eyes.
  const items = useMemo<LiveItem[]>(
    () => rankLiveItems({ signals, clusters: feed.clusters, relevance: feed.relevance, ignoredIds, complete, now: Date.now() }),
    [signals, feed.clusters, feed.relevance, ignoredIds, complete],
  );
  const unverifiedOnly = allUnverified(items);

  // Relative times ("4m ago") refresh on their own, without re-ranking.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(t); }, []);

  // ── which item is showing ──────────────────────────────────────────────
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const index = Math.max(0, items.findIndex((i) => i.key === activeKey));
  const item = items[index] ?? null;
  useEffect(() => { if (item && item.key !== activeKey) setActiveKey(item.key); }, [item, activeKey]);

  const advance = useCallback((step = 1) => {
    if (items.length < 2) return;
    setActiveKey(items[(index + step + items.length) % items.length].key);
  }, [items, index]);

  // ── rotation: paused while the person is with the bar ──────────────────
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [selected, setSelected] = useState<FeedSignal | null>(null);
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  const paused = hovered || focused || !!selected || !visible;

  // The timer resumes with what was LEFT, so it stays in step with the progress
  // line, which pauses in place rather than restarting.
  const remaining = useRef(DWELL_MS);
  useEffect(() => { remaining.current = DWELL_MS; }, [item?.key]);
  useEffect(() => {
    if (!item || items.length < 2 || paused) return;
    const started = Date.now();
    const t = window.setTimeout(() => advance(1), remaining.current);
    return () => { window.clearTimeout(t); remaining.current = Math.max(0, remaining.current - (Date.now() - started)); };
  }, [item, items.length, paused, advance]);

  // ── arrivals ───────────────────────────────────────────────────────────
  const pending = useRef<{ ids: Set<string>; count: number } | null>(null);
  const [arrival, setArrival] = useState<{ nonce: number; key: string; ox: number; oy: number; rmax: number } | null>(null);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [freshExtra, setFreshExtra] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  // Arrival timers outlive re-renders: a second batch or a late review load
  // re-ranks the list, and must not cancel a ripple mid-flight.
  const arrivalTimers = useRef<number[]>([]);
  useEffect(() => () => arrivalTimers.current.forEach((t) => window.clearTimeout(t)), []);

  const onArrivals = useCallback((batch: FeedSignal[]) => {
    pending.current = { ids: new Set(batch.map((s) => s.id)), count: batch.length };
    setArrivals((prev) => mergeArrivals(prev, batch));
  }, []);
  const onReconcile = useCallback(() => { void feed.refresh(); }, [feed]);
  useSignalEventInserts(workspaceId, onArrivals, onReconcile);

  // Once the arrivals are ranked: ripple only for one that earned a slot.
  useEffect(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    const best = incomingHighlight(items, p.ids);
    if (!best) return;
    setAnnouncement(`New signal: ${best.headline}`);
    setFreshKey(best.key);
    setFreshExtra(p.count - 1);
    remaining.current = DWELL_MS;
    if (reduced) { setActiveKey(best.key); return; }
    const el = host.current, d = dot.current;
    let ox = 26, oy = 30, rmax = 1200;
    if (el && d) {
      const box = el.getBoundingClientRect(), db = d.getBoundingClientRect();
      ox = db.left + db.width / 2 - box.left;
      oy = db.top + db.height / 2 - box.top;
      rmax = Math.hypot(Math.max(ox, box.width - ox), Math.max(oy, box.height - oy)) * 0.92;
    }
    arrivalTimers.current.forEach((t) => window.clearTimeout(t));
    setArrival((a) => ({ nonce: (a?.nonce ?? 0) + 1, key: best.key, ox, oy, rmax }));
    arrivalTimers.current = [
      window.setTimeout(() => setActiveKey(best.key), ARRIVAL_SWAP_MS),
      window.setTimeout(() => setArrival(null), ARRIVAL_TOTAL_MS),
    ];
  }, [items, reduced]);

  // The "New" mark lasts for that item's first showing only.
  useEffect(() => { if (freshKey && item && item.key !== freshKey && !arrival) setFreshKey(null); }, [item, freshKey, arrival]);

  // ── pointer light ──────────────────────────────────────────────────────
  const frame = useRef(0);
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    if (reduced || e.pointerType !== 'mouse') return;
    const el = host.current;
    if (!el) return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const box = el.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width));
      el.style.setProperty('--li-x', `${(x * 100).toFixed(1)}%`);
      el.style.setProperty('--li-shift', `${((x - 0.5) * 18).toFixed(1)}px`);
    });
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // ── actions ────────────────────────────────────────────────────────────
  const open = () => {
    if (!item) return;
    if (item.kind === 'signal') setSelected(item.signal);
    else navigate('/signals');
  };
  const handlers = selected ? {
    onMarkReviewed: () => { void setReview(selected.id, 'reviewed'); },
    onIgnore: () => { void setReview(selected.id, 'ignored'); setSelected(null); },
  } : {};

  // ── render ─────────────────────────────────────────────────────────────
  const state = feed.loading && !items.length ? 'loading'
    : feed.error && !items.length ? 'error'
    : !items.length ? 'empty' : 'live';
  const slide: Presence = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: 0.15 } }, exit: { opacity: 0, transition: { duration: 0.1 } } }
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0, transition: { duration: arrival ? 0.34 : 0.28, ease: EASE_OUT } },
        exit: { opacity: 0, y: -6, transition: { duration: arrival ? 0.14 : 0.18, ease: EASE_IN } },
      };

  return (
    <>
      <section
        ref={host}
        className="li"
        aria-label="Live intelligence"
        data-state={state}
        data-paused={paused || undefined}
        data-arriving={arrival ? 'true' : undefined}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onPointerMove={onPointerMove}
        onFocus={() => setFocused(true)}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}
        style={{ '--li-dwell': `${DWELL_MS}ms` } as CSSProperties}
      >
        <span className="li__sheen" aria-hidden />
        <span className="li__lens" aria-hidden />
        {arrival && !reduced && (
          <span
            key={arrival.nonce}
            className="li__ripple"
            aria-hidden
            style={{ '--ox': `${arrival.ox}px`, '--oy': `${arrival.oy}px`, '--li-rmax': `${arrival.rmax}px` } as CSSProperties}
          >
            <span className="li__ring" />
            <span className="li__spark" />
            <span className="li__band" />
          </span>
        )}

        <div className="li__meta">
          <span className="li__live"><span ref={dot} className="li__dot" />Live intelligence</span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={item?.typeLabel ?? state} className="li__type" {...(reduced ? slide : FADE)}>
              {state === 'live' && item ? (item.kind === 'trend' ? 'Trend developing' : item.typeLabel) : state === 'error' ? 'Unavailable' : 'Watching'}
              {state === 'live' && item?.key === freshKey && <span className="li__new">New</span>}
            </motion.span>
          </AnimatePresence>
        </div>

        <div className="li__body">
          {state === 'loading' && (
            <div className="li__skeleton" aria-label="Loading signals"><span /><span /></div>
          )}
          {state === 'error' && (
            <div className="li__slide">
              <p className="li__headline">Signals couldn’t load right now.</p>
              <p className="li__context">Nothing was lost. Try again in a moment.</p>
            </div>
          )}
          {state === 'empty' && (
            <div className="li__slide">
              <p className="li__headline">Agentory is watching for meaningful changes.</p>
              <p className="li__context">Your strongest signals will appear here as they’re detected.</p>
            </div>
          )}
          {state === 'live' && item && (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={item.key} className="li__slide" {...slide}>
                {/* Narrow screens only: the type and review flag move here from the side columns. */}
                <p className="li__inline-meta" aria-hidden>
                  {item.kind === 'trend' ? 'Trend developing' : item.typeLabel}
                  {unverifiedOnly && <span className="li__flag"> · Needs review</span>}
                </p>
                <p className="li__headline" title={item.headline}>{item.headline}</p>
                <p className="li__context">
                  {contextOf(item, now, { markUnverified: !unverifiedOnly })}
                  {item.key === freshKey && freshExtra > 0 && <span className="li__more"> · +{freshExtra} more new</span>}
                </p>
              </motion.div>
            </AnimatePresence>
          )}
        </div>

        <div className="li__side">
          {state === 'live' && (unverifiedOnly || items.length > 1) && (
            <div className="li__side-top">
              {unverifiedOnly && <span className="li__flag" title="None of these signals has been verified yet">Needs review</span>}
              {items.length > 1 && (
                <button type="button" className="li__count" onClick={() => advance(1)} aria-label={`Signal ${index + 1} of ${items.length}. Show next`}>
                  {pad(index + 1)} / {pad(items.length)}
                </button>
              )}
            </div>
          )}
          {state === 'live' && item && (
            <button type="button" className="li__cta" onClick={open}>
              {item.kind === 'trend' ? 'Explore signals' : 'View signal'} <span aria-hidden>→</span>
            </button>
          )}
          {state === 'error' && <button type="button" className="li__cta" onClick={() => void feed.refresh()}>Retry</button>}
          {state === 'empty' && <button type="button" className="li__cta" onClick={() => navigate('/signals')}>Open Signals <span aria-hidden>→</span></button>}
        </div>

        {state === 'live' && items.length > 1 && item && <span key={item.key} className="li__progress" aria-hidden />}
        <span className="sr-only" aria-live="polite">{announcement}</span>
      </section>

      <SignalDetailDrawer
        signal={selected}
        reviewStatus={selected ? (reviewsBySignal[selected.id]?.status as ReviewStatus | undefined) ?? null : null}
        handlers={handlers}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
