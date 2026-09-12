// CREATE A PIECE OF CONTENT — tell Scribe what you want, not how to build it.
//
// ── WHAT THIS REPLACES ──────────────────────────────────────────────────────
//
// The modal used to be a form: pick LinkedIn post or comment, pick an idea or a
// signal, maybe an angle — implementation decisions, asked before Scribe had
// looked at anything. A person knows what they want to TALK ABOUT; deciding the
// angle, the hook, the audience and whether it should be a carousel or a meme
// is exactly the strategist's job.
//
// So the modal asks one thing — what do you want to talk about? — and offers two
// switches that change what Scribe draws on (current market signals, the Company
// Brain), both on. Everything else is Scribe's decision, shown afterwards in the
// Studio with "Change format" / "Change angle". A format can still be forced
// from Advanced, and it is Auto unless someone opens that and chooses.
//
// A reply to someone else's post is not made here: a comment answers a specific
// post, so it is created from that post (Comments), never chosen in a form.
//
// ── THE CONTRACT IS STILL TYPED ────────────────────────────────────────────
//
// `format`, `sourceType`, `signalId` reach the generator as data. The draft is
// created before Scribe is asked, so a failed generation leaves something to
// retry. Signals are supplied by the page, from the workspace's real feed.

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Loader2, Radio, ChevronDown, Sparkles } from 'lucide-react';
import type { ContentSourceType } from '@/lib/content/contentItems';
import { Switch } from '@/components/ui/switch';
import {
  FORMAT_SPECS, formatsForSurface, type ContentFormatKind,
} from '../../../supabase/functions/_shared/contentFormats';

/** The minimum a signal needs to be pickable. Matches the feed's shape. */
export interface ComposerSignal {
  id: string;
  title: string;
  signal_type?: string | null;
  account_name?: string | null;
}

export interface ComposerSubmission {
  /** Auto ⇒ Scribe decides the shape. A kind is the user's explicit override. */
  format: ContentFormatKind | 'auto';
  sourceType: ContentSourceType;
  /** What the person wants to talk about or achieve. Optional when a signal is chosen. */
  idea: string;
  /** Set when the content starts from a signal. */
  signalId: string | null;
  signalTitle: string | null;
  /** Offer Scribe the workspace's current market signals as context. */
  useMarketSignals: boolean;
  /** Let Scribe draw on the Company Brain beyond who is writing. */
  useCompanyBrain: boolean;
}

const POST_FORMATS = formatsForSurface('linkedin_post');

export default function ContentComposer({
  open, onClose, onSubmit, signals, initialSignalId = null,
}: {
  open: boolean;
  onClose: () => void;
  /** Creates the draft AND asks Scribe. Rejects on failure — the modal stays open. */
  onSubmit: (input: ComposerSubmission) => Promise<void>;
  signals: ComposerSignal[];
  /** Open already pointed at a signal, e.g. from a source card. */
  initialSignalId?: string | null;
}) {
  const [idea, setIdea] = useState('');
  const [signalId, setSignalId] = useState<string | null>(null);
  const [pickingSignal, setPickingSignal] = useState(false);
  const [useMarketSignals, setUseMarketSignals] = useState(true);
  const [useCompanyBrain, setUseCompanyBrain] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [format, setFormat] = useState<ContentFormatKind | 'auto'>('auto');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset per opening, so a previous failure or choice is not still on screen.
  useEffect(() => {
    if (open) {
      setIdea(''); setSignalId(initialSignalId); setPickingSignal(false); setError(null); setBusy(false);
      setUseMarketSignals(true); setUseCompanyBrain(true); setAdvancedOpen(false); setFormat('auto');
    }
  }, [open, initialSignalId]);

  const chosenSignal = useMemo(
    () => signals.find((s) => s.id === signalId) ?? null,
    [signals, signalId],
  );
  const sourceType: ContentSourceType = chosenSignal ? 'signal' : 'idea';

  // Words, or a signal. Nothing else is required — the rest is Scribe's call.
  const ready = !!chosenSignal || idea.trim().length > 2;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true); setError(null);
    try {
      await onSubmit({
        format, sourceType,
        idea: idea.trim(),
        signalId: chosenSignal ? chosenSignal.id : null,
        signalTitle: chosenSignal ? chosenSignal.title : null,
        // A signal-led draft is already about one signal; offering others as
        // context is the idea path's switch.
        useMarketSignals: !chosenSignal && useMarketSignals && signals.length > 0,
        useCompanyBrain,
      });
      onClose();
    } catch (e) {
      // The modal stays open with the user's words intact. A failed generation
      // must never look like a success.
      setError(e instanceof Error ? e.message : 'Could not create the draft');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="composer-overlay"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="ag-overlay fixed inset-0 z-[80] flex items-center justify-center p-4"
          onClick={busy ? undefined : onClose}
        >
          <motion.div
            role="dialog" aria-modal="true" aria-labelledby="composer-title"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            className="ag-float ag-edge-light w-full max-w-xl rounded-2xl p-6"
          >
            <div className="mb-5 flex items-start justify-between">
              <div>
                <h3 id="composer-title" className="text-[19px] font-semibold tracking-[-0.015em] text-foreground">Create content</h3>
                <p className="mt-1 text-[13.5px] text-muted-foreground">
                  Tell Scribe what you want to say. It chooses the angle, format and structure from your Company Brain.
                </p>
              </div>
              <button
                onClick={onClose} disabled={busy} aria-label="Close"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--ag-fill-hover)] hover:text-foreground disabled:opacity-40"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* ── the source: a signal, when one is chosen ── */}
            {chosenSignal ? (
              <div className="mb-3 flex items-start justify-between gap-3 rounded-xl bg-[var(--ag-fill)] px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--ag-line),inset_2px_0_0_rgb(var(--ag-emerald)/0.8)]">
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-muted-foreground/80">Signal selected</p>
                  <p className="mt-0.5 text-[14px] font-medium leading-snug text-foreground">{chosenSignal.title}</p>
                </div>
                <button onClick={() => setSignalId(null)} disabled={busy}
                  className="shrink-0 text-[12px] text-muted-foreground hover:text-foreground">Remove</button>
              </div>
            ) : null}

            {/* ── the one question ── */}
            <label htmlFor="composer-idea" className="mb-2 block text-[12.5px] font-medium text-foreground/85">
              {chosenSignal ? 'Anything you want to add? (optional)' : 'What do you want to talk about?'}
            </label>
            <textarea
              id="composer-idea"
              value={idea} disabled={busy}
              onChange={(e) => setIdea(e.target.value)}
              rows={chosenSignal ? 2 : 4}
              autoFocus
              placeholder={chosenSignal
                ? 'e.g. "focus on what this means for founders" — or leave it to Scribe'
                : 'An idea, a goal or a belief — e.g. "Why companies need an AI workforce, not more disconnected AI tools"'}
              className="ag-field w-full resize-y rounded-lg p-3 text-[14px] leading-relaxed text-foreground placeholder:text-muted-foreground/55"
            />

            {!chosenSignal && signals.length > 0 && (
              <div className="mt-2">
                {pickingSignal ? (
                  <select
                    value="" disabled={busy} autoFocus
                    onChange={(e) => { setSignalId(e.target.value || null); setPickingSignal(false); }}
                    aria-label="Start from a signal"
                    className="ag-field h-9 w-full rounded-lg px-3 text-[13.5px] text-foreground"
                  >
                    <option value="">Choose a signal…</option>
                    {signals.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.account_name ? `${s.account_name} — ` : ''}{s.title}
                      </option>
                    ))}
                  </select>
                ) : (
                  <button onClick={() => setPickingSignal(true)} disabled={busy}
                    className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground">
                    <Radio className="h-3.5 w-3.5" /> Or start from a signal
                  </button>
                )}
              </div>
            )}

            {/* ── what Scribe draws on ── */}
            <div className="mt-5 divide-y divide-[var(--ag-line)] rounded-xl bg-[var(--ag-fill)] shadow-[inset_0_0_0_1px_var(--ag-line)]">
              {!chosenSignal && (
                <Toggle
                  id="composer-signals" label="Use current market signals"
                  hint={signals.length ? 'Scribe may draw on what is happening in your market.' : 'No signals in this workspace yet.'}
                  checked={useMarketSignals && signals.length > 0}
                  disabled={busy || signals.length === 0}
                  onChange={setUseMarketSignals}
                />
              )}
              <Toggle
                id="composer-brain" label="Use Company Brain"
                hint="Your positioning, ICP, voice and the claims you can make."
                checked={useCompanyBrain} disabled={busy} onChange={setUseCompanyBrain}
              />
            </div>

            {/* ── advanced: an override, never a question ── */}
            <div className="mt-4">
              <button onClick={() => setAdvancedOpen((v) => !v)} aria-expanded={advancedOpen}
                className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground">
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
                Advanced · Format: {format === 'auto' ? 'Auto' : FORMAT_SPECS[format].label}
              </button>
              {advancedOpen && (
                <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Format">
                  {(['auto', ...POST_FORMATS] as const).map((f) => (
                    <button key={f} onClick={() => setFormat(f)} disabled={busy}
                      aria-pressed={format === f}
                      className="ag-chip h-7 rounded-md px-2.5 text-[12px] font-medium">
                      {f === 'auto' ? 'Auto — Scribe decides' : FORMAT_SPECS[f].label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {error && <p className="mt-3 text-[13px] text-amber-300/90">{error}</p>}

            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                onClick={onClose} disabled={busy}
                className="ag-btn ag-btn-ghost h-9 rounded-lg px-3.5 text-[13.5px] disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={submit} disabled={!ready || busy}
                className="ag-btn ag-btn-primary inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-[13.5px] font-medium disabled:cursor-not-allowed disabled:opacity-45"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {busy ? 'Scribe is thinking…' : 'Create'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Toggle({ id, label, hint, checked, disabled, onChange }: {
  id: string; label: string; hint: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-3.5 py-3">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-[13.5px] font-medium text-foreground/90">{label}</span>
        <span className="block text-[12px] text-muted-foreground/70">{hint}</span>
      </label>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}
