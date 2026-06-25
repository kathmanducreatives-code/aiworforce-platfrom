import { cn } from '@/lib/utils';

export type WorkflowChip = 'all' | 'recommended' | 'ready' | 'setup' | 'coming_soon' | 'recent';

interface Props {
  active: WorkflowChip;
  onChange: (c: WorkflowChip) => void;
  counts?: Partial<Record<WorkflowChip, number>>;
}

const CHIPS: { id: WorkflowChip; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'recommended', label: 'Recommended' },
  { id: 'ready', label: 'Ready' },
  { id: 'setup', label: 'Setup needed' },
  { id: 'coming_soon', label: 'Coming soon' },
  { id: 'recent', label: 'Recently used' },
];

export default function FilterChips({ active, onChange, counts }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {CHIPS.map((c) => {
        const isActive = active === c.id;
        const n = counts?.[c.id];
        return (
          <button
            key={c.id}
            onClick={() => onChange(c.id)}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-[12.5px] transition-all border',
              isActive
                ? 'bg-emerald-500/[0.10] border-emerald-500/30 text-emerald-200'
                : 'bg-white/[0.025] border-white/[0.08] text-neutral-300 hover:text-foreground hover:border-white/[0.18]',
            )}
          >
            {c.label}
            {typeof n === 'number' && (
              <span className={cn('font-mono text-[11px] tabular-nums', isActive ? 'text-emerald-300/80' : 'text-neutral-500')}>{n}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
