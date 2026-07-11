import { Users, Radar, BookOpen, Sparkles, Mail } from 'lucide-react';

const ITEMS = [
  { icon: Users, label: 'Leads' },
  { icon: Radar, label: 'Scout Radar' },
  { icon: BookOpen, label: 'Content' },
  { icon: Sparkles, label: 'Agents' },
  { icon: Mail, label: 'Outreach' },
];

export default function SystemUsageStrip() {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/80">Where this powers work</p>
          <p className="text-sm text-foreground/90 mt-1">
            Agentory uses this Company Brain to decide who is worth researching, why now, and what to say. Nothing sends automatically.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          {ITEMS.map(({ icon: Icon, label }) => (
            <span key={label} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border/60 bg-background/40 text-xs text-foreground/80">
              <Icon className="h-3.5 w-3.5 text-primary/80" /> {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
