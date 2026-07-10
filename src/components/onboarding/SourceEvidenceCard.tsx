// Clean source evidence card for AI Research step.
// Never dumps raw scraped text — accepts curated bullets from the caller.

import { motion } from 'framer-motion';
import { AlertTriangle, Check, FileSearch, Sparkles } from 'lucide-react';

export type EvidenceStatus = 'read' | 'extracted' | 'needs-confirmation' | 'weak' | 'skipped';
export type EvidenceConfidence = 'high' | 'medium' | 'low' | 'none';

export interface SourceEvidenceProps {
  label: string;
  path?: string;
  status: EvidenceStatus;
  confidence?: EvidenceConfidence;
  bullets?: string[];
  index?: number;
}

const STATUS_META: Record<EvidenceStatus, { label: string; className: string; icon: React.ReactNode }> = {
  'read':               { label: 'Read',                icon: <FileSearch className="h-3 w-3" />, className: 'border-primary/40 bg-primary/10 text-primary' },
  'extracted':          { label: 'Extracted',           icon: <Sparkles className="h-3 w-3" />,   className: 'border-primary/40 bg-primary/10 text-primary' },
  'needs-confirmation': { label: 'Needs confirmation',  icon: <AlertTriangle className="h-3 w-3" />, className: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
  'weak':               { label: 'Not enough evidence', icon: <AlertTriangle className="h-3 w-3" />, className: 'border-zinc-600/50 bg-zinc-700/20 text-zinc-300' },
  'skipped':            { label: 'Not analyzed',        icon: <Check className="h-3 w-3 opacity-40" />, className: 'border-border/60 bg-muted/20 text-muted-foreground' },
};

export function SourceEvidenceCard({ label, path, status, confidence, bullets = [], index = 0 }: SourceEvidenceProps) {
  const meta = STATUS_META[status];
  const active = status === 'read' || status === 'extracted';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.25, ease: 'easeOut' }}
      className={[
        'group relative overflow-hidden rounded-xl border p-4 backdrop-blur-sm transition-colors',
        active ? 'border-border/60 bg-card/50 hover:border-primary/40' : 'border-border/40 bg-card/30',
      ].join(' ')}
    >
      {active && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-70"
          style={{ background: 'linear-gradient(to right, transparent, hsl(var(--primary) / 0.6), transparent)' }}
        />
      )}
      <header className="mb-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{label}</p>
          {path && <p className="mt-0.5 truncate text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{path}</p>}
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${meta.className}`}>
          {meta.icon} {meta.label}
        </span>
      </header>

      {bullets.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {bullets.slice(0, 4).map((b, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-foreground/85">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary/70" />
              <span className="leading-snug">{b}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] italic text-muted-foreground/70">
          {status === 'skipped' ? 'No source added yet.' : 'No structured findings pulled.'}
        </p>
      )}

      {confidence && confidence !== 'none' && (
        <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-2.5">
          <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Confidence</span>
          <span
            className={[
              'text-[10px] uppercase tracking-[0.14em]',
              confidence === 'high' ? 'text-primary' : confidence === 'medium' ? 'text-amber-300' : 'text-muted-foreground',
            ].join(' ')}
          >
            {confidence}
          </span>
        </div>
      )}
    </motion.div>
  );
}
