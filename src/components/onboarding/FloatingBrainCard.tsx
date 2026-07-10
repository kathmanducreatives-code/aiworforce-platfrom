// Floating Company Brain presence — replaces the old right-side percentage
// scorecard. A glassmorphic orb with a soft green glow, lightly orbiting
// particles, and a small state label. No big percentage is ever the hero;
// completeness (when shown) is small, secondary text only.
//
// Purely presentational. `mode` drives glow intensity + motion; `size` lets a
// scene make it a quiet background presence or a centered hero.

import { motion } from 'framer-motion';
import { Cpu } from 'lucide-react';
import type { BrainMode } from '@/lib/onboardingScenes';

const PARTICLES = [0, 1, 2, 3, 4, 5];

const MODE_GLOW: Record<BrainMode, number> = {
  idle: 0.18, thinking: 0.4, confirmed: 0.3, ready: 0.34, activated: 0.55,
};

export function FloatingBrainCard({
  label, mode, size = 132, subtext,
}: {
  label: string;
  mode: BrainMode;
  size?: number;
  /** Optional small, secondary completeness text (never the hero). */
  subtext?: string;
}) {
  const thinking = mode === 'thinking';
  const activated = mode === 'activated';
  const glow = MODE_GLOW[mode];
  const ring = size * 0.5;

  return (
    <div className="flex flex-col items-center gap-3 select-none">
      <motion.div
        className="relative"
        style={{ width: size, height: size }}
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      >
        {/* soft outer glow */}
        <motion.div
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{ background: `radial-gradient(circle at 50% 50%, hsl(var(--primary) / ${glow}), transparent 68%)`, filter: 'blur(14px)' }}
          animate={{ opacity: activated ? [0.6, 1, 0.6] : thinking ? [0.5, 0.9, 0.5] : [0.4, 0.65, 0.4], scale: activated ? [1, 1.12, 1] : [1, 1.04, 1] }}
          transition={{ duration: thinking ? 2.4 : 4, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* orbiting particles */}
        <motion.div
          aria-hidden
          className="absolute inset-0"
          animate={{ rotate: 360 }}
          transition={{ duration: thinking ? 10 : 26, repeat: Infinity, ease: 'linear' }}
        >
          {PARTICLES.map((i) => {
            const angle = (i / PARTICLES.length) * Math.PI * 2;
            const r = ring - 6;
            const x = size / 2 + Math.cos(angle) * r;
            const y = size / 2 + Math.sin(angle) * r;
            return (
              <motion.span
                key={i}
                className="absolute rounded-full bg-primary"
                style={{ left: x, top: y, width: 3, height: 3, marginLeft: -1.5, marginTop: -1.5, boxShadow: '0 0 6px hsl(var(--primary) / 0.9)' }}
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 2.6, repeat: Infinity, delay: i * 0.3, ease: 'easeInOut' }}
              />
            );
          })}
        </motion.div>

        {/* thin rotating sweep for the thinking state */}
        {thinking && (
          <motion.div
            aria-hidden
            className="absolute inset-1 rounded-full"
            style={{ background: 'conic-gradient(from 0deg, transparent 0%, hsl(var(--primary) / 0.35) 14%, transparent 30%)' }}
            animate={{ rotate: 360 }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
          />
        )}

        {/* glass core */}
        <div
          className="absolute inset-[18%] flex items-center justify-center rounded-full border border-primary/30 bg-background/50 backdrop-blur-xl"
          style={{ boxShadow: `inset 0 1px 0 hsl(var(--foreground) / 0.08), 0 0 30px hsl(var(--primary) / ${glow})` }}
        >
          <motion.div
            animate={thinking ? { scale: [1, 1.12, 1] } : { scale: 1 }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            className="text-primary"
          >
            <Cpu className="h-1/3 w-1/3" style={{ width: size * 0.22, height: size * 0.22 }} />
          </motion.div>
        </div>
      </motion.div>

      {/* state label + optional small completeness text */}
      <div className="text-center">
        <div className="flex items-center justify-center gap-1.5">
          <motion.span
            className="h-1.5 w-1.5 rounded-full bg-primary"
            animate={{ opacity: thinking ? [0.3, 1, 0.3] : [0.6, 1, 0.6] }}
            transition={{ duration: thinking ? 1 : 2.4, repeat: Infinity, ease: 'easeInOut' }}
            style={{ boxShadow: '0 0 8px hsl(var(--primary) / 0.8)' }}
          />
          <p className="text-xs font-medium tracking-tight text-foreground/90">{label}</p>
        </div>
        {subtext && <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">{subtext}</p>}
      </div>
    </div>
  );
}
