import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { lookupPublicAgent } from '@/config/agentRegistry';
import { cn } from '@/lib/utils';
import './agent-portrait.css';

interface AgentPortraitProps {
  agentId?: string | null;
  name?: string;
  src?: string | null;
  size?: number;
  shape?: 'circle' | 'squircle';
  className?: string;
  ring?: boolean;
  /** Decorative portraits inside already-labelled controls avoid duplicate announcements. */
  decorative?: boolean;
  interactive?: boolean;
  active?: boolean;
}

/** Shared visual only: does not change agent selection, execution, or status. */
export default function AgentPortrait({ agentId, name, src, size, shape = 'circle', className, ring = true, decorative = false, interactive = true, active = false }: AgentPortraitProps) {
  const profile = lookupPublicAgent(agentId ?? name ?? '');
  const image = profile?.avatar ?? src;
  const label = name ?? profile?.name ?? 'Agent';
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const host = useRef<HTMLSpanElement>(null);
  const frame = useRef<number | null>(null);
  const bounds = useRef<DOMRect | null>(null);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  function reset() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    bounds.current = null;
    const el = host.current;
    if (!el) return;
    ['--portrait-rx', '--portrait-ry', '--portrait-x', '--portrait-y'].forEach(key => el.style.removeProperty(key));
    el.removeAttribute('data-tracking');
  }
  function move(event: PointerEvent<HTMLSpanElement>) {
    if (!interactive || event.pointerType !== 'mouse' || !window.matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)').matches) return;
    const el = host.current;
    if (!el) return;
    const box = bounds.current ?? (bounds.current = el.getBoundingClientRect());
    const x = Math.max(-1, Math.min(1, ((event.clientX - box.left) / box.width - .5) * 2));
    const y = Math.max(-1, Math.min(1, ((event.clientY - box.top) / box.height - .5) * 2));
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      el.style.setProperty('--portrait-rx', `${-y * 4}deg`);
      el.style.setProperty('--portrait-ry', `${x * 4}deg`);
      el.style.setProperty('--portrait-x', `${50 + x * 24}%`);
      el.style.setProperty('--portrait-y', `${38 + y * 24}%`);
      el.setAttribute('data-tracking', 'true');
    });
  }
  return <span ref={host} className={cn('ag-portrait', shape === 'squircle' && 'ag-portrait--squircle', ring && 'ag-portrait--ring', interactive && 'ag-portrait--interactive', className)} style={size ? { width: size, height: size } as CSSProperties : undefined} data-active={active || undefined} onPointerMove={move} onPointerLeave={reset} onPointerCancel={reset} aria-hidden={decorative || undefined} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : label}>
    <span className="ag-portrait__lens">
      {image && failedSrc !== image ? <img src={image} alt="" draggable={false} decoding="async" loading="lazy" onError={() => setFailedSrc(image)} className="ag-portrait__image" /> : <span className="ag-portrait__initial">{label.charAt(0).toUpperCase()}</span>}
      <span className="ag-portrait__shade" />
      <span className="ag-portrait__light" />
    </span>
  </span>;
}
