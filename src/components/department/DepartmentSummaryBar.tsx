import { Activity, Bot, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  activeTasks: number;
  agentsRunning: number;
  awaitingApproval: number;
}

const Stat = ({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number;
  icon: typeof Activity;
  accent: 'emerald' | 'sky' | 'amber';
}) => (
  <div className="flex-1 min-w-[160px] rounded-2xl border border-border/60 bg-card/60 backdrop-blur-md px-5 py-4 flex items-center gap-4">
    <div
      className={cn(
        'h-10 w-10 rounded-xl flex items-center justify-center',
        accent === 'emerald' && 'bg-emerald-500/10 text-emerald-300',
        accent === 'sky' && 'bg-sky-500/10 text-sky-300',
        accent === 'amber' && 'bg-amber-500/10 text-amber-300',
      )}
    >
      <Icon className="h-5 w-5" />
    </div>
    <div className="min-w-0">
      <div className="text-2xl font-semibold text-foreground tabular-nums leading-none">{value}</div>
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground mt-1.5">{label}</div>
    </div>
  </div>
);

export default function DepartmentSummaryBar({ activeTasks, agentsRunning, awaitingApproval }: Props) {
  return (
    <div className="flex flex-wrap gap-3">
      <Stat label="Active tasks" value={activeTasks} icon={Activity} accent="emerald" />
      <Stat label="Agents running" value={agentsRunning} icon={Bot} accent="sky" />
      <Stat label="Awaiting you" value={awaitingApproval} icon={Clock} accent="amber" />
    </div>
  );
}
