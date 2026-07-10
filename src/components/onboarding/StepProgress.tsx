// Premium 5-step progress rail for Company Brain onboarding.
// Purely presentational — receives {index, steps} and renders the connected
// node strip with an emerald gradient fill up to the active step.
// Desktop: labelled glowing nodes. Mobile: compact "Step n of N" + thin bar.

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
          <span className="text-xs font-medium text-foreground">{steps[index]?.label}</span>
          <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Step {index + 1} of {steps.length}
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-border/50">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-primary/70 to-primary"
            initial={false}
            animate={{ width: `${((index + 1) / steps.length) * 100}%` }}
            transition={{ type: 'spring', stiffness: 120, damping: 22 }}
            style={{ boxShadow: '0 0 10px hsl(var(--primary) / 0.6)' }}
          />
        </div>
      </div>

      {/* Desktop — labelled node rail */}
      <div className="relative hidden sm:block">
        {/* rail track */}
        <div className="absolute left-5 right-5 top-[17px] h-[2px] rounded-full bg-border/50" />
        {/* rail fill */}
        <motion.div
          className="absolute left-5 top-[17px] h-[2px] rounded-full bg-gradient-to-r from-primary/50 via-primary to-primary"
          initial={false}
          animate={{ width: `calc((100% - 2.5rem) * ${pct / 100})` }}
          transition={{ type: 'spring', stiffness: 110, damping: 24 }}
          style={{ boxShadow: '0 0 14px hsl(var(--primary) / 0.55)' }}
        />

        <ol className="relative flex items-start justify-between">
          {steps.map((s, i) => {
            const done = i < index;
            const active = i === index;
            return (
              <li key={s.id} className="flex flex-col items-center gap-2">
                <motion.div
                  initial={false}
                  animate={{ scale: active ? 1.08 : 1 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  className={[
                    'relative z-10 flex h-9 w-9 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums transition-colors duration-300',
                    done
                      ? 'border-primary/60 bg-primary text-primary-foreground shadow-[0_0_18px_hsl(var(--primary)/0.5)]'
                      : active
                        ? 'border-primary bg-background text-primary shadow-[0_0_24px_hsl(var(--primary)/0.4)]'
                        : 'border-border/60 bg-background text-muted-foreground',
                  ].join(' ')}
                >
                  {done ? (
                    <motion.span
                      initial={{ scale: 0.4, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 18 }}
                    >
                      <Check className="h-4 w-4" />
                    </motion.span>
                  ) : (
                    i + 1
                  )}
                  {active && (
                    <motion.span
                      className="absolute inset-0 rounded-full border border-primary/60"
                      animate={{ scale: [1, 1.45, 1], opacity: [0.6, 0, 0.6] }}
                      transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  )}
                </motion.div>
                <span
                  className={[
                    'text-[11px] uppercase tracking-[0.14em] transition-colors duration-300',
                    active ? 'font-semibold text-foreground' : done ? 'text-foreground/70' : 'text-muted-foreground/70',
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
