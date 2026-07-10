// Review card primitives for Company Brain Onboarding v3 (Step 4).
//
// Public API (BrainReviewCard props, ConfidenceBadge, NeedsConfirmationBadge,
// MissingBadge, EvidenceLinks, QuickActionChips, FieldList) is UNCHANGED —
// only the presentation was refined for the premium onboarding.

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Check, ExternalLink, Pencil, ShieldAlert, Sparkles } from 'lucide-react';
import type { QuickAction } from '@/lib/onboardingV3';

export type CardConfidence = 'weak' | 'partial' | 'strong' | 'low' | 'medium' | 'high';

export function ConfidenceBadge({ confidence }: { confidence: CardConfidence }) {
  const strong = confidence === 'strong' || confidence === 'high';
  const mid = confidence === 'partial' || confidence === 'medium';
  return (
    <Badge
      variant="outline"
      className={[
        'gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]',
        strong ? 'border-primary/40 bg-primary/10 text-primary'
          : mid ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
            : 'border-zinc-600/50 bg-zinc-700/20 text-zinc-300',
      ].join(' ')}
    >
      {strong ? 'High confidence' : mid ? 'Medium confidence' : 'Low confidence'}
    </Badge>
  );
}

export function AiDraftedBadge() {
  return (
    <Badge
      variant="outline"
      className="gap-1 rounded-full border-primary/30 bg-primary/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-primary"
    >
      <Sparkles className="h-3 w-3" /> AI drafted
    </Badge>
  );
}

export function NeedsConfirmationBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <Badge
      variant="outline"
      className="gap-1 rounded-full border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-amber-300"
    >
      <AlertTriangle className="h-3 w-3" />
      {count} need{count === 1 ? 's' : ''} review
    </Badge>
  );
}

export function MissingBadge({ labels }: { labels: string[] }) {
  if (!labels.length) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-200">
      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>Missing: {labels.join(', ')}</span>
    </div>
  );
}

export function EvidenceLinks({ sources }: { sources: string[] }) {
  if (!sources.length) {
    return <p className="text-[11px] text-muted-foreground">No source proof — inferred or typed by you.</p>;
  }
  return (
    <div>
      <p className="mb-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Sources</p>
      <div className="flex flex-wrap gap-1.5">
        {sources.slice(0, 6).map((s) => (
          <a
            key={s}
            href={s}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" />
            {safeHost(s)}
          </a>
        ))}
      </div>
    </div>
  );
}

function safeHost(u: string): string {
  try {
    const parsed = new URL(u);
    const p = parsed.pathname.replace(/^\//, '');
    return p ? `${parsed.hostname}/${p}`.slice(0, 40) : parsed.hostname;
  } catch { return u.slice(0, 24); }
}

export function QuickActionChips({
  actions,
  onAction,
}: {
  actions: Array<{ id: QuickAction; label: string }>;
  onAction: (a: QuickAction) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {actions.map((a) => (
        <Button
          key={a.id}
          size="sm"
          variant="outline"
          className="h-7 rounded-full border-border/60 bg-background/40 px-3 text-[11px] hover:border-primary/40 hover:text-primary"
          onClick={() => onAction(a.id)}
        >
          {a.id === 'correct' && <Check className="mr-1 h-3 w-3" />}
          {a.label}
        </Button>
      ))}
    </div>
  );
}

export interface BrainReviewCardProps {
  title: string;
  subtitle?: string;
  confidence?: CardConfidence;
  needsConfirmation?: number;
  missing?: string[];
  sources?: string[];
  onEdit?: () => void;
  quickActions?: Array<{ id: QuickAction; label: string }>;
  onQuickAction?: (a: QuickAction) => void;
  children: React.ReactNode;
}

export function BrainReviewCard({
  title, subtitle, confidence, needsConfirmation = 0, missing = [],
  sources = [], onEdit, quickActions, onQuickAction, children,
}: BrainReviewCardProps) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border/50 bg-card/40 backdrop-blur-sm transition-colors hover:border-border">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />

      <header className="space-y-2.5 border-b border-border/40 p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-base font-semibold tracking-tight text-foreground">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {onEdit && (
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={onEdit} aria-label={`Edit ${title}`}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <AiDraftedBadge />
          {confidence && <ConfidenceBadge confidence={confidence} />}
        </div>
      </header>

      <div className="space-y-3.5 p-5 text-sm">{children}</div>

      <footer className="space-y-2.5 border-t border-border/40 bg-background/30 p-5">
        <div className="flex flex-wrap gap-1.5">
          <NeedsConfirmationBadge count={needsConfirmation} />
        </div>
        <MissingBadge labels={missing} />
        <EvidenceLinks sources={sources} />
        {quickActions && onQuickAction && (
          <QuickActionChips actions={quickActions} onAction={onQuickAction} />
        )}
      </footer>
    </div>
  );
}

/** Small labelled list used inside the review cards. */
export function FieldList({ label, values, empty = 'Not set' }: { label: string; values: string[]; empty?: string }) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      {values.length === 0 ? (
        <p className="text-xs text-muted-foreground/60">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span
              key={v}
              className="rounded-md border border-border/40 bg-muted/40 px-2 py-0.5 text-xs text-foreground/90"
            >
              {v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
