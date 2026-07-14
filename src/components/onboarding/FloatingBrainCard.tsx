// Floating Company Brain presence — replaces the old right-side percentage
// scorecard. A glassmorphic orb with layered emerald glow, two counter-orbiting
// particle rings and a small state label. No big percentage is ever the hero;
// completeness (when shown) is small, secondary text only.
//
// Motion language: a slow two-axis drift (never a loading spinner), a breathing
// glow whose intensity tracks `mode`, and a thin conic sweep only while
// thinking. Purely presentational; `size` lets a scene make it a quiet
// background presence or a centered hero.

import { motion } from 'framer-motion';
import { Brain } from 'lucide-react';
import type { BrainMode } from '@/lib/onboardingScenes';

const OUTER_PARTICLES = [0, 1, 2, 3, 4, 5];
const INNER_PARTICLES = [0, 1, 2];

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
    <div className="flex select-none flex-col items-center gap-2.5">
      <motion.div
        className="relative"
        style={{ width: size, height: size }}
        animate={{ y: [0, -7, 0], x: [0, 3, 0, -3, 0] }}
        transition={{
          y: { duration: 6.5, repeat: Infinity, ease: 'easeInOut' },
          x: { duration: 11, repeat: Infinity, ease: 'easeInOut' },
        }}
      >
        {/* wide soft bloom */}
        <motion.div
          aria-hidden
          className="absolute -inset-4 rounded-full"
          style={{ background: `radial-gradient(circle at 50% 50%, hsl(var(--primary) / ${glow * 0.6}), transparent 70%)`, filter: 'blur(22px)' }}
          animate={{ opacity: activated ? [0.7, 1, 0.7] : [0.45, 0.75, 0.45], scale: [1, 1.06, 1] }}
          transition={{ duration: thinking ? 2.8 : 5.5, repeat: Infinity, ease: 'easeInOut' }}
        />
        {/* tight core glow */}
        <motion.div
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{ background: `radial-gradient(circle at 50% 42%, hsl(var(--primary) / ${glow}), transparent 62%)`, filter: 'blur(12px)' }}
          animate={{ opacity: activated ? [0.6, 1, 0.6] : thinking ? [0.5, 0.9, 0.5] : [0.4, 0.6, 0.4], scale: activated ? [1, 1.1, 1] : [1, 1.03, 1] }}
          transition={{ duration: thinking ? 2.2 : 4.2, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* outer orbit — clockwise */}
        <motion.div
          aria-hidden
          className="absolute inset-0"
          animate={{ rotate: 360 }}
          transition={{ duration: thinking ? 12 : 30, repeat: Infinity, ease: 'linear' }}
        >
          {OUTER_PARTICLES.map((i) => {
            const angle = (i / OUTER_PARTICLES.length) * Math.PI * 2;
            const r = ring - 5;
            const x = size / 2 + Math.cos(angle) * r;
            const y = size / 2 + Math.sin(angle) * r;
            return (
              <motion.span
                key={i}
                className="absolute rounded-full bg-primary"
                style={{ left: x, top: y, width: 2.5, height: 2.5, marginLeft: -1.25, marginTop: -1.25, boxShadow: '0 0 5px hsl(var(--primary) / 0.8)' }}
                animate={{ opacity: [0.25, 0.9, 0.25] }}
                transition={{ duration: 3, repeat: Infinity, delay: i * 0.4, ease: 'easeInOut' }}
              />
            );
          })}
        </motion.div>

        {/* inner orbit — counter-clockwise, quieter */}
        <motion.div
          aria-hidden
          className="absolute inset-0"
          animate={{ rotate: -360 }}
          transition={{ duration: thinking ? 18 : 44, repeat: Infinity, ease: 'linear' }}
        >
          {INNER_PARTICLES.map((i) => {
            const angle = (i / INNER_PARTICLES.length) * Math.PI * 2 + 0.6;
            const r = ring * 0.68;
            const x = size / 2 + Math.cos(angle) * r;
            const y = size / 2 + Math.sin(angle) * r;
            return (
              <motion.span
                key={i}
                className="absolute rounded-full bg-primary/80"
                style={{ left: x, top: y, width: 2, height: 2, marginLeft: -1, marginTop: -1, boxShadow: '0 0 4px hsl(var(--primary) / 0.6)' }}
                animate={{ opacity: [0.15, 0.6, 0.15] }}
                transition={{ duration: 3.6, repeat: Infinity, delay: i * 0.7, ease: 'easeInOut' }}
              />
            );
          })}
        </motion.div>

        {/* thin rotating sweep for the thinking state */}
        {thinking && (
          <motion.div
            aria-hidden
            className="absolute inset-1 rounded-full"
            style={{ background: 'conic-gradient(from 0deg, transparent 0%, hsl(var(--primary) / 0.32) 14%, transparent 30%)' }}
            animate={{ rotate: 360 }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
          />
        )}

        {/* gradient-ringed glass core */}
        <div
          className="absolute inset-[17%] rounded-full p-px"
          style={{ background: 'linear-gradient(155deg, hsl(var(--primary) / 0.55), hsl(var(--primary) / 0.12) 45%, hsl(var(--primary) / 0.35))' }}
        >
          <div
            className="flex h-full w-full items-center justify-center rounded-full bg-background/55 backdrop-blur-xl"
            style={{ boxShadow: `inset 0 1px 0 hsl(var(--foreground) / 0.1), inset 0 -8px 20px hsl(var(--primary) / 0.08), 0 0 30px hsl(var(--primary) / ${glow})` }}
          >
            <motion.div
              animate={thinking ? { scale: [1, 1.1, 1] } : { scale: 1 }}
              transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
              className="text-primary"
              style={{ filter: 'drop-shadow(0 0 6px hsl(var(--primary) / 0.55))' }}
            >
              <Brain style={{ width: size * 0.21, height: size * 0.21 }} />
            </motion.div>
          </div>
        </div>
      </motion.div>

      {/* state label + optional small completeness text */}
      <div className="text-center">
        <div className="flex items-center justify-center gap-1.5">
          <motion.span
            className="h-1 w-1 rounded-full bg-primary"
            animate={{ opacity: thinking ? [0.3, 1, 0.3] : [0.5, 1, 0.5] }}
            transition={{ duration: thinking ? 1 : 2.6, repeat: Infinity, ease: 'easeInOut' }}
            style={{ boxShadow: '0 0 6px hsl(var(--primary) / 0.7)' }}
          />
          <p className="text-[11px] font-medium tracking-[0.02em] text-foreground/85">{label}</p>
        </div>
        {subtext && <p className="mt-0.5 text-[9px] uppercase tracking-[0.2em] text-muted-foreground/60">{subtext}</p>}
      </div>
    </div>
  );
}
