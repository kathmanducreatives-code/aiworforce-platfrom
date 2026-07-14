// Animated vertical research timeline for AI Research step.
// Purely presentational. Consumer maps its own stage state; no data fetching.

import { motion } from 'framer-motion';
import { Check, Circle, Loader2, Sparkles } from 'lucide-react';

export type TimelineStatus = 'done' | 'active' | 'pending' | 'skipped';

export interface TimelineStage {
  id: string;
  label: string;
  detail?: string;
  status: TimelineStatus;
}

export function ResearchTimeline({ stages, running }: { stages: TimelineStage[]; running: boolean }) {
  // Only one stage should appear active at a time. If multiple are marked
  // 'active', only the first one gets the spinner — the rest render as pending
  // so the timeline never shows several simultaneous loaders (which looks fake).
  const firstActiveIdx = stages.findIndex((s) => s.status === 'active');
  const normalized = stages.map((s, i) =>
    s.status === 'active' && i !== firstActiveIdx ? { ...s, status: 'pending' as TimelineStatus } : s
  );

  return (
    <div className="relative rounded-2xl border border-border/50 bg-card/40 p-5 backdrop-blur-xl">
      <div className="mb-4 flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Research Timeline</span>
      </div>

      <ol className="relative space-y-4 pl-8">
        {/* Rail */}
        <div className="absolute left-3 top-1 bottom-1 w-px bg-border/50" />
        {running && (
          <motion.div
            className="absolute left-3 top-0 h-16 w-px"
            style={{ background: 'linear-gradient(to bottom, transparent, hsl(var(--primary)), transparent)' }}
            animate={{ y: ['0%', '400%'] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}

        {normalized.map((s) => (
          <li key={s.id} className="relative">
            <span
              className={[
                'absolute -left-[26px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full border transition-colors',
                s.status === 'done'
                  ? 'border-primary/60 bg-primary text-primary-foreground'
                  : s.status === 'active'
                    ? 'border-primary bg-background text-primary'
                    : s.status === 'skipped'
                      ? 'border-border/50 bg-background/60 text-muted-foreground/50'
                      : 'border-border/60 bg-background/60 text-muted-foreground/60',
              ].join(' ')}
            >
              {s.status === 'done' ? (
                <Check className="h-2.5 w-2.5" />
              ) : s.status === 'active' ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
              ) : (
                <Circle className="h-1.5 w-1.5 fill-current" />
              )}
            </span>
            <p
              className={[
                'text-xs font-medium leading-tight',
                s.status === 'pending' || s.status === 'skipped' ? 'text-muted-foreground' : 'text-foreground',
              ].join(' ')}
            >
              {s.label}
            </p>
            {s.detail && <p className="mt-0.5 text-[11px] text-muted-foreground/80">{s.detail}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}
