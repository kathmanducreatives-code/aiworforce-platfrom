import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import './agent-depth-card.css';

/** Pointer work stays outside React; only the active card schedules frames. */
export function AgentDepthCard({ accent, children, className, label }: { accent: string; children: ReactNode; className: string; label?: string }) {
  const host = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = host.current!;
    const fine = matchMedia('(hover: hover) and (pointer: fine)');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let x = 0, y = 0, targetX = 0, targetY = 0;
    let previousTime = 0;
    let bounds: DOMRect | null = null;
    function tick(time: number) {
      const delta = previousTime ? Math.min(time - previousTime, 40) : 16;
      previousTime = time;
      const ease = 1 - Math.exp(-delta / 65);
      x += (targetX - x) * ease;
      y += (targetY - y) * ease;
      el.style.setProperty('--depth-rx', `${-y * 2}deg`);
      el.style.setProperty('--depth-ry', `${x * 3}deg`);
      el.style.setProperty('--depth-px', `${x * 6}px`);
      el.style.setProperty('--depth-py', `${y * 4}px`);
      el.style.setProperty('--depth-mx', `${50 + x * 50}%`);
      el.style.setProperty('--depth-my', `${50 + y * 50}%`);
      if (Math.abs(targetX - x) + Math.abs(targetY - y) > .001) frame = requestAnimationFrame(tick);
      else { frame = 0; previousTime = 0; }
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(tick); }
    function move(e: PointerEvent) {
      if (e.pointerType !== 'mouse' || !fine.matches || reduced.matches) return;
      bounds ??= el.getBoundingClientRect();
      targetX = Math.max(-1, Math.min(1, (e.clientX - bounds.left) / bounds.width * 2 - 1));
      targetY = Math.max(-1, Math.min(1, (e.clientY - bounds.top) / bounds.height * 2 - 1));
      el.dataset.depthActive = 'true';
      schedule();
    }
    function reset() {
      bounds = null;
      targetX = targetY = 0;
      delete el.dataset.depthActive;
      schedule();
    }
    function preferenceChanged() {
      reset();
      if (reduced.matches || !fine.matches) {
        cancelAnimationFrame(frame); frame = 0; previousTime = 0; x = y = 0;
        ['rx', 'ry', 'px', 'py', 'mx', 'my'].forEach(key => el.style.removeProperty(`--depth-${key}`));
      }
    }
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', reset);
    el.addEventListener('pointercancel', reset);
    window.addEventListener('scroll', reset, true);
    window.addEventListener('resize', reset);
    window.addEventListener('blur', reset);
    fine.addEventListener('change', preferenceChanged);
    reduced.addEventListener('change', preferenceChanged);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', reset);
      el.removeEventListener('pointercancel', reset);
      window.removeEventListener('scroll', reset, true);
      window.removeEventListener('resize', reset);
      window.removeEventListener('blur', reset);
      fine.removeEventListener('change', preferenceChanged);
      reduced.removeEventListener('change', preferenceChanged);
    };
  }, []);
  return <article ref={host} aria-label={label} className={`agent-depth-card ${className}`} style={{ '--depth-accent': accent } as CSSProperties}>
    <span className="agent-depth-light" aria-hidden="true" />
    {children}
  </article>;
}
