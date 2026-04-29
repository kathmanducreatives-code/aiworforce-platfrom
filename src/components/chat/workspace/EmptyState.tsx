import { AGENT_PROFILES, deptRing, deptText } from '@/data/agentProfiles';
import { Sparkles, Users, TrendingUp, Eye, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const CARDS = [
  { icon: Users, label: '@Scout', text: 'Find 10 React engineers in London', dept: 'talent' as const },
  { icon: TrendingUp, label: '@Penn', text: "Draft outreach for today's leads", dept: 'growth' as const },
  { icon: Eye, label: '@Hawk', text: "What changed at our top 3 competitors today?", dept: 'intelligence' as const },
  { icon: FileText, label: '@Scribe', text: 'Write a LinkedIn post about our Q4 wins', dept: 'content' as const },
];

interface Props {
  onPickPrompt?: (text: string) => void;
}

export default function EmptyState({ onPickPrompt }: Props) {
  return (
    <div className="flex-1 flex items-center justify-center px-6 py-10">
      <div className="max-w-2xl w-full text-center space-y-8">
        {/* Avatar arc */}
        <div className="relative h-32 w-full">
          <div className="absolute inset-0 flex items-end justify-center gap-3">
            {AGENT_PROFILES.map((a, i) => {
              const offset = (i - (AGENT_PROFILES.length - 1) / 2) * 16;
              return (
                <div
                  key={a.id}
                  className={cn('h-14 w-14 rounded-full overflow-hidden ring-2 bg-card border border-border/60', deptRing[a.department])}
                  style={{ transform: `translateY(${-Math.abs(offset)}px)` }}
                >
                  <img src={a.image} alt="" className="h-full w-full object-cover" />
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-primary mb-3">
            <Sparkles className="h-3 w-3" /> AI Workforce
          </div>
          <h2 className="text-2xl font-semibold text-foreground">Your AI workforce is standing by</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
            Type a command or @mention an agent to get started. They work fast.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-3 text-left">
          {CARDS.map((c) => {
            const Icon = c.icon;
            return (
              <button
                key={c.label}
                onClick={() => {
                  const txt = `${c.label} ${c.text}`;
                  navigator.clipboard.writeText(txt);
                  toast.success('Copied to clipboard', { description: 'Paste it into the composer below.' });
                  onPickPrompt?.(txt);
                }}
                className="rounded-xl border border-border/60 bg-card hover:border-primary/40 hover:bg-primary/5 px-4 py-3 transition-all group"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={cn('h-4 w-4', deptText[c.dept])} />
                  <span className={cn('text-xs font-semibold', deptText[c.dept])}>{c.label}</span>
                </div>
                <div className="text-sm text-foreground/90 group-hover:text-foreground">{c.text}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
