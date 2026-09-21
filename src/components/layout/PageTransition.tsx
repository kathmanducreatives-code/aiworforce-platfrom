import { useLayoutEffect, useRef, type ReactNode } from 'react';

const ENTER_MS = 220;
const ENTER_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/**
 * A restrained entrance for the working area when the route changes: the new
 * page settles in from 4px below while fading up. The sidebar and command bar
 * sit outside this wrapper, so they never move.
 *
 * WHY ENTER-ONLY. A true exit would keep the old page mounted beside the new
 * one — two heavy pages running queries and effects at once. A 220ms entrance
 * reads as one continuous workspace without that cost.
 *
 * WHY NO REMOUNT. The children are never keyed by route: a page that stays
 * mounted across a param change (/folder/a → /folder/b) keeps its state
 * exactly as before. The animation is played on the existing element with the
 * Web Animations API and leaves no style behind when it ends.
 *
 * WHY THE LIFT IS CONDITIONAL. Any transform on an ancestor becomes the
 * containing block for `position: fixed` descendants, and several pages render
 * fixed drawers and bars inline. If the incoming page has one, it gets the
 * fade alone rather than a composer that jumps 4px and snaps back.
 */
export default function PageTransition({ routeKey, children }: { routeKey: string; children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  // Compared, not flagged: StrictMode's second effect pass sees the same key
  // and stays still, so the first page load never animates.
  const previous = useRef(routeKey);

  useLayoutEffect(() => {
    if (previous.current === routeKey) return;
    previous.current = routeKey;
    const el = host.current;
    if (!el || typeof el.animate !== 'function') return;

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const lift = !reduced && !el.querySelector('.fixed');
    const animation = el.animate(
      reduced
        ? [{ opacity: 0.85 }, { opacity: 1 }]
        : lift
          ? [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }]
          : [{ opacity: 0 }, { opacity: 1 }],
      { duration: reduced ? 80 : ENTER_MS, easing: ENTER_EASE },
    );
    // A fast second navigation replaces this one instead of queueing behind it.
    return () => animation.cancel();
  }, [routeKey]);

  return <div ref={host}>{children}</div>;
}
