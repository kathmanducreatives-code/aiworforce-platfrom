import { cn } from '@/lib/utils';

interface SignalFilterPillsProps {
  selectedType: string;
  onSelectType: (type: string) => void;
  counts: Record<string, number>;
}

const PILLS = [
  { key: 'all', label: 'All' },
  { key: 'open_to_work', label: '🔴 Open to Work' },
  { key: 'layoff_victim', label: '📉 Layoff' },
  { key: 'published_content', label: '✍️ Published' },
  { key: 'spoke_at_event', label: '🎤 Speaker' },
  { key: 'company_acquired', label: '🔄 Acquired' },
];

const SignalFilterPills = ({ selectedType, onSelectType, counts }: SignalFilterPillsProps) => {
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
      {PILLS.map(pill => (
        <button
          key={pill.key}
          onClick={() => onSelectType(pill.key)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all border',
            selectedType === pill.key
              ? 'bg-primary/10 text-primary border-primary/30'
              : 'bg-card/50 text-muted-foreground border-border hover:border-primary/20 hover:text-foreground'
          )}
        >
          {pill.label}
          <span className={cn(
            'inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-bold',
            selectedType === pill.key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          )}>
            {counts[pill.key] ?? 0}
          </span>
        </button>
      ))}
    </div>
  );
};

export default SignalFilterPills;
