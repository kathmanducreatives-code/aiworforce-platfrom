import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';
import type { AgentDept } from '@/data/agentProfiles';
import { DEPARTMENTS } from './constants';

interface Props {
  value: AgentDept | null;
  onChange: (d: AgentDept) => void;
  error?: string;
}

export default function Step2Department({ value, onChange, error }: Props) {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl md:text-4xl font-display font-black text-foreground tracking-tight mb-2">
          Where does this agent work?
        </h2>
        <p className="text-sm text-muted-foreground">Departments organize agents into teams that collaborate.</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {DEPARTMENTS.map((d) => {
          const selected = value === d.key;
          return (
            <button
              key={d.key}
              onClick={() => onChange(d.key)}
              className={cn(
                'group text-left rounded-2xl border p-5 transition-all',
                selected
                  ? `bg-emerald-500/[0.06] border-emerald-500/60 ${d.glow}`
                  : 'border-border/60 bg-card/40 hover:border-border hover:bg-card/70',
              )}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2.5">
                  <span className="text-2xl">{d.emoji}</span>
                  <span className="text-base font-bold text-foreground">{d.label}</span>
                </div>
                {selected && (
                  <span className="w-5 h-5 rounded-full bg-emerald-500 text-background flex items-center justify-center">
                    <Check className="w-3 h-3" strokeWidth={3} />
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed mb-3">{d.description}</p>
              <div className="flex items-center gap-1.5">
                {d.agents.length > 0 ? (
                  <>
                    <div className="flex -space-x-1.5">
                      {d.agents.map((name) => (
                        <div
                          key={name}
                          title={name}
                          className="w-6 h-6 rounded-full bg-gradient-to-br from-foreground/30 to-foreground/10 border-2 border-card flex items-center justify-center text-[10px] font-bold text-foreground"
                        >
                          {name[0]}
                        </div>
                      ))}
                    </div>
                    <span className="text-[10px] text-muted-foreground">{d.agents.join(', ')}</span>
                  </>
                ) : (
                  <span className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider">Be the first</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  );
}
