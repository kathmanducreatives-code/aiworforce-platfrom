import { useEffect, useState } from 'react';

/**
 * Resolve a CSS selector to its viewport DOMRect, re-measuring on
 * resize, scroll, DOM mutations, and a short rAF poll after activation
 * so route transitions don't leave the spotlight stuck on a stale rect.
 */
export function useAnchorRect(
  primarySelector: string | null | undefined,
  fallbackSelector?: string | null,
): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!primarySelector && !fallbackSelector) {
      setRect(null);
      return;
    }
    let stopped = false;

    const measure = () => {
      const el =
        (primarySelector ? document.querySelector<HTMLElement>(primarySelector) : null) ||
        (fallbackSelector ? document.querySelector<HTMLElement>(fallbackSelector) : null);
      if (!el) {
        setRect((prev) => (prev === null ? prev : null));
        return;
      }
      const next = el.getBoundingClientRect();
      setRect((prev) => {
        if (
          prev &&
          Math.abs(prev.x - next.x) < 0.5 &&
          Math.abs(prev.y - next.y) < 0.5 &&
          Math.abs(prev.width - next.width) < 0.5 &&
          Math.abs(prev.height - next.height) < 0.5
        ) {
          return prev;
        }
        return next;
      });
    };

    measure();

    // Poll for up to ~1.2s to catch route-transition layout shifts.
    let frames = 0;
    const tick = () => {
      if (stopped) return;
      measure();
      frames += 1;
      if (frames < 72) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    const obs = new MutationObserver(measure);
    obs.observe(document.body, { childList: true, subtree: true, attributes: true });

    return () => {
      stopped = true;
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      obs.disconnect();
    };
  }, [primarySelector, fallbackSelector]);

  return rect;
}
