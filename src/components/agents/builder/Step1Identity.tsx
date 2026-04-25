import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export const COLOR_SWATCHES = [
  { key: 'emerald', cls: 'bg-emerald-500' },
  { key: 'blue',    cls: 'bg-blue-500'    },
  { key: 'violet',  cls: 'bg-violet-500'  },
  { key: 'amber',   cls: 'bg-amber-500'   },
  { key: 'rose',    cls: 'bg-rose-500'    },
  { key: 'cyan',    cls: 'bg-cyan-500'    },
  { key: 'fuchsia', cls: 'bg-fuchsia-500' },
  { key: 'slate',   cls: 'bg-slate-400'   },
];

const colorRingMap: Record<string, string> = {
  emerald: 'ring-emerald-500/70',
  blue:    'ring-blue-500/70',
  violet:  'ring-violet-500/70',
  amber:   'ring-amber-500/70',
  rose:    'ring-rose-500/70',
  cyan:    'ring-cyan-500/70',
  fuchsia: 'ring-fuchsia-500/70',
  slate:   'ring-slate-400/70',
};

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
  onName: (v: string) => void;
  onColor: (v: string) => void;
  error?: string;
}

export default function Step1Identity({ name, color, onName, onColor, error }: Props) {
  const initial = (name.trim()[0] || '?').toUpperCase();
  return (
    <div className="space-y-6">
      <div className="flex justify-center">
        <div
          className={cn(
            'w-24 h-24 rounded-full flex items-center justify-center text-3xl font-bold ring-2 ring-offset-2 ring-offset-background transition-all',
            colorBgMap[color] ?? colorBgMap.emerald,
            colorRingMap[color] ?? colorRingMap.emerald,
          )}
        >
          {initial}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="agent-name">Agent name</Label>
        <Input
          id="agent-name"
          value={name}
          onChange={(e) => onName(e.target.value.slice(0, 60))}
          placeholder="e.g. Lyra"
          maxLength={60}
          autoFocus
        />
        {error && <p className="text-xs text-rose-400">{error}</p>}
        <p className="text-xs text-muted-foreground">{name.length}/60</p>
      </div>

      <div className="space-y-2">
        <Label>Avatar color</Label>
        <div className="flex flex-wrap gap-2">
          {COLOR_SWATCHES.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => onColor(s.key)}
              className={cn(
                'w-9 h-9 rounded-full transition-all',
                s.cls,
                color === s.key
                  ? 'ring-2 ring-offset-2 ring-offset-background ring-emerald-400 scale-110'
                  : 'opacity-70 hover:opacity-100',
              )}
              aria-label={s.key}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
