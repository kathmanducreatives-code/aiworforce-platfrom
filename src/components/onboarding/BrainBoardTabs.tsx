// Segmented "Brain Board" control for the Review step.
// One section visible at a time — Targeting / Signals / Messaging / Safety —
// with an animated glass indicator and per-tab attention dots.

import type { ReactNode } from 'react';
import { motion } from 'framer-motion';

export interface BrainBoardTab {
  id: string;
  label: string;
  icon: ReactNode;
  /** Number of items in this section still needing attention. */
  attention?: number;
}

export function BrainBoardTabs({
  tabs, active, onChange,
}: {
  tabs: BrainBoardTab[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Brain Board sections"
      className="relative flex w-full gap-1 rounded-2xl border border-border/50 bg-card/40 p-1 backdrop-blur-xl"
    >
      {tabs.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => onChange(t.id)}
            className={[
              'relative flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-medium transition-colors sm:gap-2 sm:px-3',
              isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground/80',
            ].join(' ')}
          >
            {isActive && (
              <motion.span
                layoutId="brain-board-tab"
                className="absolute inset-0 rounded-xl border border-primary/30 bg-primary/[0.08] shadow-[0_0_18px_hsl(var(--primary)/0.18)]"
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              />
            )}
            <span className={`relative shrink-0 ${isActive ? 'text-primary' : ''}`}>{t.icon}</span>
            <span className="relative hidden truncate sm:inline">{t.label}</span>
            {(t.attention ?? 0) > 0 && (
              <span
                className="relative flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-amber-500/15 px-1 text-[9px] font-semibold tabular-nums text-amber-300"
                aria-label={`${t.attention} items need attention`}
              >
                {t.attention}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
