import { Sparkles, Search, Send, FileText, Swords, Settings2, LayoutGrid, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CATEGORY_LABEL, CATEGORY_ORDER, type WorkflowCategory } from '@/lib/workflows/registry';

interface Props {
  active: WorkflowCategory | 'all';
  onChange: (c: WorkflowCategory | 'all') => void;
  countAll: number;
  countByCategory: Record<WorkflowCategory, number>;
}

const ICON: Record<WorkflowCategory, LucideIcon> = {
  growth: Sparkles,
  research: Search,
  outreach: Send,
  content: FileText,
  competitor: Swords,
  operations: Settings2,
};

export default function CategoryRail({ active, onChange, countAll, countByCategory }: Props) {
  return (
    <div className="space-y-0.5">
      <Item
        active={active === 'all'}
        onClick={() => onChange('all')}
        label="All workflows"
        count={countAll}
        Icon={LayoutGrid}
      />
      {CATEGORY_ORDER.map((c) => (
        <Item
          key={c}
          active={active === c}
          onClick={() => onChange(c)}
          label={CATEGORY_LABEL[c]}
          count={countByCategory[c] || 0}
          Icon={ICON[c]}
        />
      ))}
    </div>
  );
}

function Item({
  active, onClick, label, count, Icon,
}: { active: boolean; onClick: () => void; label: string; count: number; Icon: LucideIcon }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'group relative w-full flex items-center justify-between pl-3 pr-3 h-10 rounded-lg text-[14px] transition-all border',
        active
          ? 'bg-emerald-500/[0.10] text-foreground font-semibold border-emerald-500/25 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]'
          : 'text-neutral-300 hover:text-foreground hover:bg-white/[0.035] border-transparent',
      )}
    >
      {active && <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />}
      <span className="flex items-center gap-2.5">
        <Icon className={cn('w-3.5 h-3.5', active ? 'text-emerald-300' : 'text-neutral-500 group-hover:text-neutral-300')} />
        {label}
      </span>
      <span className={cn('text-[11.5px] font-mono tabular-nums', active ? 'text-emerald-300/80' : 'text-neutral-500')}>
        {count}
      </span>
    </button>
  );
}
