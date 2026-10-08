// ONE HEADER FOR EVERY DEPARTMENT PAGE (Signals, Leads, Content).
//
//   eyebrow   "Growth · Signals" — sidebar group · page, tracked, faint emerald
//   title     24px semibold
//   subtitle  13.5px muted, one measure wide
//   aside     the agent's status (AgentStatus), when the page shows it here
//   actions   top actions, built with DEPT_ACTION / DEPT_ICON_ACTION
//
// Spacing below the header is the caller's: it sits in different containers.

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** A top action's box. Add PRIMARY_ACTION / SECONDARY_ACTION / GHOST_ACTION for its weight. */
export const DEPT_ACTION = 'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] transition-all duration-200';
/** An icon-only top action (export, import). */
export const DEPT_ICON_ACTION = 'inline-flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200';

interface Props {
  eyebrow: string;
  title: string;
  description: string;
  aside?: ReactNode;
  actions?: ReactNode;
  /** One line, truncated — for a header that is also a toolbar (Content). */
  compact?: boolean;
  className?: string;
}

export default function DepartmentHeader({ eyebrow, title, description, aside, actions, compact = false, className }: Props) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-4', compact && 'flex-nowrap items-center', className)}>
      <div className="min-w-0 flex-1 basis-[280px]">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-emerald-300/60">{eyebrow}</p>
        <h1 className="mt-1 text-[24px] font-semibold leading-tight tracking-[-0.015em] text-foreground">{title}</h1>
        <p className={cn('mt-1 max-w-[62ch] text-[13.5px] leading-relaxed text-muted-foreground/80', compact && 'truncate')}>{description}</p>
      </div>
      {(aside || actions) && (
        <div className={cn('flex shrink-0 flex-col items-end gap-2', compact && 'flex-row items-center gap-3')}>
          {aside}
          {actions && <div className="flex items-center gap-1.5">{actions}</div>}
        </div>
      )}
    </header>
  );
}
