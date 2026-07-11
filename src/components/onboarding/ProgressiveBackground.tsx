// Cinematic background for the progressive onboarding: near-black base, deep
// emerald radial washes, a faint masked grid, slow-twinkling stars and a
// breathing aura placed exactly where the hero card sits — so the card floats
// in light rather than on an empty void.
//
// Performance: static CSS layers + a handful of framer-motion opacity loops,
// all fixed to the viewport so nothing repaints through scene transitions.

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
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#03050a]">
      {/* deep green radial wash from the top */}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(120% 80% at 50% -10%, hsl(var(--primary) / 0.15), transparent 55%)' }}
      />

      {/* breathing aura behind the hero card (~55% viewport height) */}
      <motion.div
        className="absolute left-1/2 top-[52%] h-[860px] w-[980px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
        style={{ background: 'radial-gradient(closest-side, hsl(var(--primary) / 0.12), transparent 68%)' }}
        animate={{ opacity: [0.65, 1, 0.65], scale: [1, 1.05, 1] }}
        transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
      />
      {/* slow drifting secondary aura for depth parallax */}
      <motion.div
        className="absolute left-[30%] top-[70%] h-[520px] w-[520px] rounded-full blur-3xl"
        style={{ background: 'radial-gradient(closest-side, hsl(var(--primary) / 0.06), transparent 70%)' }}
        animate={{ x: [0, 60, 0], y: [0, -30, 0], opacity: [0.5, 0.9, 0.5] }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* faint grid, masked toward the center */}
      <svg className="absolute inset-0 h-full w-full opacity-[0.12]">
        <defs>
          <pattern id="prog-grid" width="46" height="46" patternUnits="userSpaceOnUse">
            <path d="M46 0H0V46" fill="none" stroke="hsl(var(--foreground) / 0.18)" strokeWidth="0.5" />
          </pattern>
          <radialGradient id="prog-grid-mask" cx="50%" cy="40%" r="75%">
            <stop offset="0%" stopColor="white" stopOpacity="0.55" />
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
          animate={{ opacity: [0.05, 0.45, 0.05] }}
          transition={{ duration: Number(s.dur), repeat: Infinity, delay: Number(s.delay), ease: 'easeInOut' }}
        />
      ))}

      {/* enclosing vignette — darkens all four edges so the card owns the light */}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(115% 95% at 50% 45%, transparent 55%, rgba(0,0,0,0.55) 100%)' }}
      />
      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/45 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/60 to-transparent" />
    </div>
  );
}
