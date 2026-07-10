// Cinematic background for the progressive onboarding: near-black base with a
// deep green radial wash, a faint grid, and a scatter of slowly twinkling
// stars. Pure CSS/SVG + a handful of framer-motion opacity loops — fixed to the
// viewport so it stays calm through scene transitions.

import { useMemo } from 'react';
import { motion } from 'framer-motion';

export function ProgressiveBackground() {
  // Deterministic star scatter (stable across renders, no layout thrash).
  const stars = useMemo(
    () =>
      Array.from({ length: 44 }, (_, i) => {
        const seed = (i * 9301 + 49297) % 233280;
        const r = seed / 233280;
        const r2 = ((seed * 3) % 233280) / 233280;
        return {
          left: `${(r * 100).toFixed(2)}%`,
          top: `${(r2 * 100).toFixed(2)}%`,
          size: r > 0.85 ? 2 : 1,
          delay: (r2 * 5).toFixed(2),
          dur: (2.5 + r * 3).toFixed(2),
        };
      }),
    [],
  );

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#04060a]">
      {/* deep green radial wash from the top */}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(120% 80% at 50% -10%, hsl(var(--primary) / 0.16), transparent 55%)' }}
      />
      <div
        className="absolute left-1/2 top-[38%] h-[720px] w-[720px] -translate-x-1/2 rounded-full blur-3xl"
        style={{ background: 'radial-gradient(closest-side, hsl(var(--primary) / 0.10), transparent 70%)' }}
      />

      {/* faint grid */}
      <svg className="absolute inset-0 h-full w-full opacity-[0.14]">
        <defs>
          <pattern id="prog-grid" width="46" height="46" patternUnits="userSpaceOnUse">
            <path d="M46 0H0V46" fill="none" stroke="hsl(var(--foreground) / 0.18)" strokeWidth="0.5" />
          </pattern>
          <radialGradient id="prog-grid-mask" cx="50%" cy="35%" r="75%">
            <stop offset="0%" stopColor="white" stopOpacity="0.6" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </radialGradient>
          <mask id="prog-grid-m"><rect width="100%" height="100%" fill="url(#prog-grid-mask)" /></mask>
        </defs>
        <rect width="100%" height="100%" fill="url(#prog-grid)" mask="url(#prog-grid-m)" />
      </svg>

      {/* stars */}
      {stars.map((s, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full bg-white"
          style={{ left: s.left, top: s.top, width: s.size, height: s.size }}
          animate={{ opacity: [0.05, 0.5, 0.05] }}
          transition={{ duration: Number(s.dur), repeat: Infinity, delay: Number(s.delay), ease: 'easeInOut' }}
        />
      ))}

      {/* top + bottom vignette for depth */}
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/50 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/60 to-transparent" />
    </div>
  );
}
