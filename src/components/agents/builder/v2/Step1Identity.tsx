import { useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SWATCHES, getSwatch } from './constants';

interface Props {
  name: string;
  color: string;
  onName: (v: string) => void;
  onColor: (v: string) => void;
  onHoverColor: (v: string | null) => void;
  error?: string;
}

export default function Step1Identity({ name, color, onName, onColor, onHoverColor, error }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  return (
    <div className="space-y-10">
      <div>
        <h2 className="text-3xl md:text-4xl font-display font-black text-foreground tracking-tight mb-2">
          Who is this agent?
        </h2>
        <p className="text-sm text-muted-foreground">Give them a name. This is how the rest of the workforce will refer to them.</p>
      </div>

      <div className="space-y-3">
        <Input
          ref={ref}
          value={name}
          onChange={(e) => onName(e.target.value.slice(0, 60))}
          placeholder="Give your agent a name"
          className="h-14 text-2xl font-semibold bg-card/40 border-border/60 placeholder:text-muted-foreground/40"
        />
        {error && <p className="text-xs text-rose-400">{error}</p>}
      </div>

      <div className="space-y-3">
        <label className="text-xs uppercase tracking-widest font-bold text-muted-foreground">
          Pick an identity color
        </label>
        <div className="flex flex-wrap items-center gap-3">
          {SWATCHES.map((s) => {
            const selected = s.key === color;
            return (
              <button
                key={s.key}
                onClick={() => onColor(s.key)}
                onMouseEnter={() => onHoverColor(s.key)}
                onMouseLeave={() => onHoverColor(null)}
                className={cn(
                  'relative w-12 h-12 rounded-full transition-all',
                  s.bg,
                  selected ? `ring-4 ring-offset-2 ring-offset-background ${s.ring} scale-110` : 'ring-1 ring-white/10 hover:scale-105',
                )}
                aria-label={`Pick ${s.label}`}
              >
                {selected && <Check className="absolute inset-0 m-auto w-5 h-5 text-white" strokeWidth={3} />}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Selected: <span className="text-foreground font-semibold">{getSwatch(color).label}</span>
        </p>
      </div>
    </div>
  );
}
