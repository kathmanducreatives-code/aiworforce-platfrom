import { Search, Globe, Mail, MessageSquare, Mic } from 'lucide-react';
import { cn } from '@/lib/utils';

const TOOLS = [
  { key: 'web_search',          label: 'Web Search',          desc: 'Live web results',                 icon: Search },
  { key: 'firecrawl',           label: 'Firecrawl',           desc: 'Crawl & extract structured data',  icon: Globe },
  { key: 'email_sender',        label: 'Email Sender',        desc: 'Send transactional emails',        icon: Mail },
  { key: 'slack_notification',  label: 'Slack Notifications', desc: 'Post to your team channels',       icon: MessageSquare },
  { key: 'elevenlabs_voice',    label: 'ElevenLabs Voice',    desc: 'Generate voice messages',          icon: Mic },
];

interface Props {
  value: string[];
  onChange: (v: string[]) => void;
  onSkip: () => void;
}

export default function Step6Tools({ value, onChange, onSkip }: Props) {
  const toggle = (key: string) => {
    onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Give this agent tools it can call. All optional — you can change later.
      </p>

      <div className="space-y-2">
        {TOOLS.map((t) => {
          const Icon = t.icon;
          const selected = value.includes(t.key);
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => toggle(t.key)}
              className={cn(
                'w-full flex items-center gap-3 rounded-xl border p-3 text-left transition-all',
                selected
                  ? 'border-emerald-500/60 bg-emerald-500/[0.06] ring-2 ring-emerald-500/40'
                  : 'border-border/60 bg-card/40 hover:bg-card/70 hover:border-border',
              )}
            >
              <div className={cn(
                'w-10 h-10 rounded-lg flex items-center justify-center',
                selected ? 'bg-emerald-500/20 text-emerald-300' : 'bg-muted/50 text-muted-foreground',
              )}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">{t.label}</p>
                <p className="text-xs text-muted-foreground">{t.desc}</p>
              </div>
              <div className={cn(
                'w-5 h-5 rounded border-2 flex items-center justify-center transition',
                selected ? 'bg-emerald-500 border-emerald-500' : 'border-border',
              )}>
                {selected && <span className="text-[10px] text-background font-bold">✓</span>}
              </div>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onSkip}
        className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4"
      >
        Skip for now
      </button>
    </div>
  );
}
