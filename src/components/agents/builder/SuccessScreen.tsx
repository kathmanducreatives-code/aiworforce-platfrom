import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const colorBgMap: Record<string, string> = {
  emerald: 'bg-emerald-500/20 text-emerald-300',
  blue:    'bg-blue-500/20 text-blue-300',
  violet:  'bg-violet-500/20 text-violet-300',
  amber:   'bg-amber-500/20 text-amber-300',
  rose:    'bg-rose-500/20 text-rose-300',
  cyan:    'bg-cyan-500/20 text-cyan-300',
  fuchsia: 'bg-fuchsia-500/20 text-fuchsia-300',
  slate:   'bg-slate-400/20 text-slate-200',
};

interface Props {
  name: string;
  color: string;
  department: string;
  model: string;
  capabilityCount: number;
  toolsCount: number;
  onClose: () => void;
}

export default function SuccessScreen({ name, color, department, model, capabilityCount, toolsCount, onClose }: Props) {
  const initial = (name.trim()[0] || '?').toUpperCase();
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center space-y-5">
      <div className="relative">
        <div
          className={cn(
            'w-28 h-28 rounded-full flex items-center justify-center text-4xl font-bold ring-4 ring-emerald-500/30',
            colorBgMap[color] ?? colorBgMap.emerald,
          )}
        >
          {initial}
        </div>
        <CheckCircle2 className="absolute -bottom-1 -right-1 h-8 w-8 text-emerald-400 fill-background" />
      </div>

      <div className="space-y-1">
        <h3 className="text-xl font-bold text-foreground">{name} is deployed</h3>
        <p className="text-sm text-muted-foreground">Ready to take on tasks in your workspace.</p>
      </div>

      <div className="w-full max-w-xs grid grid-cols-2 gap-2 text-left">
        <div className="rounded-lg border border-border/50 bg-card/40 p-2.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Department</p>
          <p className="text-sm font-medium text-foreground capitalize">{department}</p>
        </div>
        <div className="rounded-lg border border-border/50 bg-card/40 p-2.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Model</p>
          <p className="text-sm font-medium text-foreground truncate">{model.split('-').slice(0, 2).join(' ')}</p>
        </div>
        <div className="rounded-lg border border-border/50 bg-card/40 p-2.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Capabilities</p>
          <p className="text-sm font-medium text-foreground">{capabilityCount}</p>
        </div>
        <div className="rounded-lg border border-border/50 bg-card/40 p-2.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Tools</p>
          <p className="text-sm font-medium text-foreground">{toolsCount}</p>
        </div>
      </div>

      <Button onClick={onClose} className="bg-emerald-500 hover:bg-emerald-600 text-background font-semibold">
        Done
      </Button>
    </div>
  );
}
