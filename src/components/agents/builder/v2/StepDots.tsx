import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';

const LABELS = ['Identity', 'Department', 'Role', 'Model', 'Capabilities', 'Tools', 'Skills'];

interface Props {
  current: number;          // 1..7
  completed: boolean[];     // length 7
  onJump: (step: number) => void;
  badges?: Partial<Record<number, string>>; // optional small label per step (e.g. "3 equipped")
}

export default function StepDots({ current, completed, onJump, badges }: Props) {
  return (
    <div className="w-full">
      <div className="flex items-center justify-between gap-1">
        {LABELS.map((label, i) => {
          const step = i + 1;
          const isDone = completed[i];
          const isCurrent = step === current;
          const canJump = isDone || step <= current;
          return (
            <button
              key={label}
              onClick={() => canJump && onJump(step)}
              className="group flex-1 flex flex-col items-center gap-1.5 min-w-0"
              disabled={!canJump}
            >
              <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground/70 truncate w-full text-center">
                {label}
                {badges?.[step] && (
                  <span className="ml-1 text-emerald-400 normal-case font-semibold">{badges[step]}</span>
                )}
              </span>
              <div className="relative h-2.5 w-full">
                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-border/60" />
                <motion.div
                  className={cn(
                    'absolute left-1/2 -translate-x-1/2 -translate-y-1/2 top-1/2 rounded-full flex items-center justify-center',
                    isDone
                      ? 'bg-emerald-500 text-background w-4 h-4 shadow-[0_0_12px_rgba(16,185,129,0.6)]'
                      : isCurrent
                      ? 'bg-emerald-500/30 ring-2 ring-emerald-400 w-4 h-4'
                      : 'bg-card border border-border w-3 h-3',
                  )}
                  animate={isCurrent ? { scale: [1, 1.18, 1] } : { scale: 1 }}
                  transition={{ duration: 1.6, repeat: isCurrent ? Infinity : 0, ease: 'easeInOut' }}
                >
                  {isDone && <Check className="w-2.5 h-2.5" strokeWidth={3} />}
                </motion.div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
