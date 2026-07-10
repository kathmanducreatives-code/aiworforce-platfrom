// Premium 5-step progress rail for Company Brain onboarding.
// Purely presentational — receives {index, steps} and renders the connected
// chip strip with an emerald gradient fill up to the active step.

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
      <div className="relative">
        {/* rail track */}
        <div className="absolute left-4 right-4 top-1/2 h-px -translate-y-1/2 bg-border/60" />
        {/* rail fill */}
        <motion.div
          className="absolute left-4 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-primary/60 via-primary to-primary/60"
          initial={false}
          animate={{ width: `calc((100% - 2rem) * ${pct / 100})` }}
          transition={{ type: 'spring', stiffness: 120, damping: 22 }}
          style={{ boxShadow: '0 0 12px hsl(var(--primary) / 0.5)' }}
        />

        <ol className="relative flex items-center justify-between">
          {steps.map((s, i) => {
            const done = i < index;
            const active = i === index;
            return (
              <li key={s.id} className="flex flex-col items-center gap-2">
                <div
                  className={[
                    'relative z-10 flex h-8 w-8 items-center justify-center rounded-full border text-[11px] font-medium tabular-nums transition-all',
                    done
                      ? 'border-primary/60 bg-primary text-primary-foreground shadow-[0_0_16px_hsl(var(--primary)/0.5)]'
                      : active
                        ? 'border-primary bg-background text-primary shadow-[0_0_20px_hsl(var(--primary)/0.35)]'
                        : 'border-border/60 bg-background text-muted-foreground',
                  ].join(' ')}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                  {active && (
                    <motion.span
                      className="absolute inset-0 rounded-full border border-primary/60"
                      animate={{ scale: [1, 1.4, 1], opacity: [0.6, 0, 0.6] }}
                      transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  )}
                </div>
                <span
                  className={[
                    'hidden text-[11px] uppercase tracking-[0.14em] transition-colors sm:block',
                    active ? 'text-foreground' : done ? 'text-foreground/70' : 'text-muted-foreground',
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
