// CanonicalSignalCard — one card for EVERY signal type (Signals recovery, Phase 3–4).
// LISA's types (expansion, leadership change, technology adoption, launches…) used to have no card,
// so they were counted and never shown. Every field comes from the row (lib/signalCardView.ts);
// what the row cannot establish is said, not hidden. Review actions write the user's review
// (canonical rows → signal_reviews.signal_event_id, legacy rows → signal_id).

import { useState } from 'react';
import { ArrowUpRight, BookmarkCheck, Check, ChevronDown, EyeOff, FlaskConical, ShieldAlert, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FeedSignal } from '@/lib/signalFeedModel';
import { signalView } from '@/lib/signalCardView';

export type CardReview = 'reviewed' | 'saved' | 'ignored';

interface Props {
  signal: FeedSignal;
  reviewStatus?: string | null;
  onReview?: (status: CardReview) => void | Promise<void>;
  accentHex: string;
}

const fmt = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

export default function CanonicalSignalCard({ signal, reviewStatus, onReview, accentHex }: Props) {
  const v = signalView(signal);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<CardReview | null>(null);
  const act = async (s: CardReview) => { if (!onReview) return; setBusy(s); try { await onReview(s); } finally { setBusy(null); } };
  const VIcon = v.verification.tone === 'verified' ? ShieldCheck : ShieldAlert;

  return (
    <article
      className="rounded-xl border bg-card/30 p-4"
      style={{ borderColor: `${accentHex}22` }}
      data-testid="signal-card"
      data-signal-id={v.id}
      data-store={v.store}
      data-category={v.category}
    >
      <header className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.16em]">
        <span style={{ color: `${accentHex}CC` }}>{v.typeLabel}</span>
        {v.relevance.band && <span className="rounded-full border border-white/10 px-2 py-0.5 normal-case tracking-normal text-foreground/75">ICP relevance: {v.relevance.band}</span>}
        {v.isFixture && (
          <span className="inline-flex items-center gap-1 rounded-full border border-fuchsia-400/40 bg-fuchsia-400/10 px-2 py-0.5 normal-case tracking-normal text-fuchsia-200" data-testid="fixture-badge">
            <FlaskConical className="h-3 w-3" /> Test fixture — not market evidence
          </span>
        )}
        {reviewStatus && reviewStatus !== 'new' && (
          <span className="ml-auto rounded-full bg-white/5 px-2 py-0.5 normal-case tracking-normal text-muted-foreground" data-testid="review-status">{reviewStatus}</span>
        )}
      </header>

      <h4 className="mt-1.5 text-[14.5px] font-semibold leading-snug text-foreground">
        {v.company ? <span>{v.company}: </span> : null}{v.title}
      </h4>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
        <span className={cn('inline-flex items-center gap-1', v.verification.tone === 'verified' ? 'text-emerald-300' : 'text-amber-300/90')}>
          <VIcon className="h-3.5 w-3.5" /> {v.verification.label}
        </span>
        {v.confidence && <span>Confidence: {v.confidence}</span>}
        <span>Event: {fmt(v.eventDate) ?? 'date unknown'}</span>
        {v.detectedAt && <span>Detected: {fmt(v.detectedAt)}</span>}
        {v.sourceUrl && (
          <a href={v.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline-offset-2 hover:underline">
            {v.sourceHost ?? 'source'}{v.sourceType ? ` · ${v.sourceType.replace(/_/g, ' ')}` : ''}<ArrowUpRight className="h-3 w-3" />
          </a>
        )}
      </div>

      {v.recommendedAction && <p className="mt-2 text-[13px] text-foreground/85"><span className="text-muted-foreground">Recommended: </span>{v.recommendedAction}</p>}
      {v.actions.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Suggested next steps" data-testid="signal-actions">
          {v.actions.map((a) => (
            <li key={a.kind} title={`${a.why} Needs your approval; nothing runs automatically.`}
              className="rounded-md border border-white/10 px-2 py-0.5 text-[11.5px] text-foreground/80" data-action={a.kind}>
              {a.label}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="mt-3 space-y-1.5 border-t border-white/[0.06] pt-3 text-[12.5px] text-foreground/80" data-testid="signal-detail">
          {v.excerpt && <p><span className="text-muted-foreground">Evidence: </span>“{v.excerpt}”</p>}
          {v.relevance.reasons.length > 0 && (
            <ul className="list-disc pl-5">{v.relevance.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          )}
          {v.eventDateBasis && <p className="text-muted-foreground">Event date basis: {v.eventDateBasis.replace(/_/g, ' ')}</p>}
          {v.gaps.length > 0 && <p className="text-amber-300/80">Not established: {v.gaps.join(', ')}.</p>}
          {v.actionsHeld.length > 0 && <p className="text-muted-foreground">Held: {v.actionsHeld.join('; ')}.</p>}
          <p className="text-muted-foreground">Stored in: {v.store === 'signal_events' ? 'canonical signal store' : 'legacy radar table'}</p>
        </div>
      )}

      <footer className="mt-3 flex flex-wrap items-center gap-1.5">
        <button onClick={() => setOpen((o) => !o)} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-muted-foreground hover:text-foreground" aria-expanded={open}>
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} /> {open ? 'Hide details' : 'Details'}
        </button>
        {onReview && (
          <>
            <button disabled={!!busy} onClick={() => void act('reviewed')} className="ml-auto inline-flex h-7 items-center gap-1 rounded-md border border-white/10 px-2 text-[12px] hover:bg-white/5 disabled:opacity-50" aria-label="Mark reviewed">
              <Check className="h-3.5 w-3.5" /> {busy === 'reviewed' ? 'Saving…' : 'Reviewed'}
            </button>
            <button disabled={!!busy} onClick={() => void act('saved')} className="inline-flex h-7 items-center gap-1 rounded-md border border-white/10 px-2 text-[12px] hover:bg-white/5 disabled:opacity-50" aria-label="Save signal">
              <BookmarkCheck className="h-3.5 w-3.5" /> {busy === 'saved' ? 'Saving…' : 'Save'}
            </button>
            <button disabled={!!busy} onClick={() => void act('ignored')} className="inline-flex h-7 items-center gap-1 rounded-md border border-white/10 px-2 text-[12px] text-muted-foreground hover:bg-white/5 disabled:opacity-50" aria-label="Ignore signal">
              <EyeOff className="h-3.5 w-3.5" /> {busy === 'ignored' ? 'Saving…' : 'Ignore'}
            </button>
          </>
        )}
      </footer>
    </article>
  );
}
