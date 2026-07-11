// Quiet compact Company Brain orb for the saved-page hero.
//
// A smaller, calmer sibling of the onboarding FloatingBrainCard: ~68px, slow
// two-axis drift, a breathing emerald glow, one faint orbit ring. No percentage
// is ever shown — the orb signals "active" presence, not a score.
//
// Honors prefers-reduced-motion: motion falls back to a static glow.

import { motion, useReducedMotion } from 'framer-motion';
import { Brain } from 'lucide-react';

export function BrainOrb({ size = 68 }: { size?: number }) {
  const reduce = useReducedMotion();
  const drift = reduce
    ? undefined
    : {
        y: [0, -5, 0],
        x: [0, 2, 0, -2, 0],
      };
  const driftTransition = reduce
    ? undefined
    : {
        y: { duration: 6.5, repeat: Infinity, ease: 'easeInOut' as const },
        x: { duration: 11, repeat: Infinity, ease: 'easeInOut' as const },
      };
  const glow = reduce
    ? undefined
    : { opacity: [0.5, 0.85, 0.5], scale: [1, 1.05, 1] };

  return (
    <motion.div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      animate={drift}
      transition={driftTransition}
    >
      {/* soft bloom */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -inset-3 rounded-full"
        style={{
          background: 'radial-gradient(circle at 50% 50%, hsl(var(--primary) / 0.30), transparent 70%)',
          filter: 'blur(16px)',
        }}
        animate={glow}
        transition={reduce ? undefined : { duration: 5.5, repeat: Infinity, ease: 'easeInOut' }}
      />
      {/* faint orbit ring */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full border border-primary/15"
        animate={reduce ? undefined : { rotate: 360 }}
        transition={reduce ? undefined : { duration: 38, repeat: Infinity, ease: 'linear' }}
      >
        <span
          className="absolute left-1/2 top-0 h-1 w-1 -translate-x-1/2 rounded-full bg-primary/70"
          style={{ boxShadow: '0 0 5px hsl(var(--primary) / 0.7)' }}
        />
      </motion.div>

      {/* gradient-ringed glass core */}
      <div
        className="absolute inset-[14%] rounded-full p-px"
        style={{ background: 'linear-gradient(155deg, hsl(var(--primary) / 0.55), hsl(var(--primary) / 0.10) 45%, hsl(var(--primary) / 0.30))' }}
      >
        <div
          className="flex h-full w-full items-center justify-center rounded-full bg-background/55 backdrop-blur-xl"
          style={{ boxShadow: 'inset 0 1px 0 hsl(var(--foreground) / 0.10), inset 0 -6px 16px hsl(var(--primary) / 0.08), 0 0 22px hsl(var(--primary) / 0.30)' }}
        >
          <Brain
            className="text-primary"
            style={{ width: size * 0.26, height: size * 0.26, filter: 'drop-shadow(0 0 5px hsl(var(--primary) / 0.55))' }}
          />
        </div>
      </div>
    </motion.div>
  );
}
