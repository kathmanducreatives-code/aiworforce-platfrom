import { motion, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';

export interface StepChip { id: string; label: string; }

export function StepProgress({ index, steps, progress }: { index: number; steps: readonly StepChip[]; progress?: number }) {
  const reducedMotion = useReducedMotion();
  const percentage = Math.round(Math.max(0, Math.min(100, progress ?? (index / Math.max(1, steps.length)) * 100)));
  return (
    <nav aria-label="Setup progress" className="w-full">
      <div className="mb-3 flex items-center justify-between text-xs">
        <span className="font-medium text-foreground">{steps[index]?.label}</span>
        <span className="text-muted-foreground">Step {index + 1} of {steps.length} <span className="mx-2 text-foreground/20">/</span> <span className="tabular-nums text-primary">{percentage}%</span></span>
      </div>
      <div role="progressbar" aria-label="Onboarding progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage}
        aria-valuetext={`${percentage}% through setup, ${steps[index]?.label}`} className="mb-4 h-1.5 overflow-hidden rounded-full bg-primary/10 ring-1 ring-inset ring-primary/10">
        <motion.div initial={false} animate={{ scaleX: percentage / 100 }}
          transition={{ duration: reducedMotion ? 0 : 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="h-full w-full origin-left rounded-full bg-gradient-to-r from-primary/70 to-primary"
          style={{ boxShadow: '0 0 12px hsl(var(--primary) / 0.4)' }} />
      </div>
      <ol className="grid grid-flow-col auto-cols-fr gap-2 sm:gap-5">
        {steps.map((step, i) => (
          <li key={step.id} aria-current={i === index ? 'step' : undefined}>
            <div className={`hidden items-center gap-2 text-xs sm:flex ${i === index ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/5 text-[10px] tabular-nums ${i <= index ? 'text-primary' : ''}`}>
                {i < index ? <Check className="h-3.5 w-3.5" /> : String(i + 1).padStart(2, '0')}
              </span>
              {step.label}
            </div>
          </li>
        ))}
      </ol>
    </nav>
  );
}
