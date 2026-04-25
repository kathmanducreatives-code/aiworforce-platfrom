import { cn } from '@/lib/utils';
import openaiLogo from '@/assets/ai-logos/openai.png';
import claudeLogo from '@/assets/ai-logos/claude.png';
import geminiLogo from '@/assets/ai-logos/gemini.png';

const MODELS = [
  { key: 'claude-haiku-4-5-20251001',  label: 'Claude Haiku 4.5',  desc: 'Fast & cheap — great for high volume',     logo: claudeLogo, chipBg: 'bg-orange-500/15' },
  { key: 'claude-sonnet-4-5-20251001', label: 'Claude Sonnet 4.5', desc: 'Balanced reasoning — recommended default',  logo: claudeLogo, chipBg: 'bg-orange-500/15' },
  { key: 'gpt-4o',                     label: 'GPT-4o',            desc: 'Multimodal & versatile',                    logo: openaiLogo, chipBg: 'bg-white' },
  { key: 'gemini-1.5-pro',             label: 'Gemini 1.5 Pro',    desc: 'Long-context & deep research',              logo: geminiLogo, chipBg: 'bg-white' },
];

interface Props {
  value: string;
  onChange: (v: string) => void;
  error?: string;
}

export default function Step4Model({ value, onChange, error }: Props) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Which model should power this agent?</p>
      <div className="grid grid-cols-1 gap-2">
        {MODELS.map((m) => {
          const selected = value === m.key;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => onChange(m.key)}
              className={cn(
                'flex items-center gap-3 rounded-xl border p-3 text-left transition-all',
                selected
                  ? 'border-emerald-500/60 bg-emerald-500/[0.06] ring-2 ring-emerald-500/40'
                  : 'border-border/60 bg-card/40 hover:bg-card/70 hover:border-border',
              )}
            >
              <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden', m.chipBg)}>
                <img src={m.logo} alt={m.label} className="w-6 h-6 object-contain" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">{m.label}</p>
                <p className="text-xs text-muted-foreground">{m.desc}</p>
              </div>
            </button>
          );
        })}
      </div>
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  );
}
