// Review card primitives for Company Brain Onboarding v3 (Step 4).
//
// Every card carries the three things the founder needs to trust the AI:
// what it inferred, how confident it is, and the source it read. Fields the
// model could not evidence are badged "needs your confirmation".

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AlertTriangle, Check, ExternalLink, Pencil, ShieldAlert } from 'lucide-react';
import type { QuickAction } from '@/lib/onboardingV3';

export type CardConfidence = 'weak' | 'partial' | 'strong' | 'low' | 'medium' | 'high';

export function ConfidenceBadge({ confidence }: { confidence: CardConfidence }) {
  const strong = confidence === 'strong' || confidence === 'high';
  const mid = confidence === 'partial' || confidence === 'medium';
  return (
    <Badge
      variant="outline"
      className={
        strong ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
        : mid ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
        : 'border-zinc-600/50 bg-zinc-700/20 text-zinc-300'
      }
    >
      {strong ? 'High confidence' : mid ? 'Medium confidence' : 'Low confidence'}
    </Badge>
  );
}

export function NeedsConfirmationBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-300">
      <AlertTriangle className="mr-1 h-3 w-3" />
      {count} need{count === 1 ? 's' : ''} your confirmation
    </Badge>
  );
}

export function MissingBadge({ labels }: { labels: string[] }) {
  if (!labels.length) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-200">
      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>Missing: {labels.join(', ')}</span>
    </div>
  );
}

export function EvidenceLinks({ sources }: { sources: string[] }) {
  if (!sources.length) {
    return <p className="text-xs text-muted-foreground">No source proof — this was inferred or typed by you.</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {sources.slice(0, 6).map((s) => (
        <a
          key={s}
          href={s}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 rounded border border-border/60 bg-muted/30 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="h-3 w-3" />
          {safeHost(s)}
        </a>
      ))}
    </div>
  );
}

function safeHost(u: string): string {
  try { return new URL(u).pathname.replace(/^\//, '') || new URL(u).hostname; } catch { return u.slice(0, 24); }
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
          className="h-7 rounded-full px-2.5 text-[11px]"
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
    <Card className="border-border/60 bg-card/60 p-4 backdrop-blur">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {confidence && <ConfidenceBadge confidence={confidence} />}
          {onEdit && (
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onEdit} aria-label={`Edit ${title}`}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </header>

      <div className="space-y-3 text-sm">{children}</div>

      <footer className="mt-3 space-y-2 border-t border-border/50 pt-3">
        <NeedsConfirmationBadge count={needsConfirmation} />
        <MissingBadge labels={missing} />
        <EvidenceLinks sources={sources} />
        {quickActions && onQuickAction && (
          <QuickActionChips actions={quickActions} onAction={onQuickAction} />
        )}
      </footer>
    </Card>
  );
}

/** Small labelled list used inside the review cards. */
export function FieldList({ label, values, empty = 'Not set' }: { label: string; values: string[]; empty?: string }) {
  return (
    <div>
      <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      {values.length === 0 ? (
        <p className="text-xs text-muted-foreground/70">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {values.map((v) => (
            <span key={v} className="rounded bg-muted/50 px-1.5 py-0.5 text-xs text-foreground/90">{v}</span>
          ))}
        </div>
      )}
    </div>
  );
}
