// Quiet compact Company Brain orb for the saved-page hero.
//
// A smaller, calmer sibling of the onboarding FloatingBrainCard: ~60px, slow
// two-axis drift, a breathing emerald glow, one faint orbit ring with a node.
// Uses the custom BrainCoreGlyph — not a stock icon. No percentage is ever
// shown; the orb signals "active" presence, not a score.
//
// Honors prefers-reduced-motion: motion falls back to a static glow.

import { motion, useReducedMotion } from 'framer-motion';
import { BrainCoreGlyph } from '@/components/company-brain/BrainCoreGlyph';

export function BrainOrb({ size = 60 }: { size?: number }) {
  const reduce = useReducedMotion();
  const drift = reduce ? undefined : { y: [0, -5, 0], x: [0, 2, 0, -2, 0] };
  const driftTransition = reduce
    ? undefined
    : {
        y: { duration: 6.5, repeat: Infinity, ease: 'easeInOut' as const },
        x: { duration: 11, repeat: Infinity, ease: 'easeInOut' as const },
      };
  const glow = reduce ? undefined : { opacity: [0.45, 0.8, 0.45], scale: [1, 1.06, 1] };

  return (
    <motion.div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      animate={drift}
      transition={driftTransition}
    >
      {/* deep emerald bloom */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -inset-4 rounded-full"
        style={{
          background: 'radial-gradient(circle at 50% 45%, hsl(var(--primary) / 0.28), transparent 68%)',
          filter: 'blur(18px)',
        }}
        animate={glow}
        transition={reduce ? undefined : { duration: 5.5, repeat: Infinity, ease: 'easeInOut' }}
      />
      {/* faint outer orbit ring with travelling node */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full border border-primary/12"
        animate={reduce ? undefined : { rotate: 360 }}
        transition={reduce ? undefined : { duration: 42, repeat: Infinity, ease: 'linear' }}
      >
        <span
          className="absolute left-1/2 top-0 h-1 w-1 -translate-x-1/2 rounded-full bg-primary/60"
          style={{ boxShadow: '0 0 6px hsl(var(--primary) / 0.6)' }}
        />
      </motion.div>
      {/* inner concentric ring */}
      <div aria-hidden className="absolute inset-[8%] rounded-full border border-primary/8" />

      {/* gradient-ringed glass core */}
      <div
        className="absolute inset-[14%] rounded-full p-px"
        style={{ background: 'linear-gradient(155deg, hsl(var(--primary) / 0.50), hsl(var(--primary) / 0.08) 45%, hsl(var(--primary) / 0.28))' }}
      >
        <div
          className="flex h-full w-full items-center justify-center rounded-full bg-background/50 backdrop-blur-xl"
          style={{
            boxShadow: 'inset 0 1px 0 hsl(var(--foreground) / 0.10), inset 0 -6px 18px hsl(var(--primary) / 0.10), 0 0 24px hsl(var(--primary) / 0.28)',
          }}
        >
          <BrainCoreGlyph
            className="text-primary"
            style={{ width: size * 0.30, height: size * 0.30, filter: 'drop-shadow(0 0 5px hsl(var(--primary) / 0.5))' }}
          />
        </div>
      </div>
    </motion.div>
  );
}
