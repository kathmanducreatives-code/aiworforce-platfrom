// Compact premium 5-step progress rail for Company Brain onboarding.
// Purely presentational — receives {index, steps} and renders a slim connected
// node strip with an emerald gradient fill up to the active step.
//
// Deliberately quiet: it guides, it never dominates. Small nodes, a 1px rail,
// letter-spaced micro labels and one subtle pulse on the active node only.
// Desktop: labelled nodes. Mobile: compact "Step n of N" + thin bar.

import { Check } from 'lucide-react';
import { motion } from 'framer-motion';

export interface StepChip {
  id: string;
  label: string;
}

export function StepProgress({ index, steps }: { index: number; steps: readonly StepChip[] }) {
  const pct = steps.length > 1 ? (index / (steps.length - 1)) * 100 : 100;

  return (
    <div className="w-full">
      {/* Mobile — compact meter */}
      <div className="sm:hidden">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-xs font-medium tracking-tight text-foreground">{steps[index]?.label}</span>
          <span className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground/80">
            Step {index + 1} of {steps.length}
          </span>
        </div>
        <div className="h-[3px] overflow-hidden rounded-full bg-border/40">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-primary/60 to-primary"
            initial={false}
            animate={{ width: `${((index + 1) / steps.length) * 100}%` }}
            transition={{ type: 'spring', stiffness: 120, damping: 22 }}
            style={{ boxShadow: '0 0 8px hsl(var(--primary) / 0.5)' }}
          />
        </div>
      </div>

      {/* Desktop — slim labelled node rail */}
      <div className="relative hidden sm:block">
        {/* rail track */}
        <div className="absolute left-3 right-3 top-[11px] h-px rounded-full bg-border/40" />
        {/* rail fill */}
        <motion.div
          className="absolute left-3 top-[11px] h-px rounded-full bg-gradient-to-r from-primary/40 via-primary/80 to-primary"
          initial={false}
          animate={{ width: `calc((100% - 1.5rem) * ${pct / 100})` }}
          transition={{ type: 'spring', stiffness: 110, damping: 24 }}
          style={{ boxShadow: '0 0 10px hsl(var(--primary) / 0.45)' }}
        />

        <ol className="relative flex items-start justify-between">
          {steps.map((s, i) => {
            const done = i < index;
            const active = i === index;
            return (
              <li key={s.id} className="flex flex-col items-center gap-1.5">
                <motion.div
                  initial={false}
                  animate={{ scale: active ? 1.06 : 1 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  className={[
                    'relative z-10 flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-semibold tabular-nums transition-colors duration-300',
                    done
                      ? 'border-primary/50 bg-primary text-primary-foreground shadow-[0_0_10px_hsl(var(--primary)/0.35)]'
                      : active
                        ? 'border-primary/80 bg-background text-primary shadow-[0_0_14px_hsl(var(--primary)/0.3)]'
                        : 'border-border/50 bg-background/80 text-muted-foreground/70',
                  ].join(' ')}
                >
                  {done ? (
                    <motion.span
                      initial={{ scale: 0.4, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 18 }}
                    >
                      <Check className="h-3 w-3" />
                    </motion.span>
                  ) : (
                    i + 1
                  )}
                  {active && (
                    <motion.span
                      className="absolute inset-0 rounded-full border border-primary/50"
                      animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
                      transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  )}
                </motion.div>
                <span
                  className={[
                    'text-[9px] uppercase tracking-[0.2em] transition-colors duration-300',
                    active ? 'font-semibold text-foreground/90' : done ? 'text-foreground/60' : 'text-muted-foreground/50',
                  ].join(' ')}
                >
                  {s.label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
