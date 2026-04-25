import { Sparkles, Megaphone, Eye, BookOpen, Cog } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentDept } from '@/data/agentProfiles';

const DEPTS: { key: AgentDept; label: string; tagline: string; icon: any; ring: string; iconBg: string }[] = [
  { key: 'talent',       label: 'Talent',       tagline: 'Sourcing, screening, shortlists',  icon: Sparkles,  ring: 'border-emerald-500/60 bg-emerald-500/[0.06]', iconBg: 'bg-emerald-500/20 text-emerald-300' },
  { key: 'growth',       label: 'Growth',       tagline: 'Outreach, leads, pipeline',         icon: Megaphone, ring: 'border-blue-500/60 bg-blue-500/[0.06]',       iconBg: 'bg-blue-500/20 text-blue-300' },
  { key: 'content',      label: 'Content',      tagline: 'Posts, copy, brand voice',          icon: BookOpen,  ring: 'border-violet-500/60 bg-violet-500/[0.06]',   iconBg: 'bg-violet-500/20 text-violet-300' },
  { key: 'intelligence', label: 'Intelligence', tagline: 'Competitor & market signals',       icon: Eye,       ring: 'border-amber-500/60 bg-amber-500/[0.06]',     iconBg: 'bg-amber-500/20 text-amber-300' },
  { key: 'operations',   label: 'Operations',   tagline: 'Workflow automation & ops',         icon: Cog,       ring: 'border-slate-400/60 bg-slate-400/[0.06]',     iconBg: 'bg-slate-400/20 text-slate-200' },
];

interface Props {
  value: AgentDept | null;
  onChange: (v: AgentDept) => void;
  error?: string;
}

export default function Step2Department({ value, onChange, error }: Props) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Pick the team this agent will join.</p>
      <div className="grid grid-cols-1 gap-2">
        {DEPTS.map((d) => {
          const Icon = d.icon;
          const selected = value === d.key;
          return (
            <button
              key={d.key}
              type="button"
              onClick={() => onChange(d.key)}
              className={cn(
                'flex items-center gap-3 rounded-xl border p-3 text-left transition-all',
                selected
                  ? `${d.ring} ring-2 ring-emerald-500/40`
                  : 'border-border/60 bg-card/40 hover:bg-card/70 hover:border-border',
              )}
            >
              <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', d.iconBg)}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">{d.label}</p>
                <p className="text-xs text-muted-foreground">{d.tagline}</p>
              </div>
            </button>
          );
        })}
      </div>
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  );
}
