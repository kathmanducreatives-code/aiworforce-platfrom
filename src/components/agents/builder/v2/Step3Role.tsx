import { Textarea } from '@/components/ui/textarea';
import { Lightbulb, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ROLE_TEMPLATES } from './constants';

interface Props {
  value: string;
  onChange: (v: string) => void;
  error?: string;
}

const MIN = 50;

export default function Step3Role({ value, onChange, error }: Props) {
  const len = value.length;
  const ok = len >= MIN;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl md:text-4xl font-display font-black text-foreground tracking-tight mb-2">
          What is this agent's job?
        </h2>
        <p className="text-sm text-muted-foreground">Write the agent's instructions. This becomes its brain.</p>
      </div>

      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`You are [name], an expert in...
Your job is to...
When given a task you will...
Always return your output as JSON with...`}
        className="min-h-[280px] text-sm leading-relaxed font-mono bg-card/40 border-border/60 resize-none"
      />

      <div className="flex items-center justify-between text-xs">
        <span className={cn(ok ? 'text-emerald-400' : 'text-muted-foreground')}>
          {len}/{MIN} characters minimum
        </span>
        {error && <span className="text-rose-400">{error}</span>}
      </div>

      <div>
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-widest font-bold text-muted-foreground mb-2">
          <Sparkles className="w-3 h-3" /> Starter templates
        </div>
        <div className="flex flex-wrap gap-2">
          {ROLE_TEMPLATES.map((t) => (
            <button
              key={t.key}
              onClick={() => onChange(t.text)}
              className="text-xs font-medium px-3 py-1.5 rounded-full border border-border/60 bg-card/40 hover:border-emerald-500/50 hover:bg-emerald-500/10 hover:text-emerald-300 text-foreground/80 transition"
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border/50 bg-amber-500/[0.04] p-3 flex gap-2.5">
        <Lightbulb className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Be specific about what input this agent receives and exactly what JSON format it should return. This is the agent's brain.
        </p>
      </div>
    </div>
  );
}
