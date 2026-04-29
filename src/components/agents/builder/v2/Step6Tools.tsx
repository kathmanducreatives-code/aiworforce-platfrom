import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Key, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TOOLS } from './constants';

interface Props {
  selected: string[];
  toolConfig: Record<string, Record<string, any>>;
  onChange: (next: string[]) => void;
  onConfigChange: (key: string, patch: Record<string, any>) => void;
  onSkip: () => void;
}

export default function Step6Tools({ selected, toolConfig, onChange, onConfigChange, onSkip }: Props) {
  const toggle = (k: string) => {
    onChange(selected.includes(k) ? selected.filter((x) => x !== k) : [...selected, k]);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl md:text-4xl font-display font-black text-foreground tracking-tight mb-2">
          What tools can this agent use?
        </h2>
        <p className="text-sm text-muted-foreground">Tools let the agent take actions in the real world.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {TOOLS.map((t) => {
          const on = selected.includes(t.key);
          return (
            <div
              key={t.key}
              className={cn(
                'rounded-xl border p-4 transition-all',
                on ? 'border-emerald-500/50 bg-emerald-500/[0.05]' : 'border-border/60 bg-card/40',
              )}
            >
              <div className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-lg bg-white/[0.06] border border-border/60 flex items-center justify-center text-lg shrink-0">{t.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-foreground">{t.name}</span>
                    <Switch checked={on} onCheckedChange={() => toggle(t.key)} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{t.description}</p>
                  {t.requiresKey && (
                    <button
                      onClick={() => window.open('/settings', '_blank')}
                      className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full hover:bg-amber-500/20"
                    >
                      <Key className="w-3 h-3" /> Requires API key <ExternalLink className="w-2.5 h-2.5" />
                    </button>
                  )}
                  {on && t.hasUrl && (
                    <div className="mt-3">
                      <Input
                        value={(toolConfig[t.key]?.url as string) ?? ''}
                        onChange={(e) => onConfigChange(t.key, { url: e.target.value })}
                        placeholder="https://hooks.example.com/..."
                        className="h-8 text-xs bg-background/60"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="text-center">
        <button onClick={onSkip} className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline">
          Skip for now
        </button>
      </div>
    </div>
  );
}
