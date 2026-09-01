/**
 * EMPLOYEE PRESENCE — three sizes of the same character, used across the page.
 *
 * WHY NOT REAL 3D. A WebGL portrait would mean three.js (~150 kB gzip before a
 * single model), a canvas per employee, and source assets we do not have — the
 * portraits are 2D images, so there is nothing to render in 3D. On a marketing
 * page whose whole job is to load fast and convert, that is a bad trade.
 *
 * WHAT THIS DOES INSTEAD. A layered pseudo-3D treatment built entirely from CSS
 * transforms, so it is GPU-composited and costs no bytes:
 *
 *   - the card tilts toward the pointer (`perspective` + `preserve-3d`)
 *   - four layers sit at different Z depths, so they parallax against each
 *     other as it tilts: accent glow behind, portrait, rim light, status dot
 *   - a specular sheen tracks the pointer across the surface
 *   - the drop shadow shifts opposite the tilt, so the light stays fixed
 *
 * COST CONTROL. Pointer maths is rAF-throttled and written straight to CSS
 * custom properties, so a tilt never triggers React state or a re-render.
 * `will-change` is applied only while a card is active — leaving it on would
 * permanently promote every portrait to its own compositor layer.
 *
 * IT TURNS ITSELF OFF for `prefers-reduced-motion`, and for coarse pointers
 * (touch), where a tilt-on-hover is meaningless and would only cost work.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import './employee-portrait.css';
import type { Employee } from './employees';

function useTiltEnabled() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setEnabled(fine.matches && !calm.matches);
    sync();
    fine.addEventListener('change', sync);
    calm.addEventListener('change', sync);
    return () => {
      fine.removeEventListener('change', sync);
      calm.removeEventListener('change', sync);
    };
  }, []);
  return enabled;
}

/**
 * Shown whenever a portrait asset is missing or fails to load — today that is
 * Lyra, whose registry asset is a remote URL that resolves to index.html.
 *
 * `fontSize` is an explicit length, never a percentage: a percentage font-size
 * resolves against the *inherited* font size, not the circle, which rendered
 * the initial at a few pixels regardless of how large the portrait was.
 */
function Monogram({
  employee,
  fontSize,
  className,
}: {
  employee: Employee;
  fontSize: string;
  className?: string;
}) {
  return (
    <div
      className={cn('w-full h-full flex items-center justify-center select-none', className)}
      style={{
        background: `radial-gradient(120% 120% at 50% 20%, ${employee.accent}30 0%, rgba(10,10,10,0.92) 72%)`,
      }}
      aria-hidden="true"
    >
      <span
        className="font-display font-black tracking-tight leading-none"
        style={{ color: employee.accent, fontSize, opacity: 0.9 }}
      >
        {employee.initial}
      </span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── 3D PORTRAIT ── */

interface PortraitProps {
  employee: Employee;
  /** Rendered diameter. The roster uses the default. */
  className?: string;
  /** Show the "active" status dot. */
  status?: boolean;
  priority?: boolean;
}

export function EmployeePortrait3D({
  employee,
  className,
  status = true,
  priority = false,
}: PortraitProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const frame = useRef<number>();
  const [failed, setFailed] = useState(false);
  const tilt = useTiltEnabled();

  const onMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!tilt) return;
      const el = wrapRef.current;
      if (!el) return;
      const { left, top, width, height } = el.getBoundingClientRect();
      // -0.5 … 0.5, measured from the centre of the card.
      const px = (e.clientX - left) / width - 0.5;
      const py = (e.clientY - top) / height - 0.5;
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        // Deliberately shallow. Past ~10deg the portrait reads as a gimmick
        // rather than a material.
        el.style.setProperty('--rx', `${(-py * 9).toFixed(2)}deg`);
        el.style.setProperty('--ry', `${(px * 11).toFixed(2)}deg`);
        el.style.setProperty('--mx', `${((px + 0.5) * 100).toFixed(1)}%`);
        el.style.setProperty('--my', `${((py + 0.5) * 100).toFixed(1)}%`);
        el.style.setProperty('--sx', `${(-px * 14).toFixed(1)}px`);
        el.style.setProperty('--sy', `${(-py * 14).toFixed(1)}px`);
      });
    },
    [tilt],
  );

  const reset = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (frame.current) cancelAnimationFrame(frame.current);
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
    el.style.setProperty('--mx', '50%');
    el.style.setProperty('--my', '35%');
    el.style.setProperty('--sx', '0px');
    el.style.setProperty('--sy', '0px');
    el.style.removeProperty('will-change');
  }, []);

  const arm = useCallback(() => {
    if (!tilt) return;
    wrapRef.current?.style.setProperty('will-change', 'transform');
  }, [tilt]);

  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);

  const showImage = employee.portrait && !failed;

  return (
    <div
      ref={wrapRef}
      onPointerEnter={arm}
      onPointerMove={onMove}
      onPointerLeave={reset}
      className={cn('emp3d relative w-32 h-32 md:w-40 md:h-40', className)}
      style={
        {
          '--accent': employee.accent,
          '--rx': '0deg',
          '--ry': '0deg',
          '--mx': '50%',
          '--my': '35%',
          '--sx': '0px',
          '--sy': '0px',
        } as React.CSSProperties
      }
    >
      {/* Depth 1 — accent bloom, furthest back, parallaxes most. */}
      <div className="emp3d__glow" aria-hidden="true" />

      {/* Depth 2 — the portrait itself. */}
      <div className="emp3d__disc">
        {showImage ? (
          <img
            src={employee.portrait as string}
            alt={`${employee.name} — ${employee.function}`}
            width={320}
            height={320}
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            onError={() => setFailed(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <Monogram employee={employee} fontSize="clamp(2.6rem, 5vw, 3.4rem)" />
        )}
        {/* Depth 3 — specular sheen, sits on the glass above the portrait. */}
        <div className="emp3d__sheen" aria-hidden="true" />
        <div className="emp3d__rim" aria-hidden="true" />
      </div>

      {/* Depth 4 — status, closest to the viewer. */}
      {status && <span className="emp3d__status" aria-hidden="true" />}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── AVATAR ── */

/** Small circular portrait. No tilt — these appear many times per screen. */
export function EmployeeAvatar({
  employee,
  size = 28,
  className,
  ring = true,
}: {
  employee: Employee;
  size?: number;
  className?: string;
  ring?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = employee.portrait && !failed;
  return (
    <span
      className={cn('relative inline-block shrink-0 rounded-full overflow-hidden', className)}
      style={{
        width: size,
        height: size,
        boxShadow: ring ? `0 0 0 1px ${employee.accent}59, 0 2px 8px rgba(0,0,0,0.5)` : undefined,
      }}
    >
      {showImage ? (
        <img
          src={employee.portrait as string}
          alt=""
          width={size * 2}
          height={size * 2}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <Monogram employee={employee} fontSize={`${Math.round(size * 0.44)}px`} />
      )}
    </span>
  );
}

/* ───────────────────────────────────────────────────────────────────── CHIP ── */

/**
 * The recurring in-context marker: "this employee does this part".
 * Used inside product sections so the cast shows up where the work happens.
 */
export function EmployeeChip({
  employee,
  label,
  size = 22,
  className,
}: {
  employee: Employee;
  /** Defaults to the employee's function. */
  label?: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-[11px] font-medium whitespace-nowrap',
        className,
      )}
      style={{
        borderColor: `${employee.accent}33`,
        background: `${employee.accent}0f`,
        color: 'rgba(255,255,255,0.72)',
      }}
    >
      <EmployeeAvatar employee={employee} size={size} ring={false} />
      <span className="font-semibold" style={{ color: employee.accent }}>
        {employee.name}
      </span>
      <span className="text-white/40">{label ?? employee.function}</span>
    </span>
  );
}
