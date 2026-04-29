import { cn } from '@/lib/utils';
import { Check, Zap, DollarSign } from 'lucide-react';
import { MODELS } from './constants';
import { AI_MODELS } from '@/data/aiModelLogos';
import type { AgentDept, AgentModelKey } from '@/data/agentProfiles';

interface Props {
  value: AgentModelKey;
  onChange: (m: AgentModelKey) => void;
  department: AgentDept | null;
  error?: string;
}

const dots = (n: number) => (
  <span className="inline-flex gap-0.5">
    {[1, 2, 3].map((i) => (
      <span key={i} className={cn('w-1.5 h-1.5 rounded-full', i <= n ? 'bg-emerald-400' : 'bg-border')} />
    ))}
  </span>
);

const dollars = (n: number) => (
  <span className="inline-flex">
    {[1, 2, 3].map((i) => (
      <DollarSign key={i} className={cn('w-3 h-3', i <= n ? 'text-emerald-400' : 'text-border')} strokeWidth={3} />
    ))}
  </span>
);

export default function Step4Model({ value, onChange, department, error }: Props) {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl md:text-4xl font-display font-black text-foreground tracking-tight mb-2">
          What intelligence powers this agent?
        </h2>
        <p className="text-sm text-muted-foreground">Each model has different strengths. Match it to the work.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {MODELS.map((m) => {
          const selected = value === m.key;
          const recommended = department && m.recommendedFor.includes(department);
          const meta = AI_MODELS[m.key];
          return (
            <button
              key={m.key}
              onClick={() => onChange(m.key)}
              className={cn(
                'group text-left rounded-2xl border p-5 transition-all relative',
                selected
                  ? `bg-card/70 ring-2 ${m.brandRing}`
                  : 'border-border/60 bg-card/40 hover:border-border hover:bg-card/70',
              )}
            >
              {recommended && (
                <span className="absolute top-3 right-3 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/40">
                  Recommended
                </span>
              )}
              <div className="flex items-center gap-3 mb-4">
                <span className="w-9 h-9 rounded-lg bg-white flex items-center justify-center shrink-0">
                  <img src={meta.logo} alt={m.name} className="w-6 h-6 object-contain" />
                </span>
                <div>
                  <div className="text-base font-bold text-foreground">{m.name}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{m.provider}</div>
                </div>
                {selected && (
                  <span className="ml-auto w-5 h-5 rounded-full bg-emerald-500 text-background flex items-center justify-center">
                    <Check className="w-3 h-3" strokeWidth={3} />
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed mb-3 min-h-[2.5em]">
                Best for: {m.bestFor}
              </p>
              <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Zap className="w-3 h-3 text-emerald-400" /> Speed {dots(m.speed)}
                </span>
                <span className="inline-flex items-center gap-1">
                  Cost {dollars(m.cost)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  );
}
