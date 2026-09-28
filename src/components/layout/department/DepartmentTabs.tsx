// THE DEPARTMENT VIEW TABS — one line under the header, an emerald underline
// that travels between views. Signals and Leads switch their page views with
// this; secondary navigation inside a pane keeps the segmented control.

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface DeptTabItem<T extends string = string> { id: T; label: string; badge?: number | string }

interface Props<T extends string> {
  tabs: DeptTabItem<T>[];
  active: T | undefined;
  onChange: (id: T) => void;
  label: string;
  /** Unique per page, so two tab rows never share an underline. */
  layoutId: string;
  className?: string;
}

export default function DepartmentTabs<T extends string>({ tabs, active, onChange, label, layoutId, className }: Props<T>) {
  return (
    <nav role="tablist" aria-label={label} className={cn('flex gap-0.5 border-b border-[var(--ag-line)]', className)}>
      {tabs.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.id)}
            className="ag-tab-line px-3.5 py-2 text-[13px] font-medium focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-emerald-400/60"
          >
            <span className="inline-flex items-center gap-1.5">
              {t.label}
              {t.badge !== undefined && (
                <span className="ag-badge-accent rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">{t.badge}</span>
              )}
            </span>
            {isActive && (
              <motion.div
                layoutId={layoutId}
                className="ag-tab-underline absolute inset-x-2 -bottom-px h-[2px] rounded-full motion-reduce:transition-none"
                transition={{ duration: 0.18, ease: 'easeOut' }}
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}
