// CREATE A PIECE OF CONTENT — the typed path, not a sentence into chat.
//
// ── WHAT THIS REPLACES ──────────────────────────────────────────────────────
//
// Every creation route in Content used to end at `sendAgentCommand(<English>)`:
// a canned brief typed into the chat composer and dispatched to Pilot. Nothing
// was persisted, nothing came back, and the drafts list stayed structurally
// empty. Five components still do this; this is the one that stops.
//
// The user picks a TYPE and a SOURCE, and both reach the generator as data —
// `format`, `source_type`, `source_signal_id` — so the request is checkable,
// the draft exists before the model is asked, and the result lands on a row.
//
// ── WHY THE DRAFT IS CREATED BEFORE GENERATION ──────────────────────────────
//
// If the model fails, times out, or returns nothing, the user still has the
// draft they made and can regenerate. Creating it afterwards would mean a
// failed generation leaves a toast and no trace, which is what Content did for
// its whole life.

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Lightbulb, Radio, Loader2, FileText, MessageSquare } from 'lucide-react';
import type { ContentFormat, ContentSourceType } from '@/lib/content/contentItems';

/** The minimum a signal needs to be pickable. Matches the feed's shape. */
export interface ComposerSignal {
  id: string;
  title: string;
  signal_type?: string | null;
  account_name?: string | null;
}

export interface ComposerSubmission {
  format: ContentFormat;
  sourceType: ContentSourceType;
  /** The user's own words. Required for an idea; optional angle for a signal. */
  idea: string;
  /** Required when sourceType is 'signal'. */
  signalId: string | null;
  signalTitle: string | null;
}

const TYPES: { key: ContentFormat; label: string; hint: string; icon: typeof FileText }[] = [
  { key: 'linkedin_post', label: 'LinkedIn post', hint: 'A standalone post in your voice', icon: FileText },
  { key: 'linkedin_comment', label: 'LinkedIn comment', hint: 'A reply that adds something', icon: MessageSquare },
];

export default function ContentComposer({
  open, onClose, onSubmit, signals,
}: {
  open: boolean;
  onClose: () => void;
  /** Creates the draft AND asks Scribe. Rejects on failure — the modal stays open. */
  onSubmit: (input: ComposerSubmission) => Promise<void>;
  signals: ComposerSignal[];
}) {
  const [format, setFormat] = useState<ContentFormat>('linkedin_post');
  const [sourceType, setSourceType] = useState<ContentSourceType>('idea');
  const [idea, setIdea] = useState('');
  const [signalId, setSignalId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset per opening, so a previous failure is not still on screen.
  useEffect(() => {
    if (open) { setIdea(''); setSignalId(null); setError(null); setBusy(false); }
  }, [open]);

  const chosenSignal = useMemo(
    () => signals.find((s) => s.id === signalId) ?? null,
    [signals, signalId],
  );

  // An idea needs words; a signal needs a signal. Nothing else is required —
  // an angle on a signal is optional, because the signal itself is the brief.
  const ready = sourceType === 'idea' ? idea.trim().length > 2 : !!signalId;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true); setError(null);
    try {
      await onSubmit({
        format, sourceType,
        idea: idea.trim(),
        signalId: sourceType === 'signal' ? signalId : null,
        signalTitle: sourceType === 'signal' ? (chosenSignal?.title ?? null) : null,
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
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            className="ag-float ag-edge-light w-full max-w-xl rounded-2xl p-6"
          >
            <div className="flex items-start justify-between mb-5">
              <div>
                <h3 className="text-[19px] font-semibold tracking-[-0.015em] text-foreground">Create content</h3>
                <p className="text-[13.5px] text-muted-foreground mt-1">
                  Scribe drafts it with your Company Brain. Nothing publishes.
                </p>
              </div>
              <button
                onClick={onClose} disabled={busy}
                aria-label="Close" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--ag-fill-hover)] hover:text-foreground disabled:opacity-40"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* ── type ── */}
            <p className="text-[12px] font-medium text-muted-foreground/80 mb-2">Type</p>
            <div className="grid grid-cols-2 gap-2 mb-5">
              {TYPES.map(({ key, label, hint, icon: Icon }) => (
                <button
                  key={key} onClick={() => setFormat(key)} disabled={busy}
                  aria-pressed={format === key}
                  className="ag-option text-left px-3.5 py-3 rounded-xl"
                >
                  <span className="flex items-center gap-2 text-[14px] font-medium text-foreground">
                    <Icon className="h-3.5 w-3.5 text-emerald-300/90" />{label}
                  </span>
                  <span className="block text-[12px] text-muted-foreground mt-0.5">{hint}</span>
                </button>
              ))}
            </div>

            {/* ── source ── */}
            <p className="text-[12px] font-medium text-muted-foreground/80 mb-2">Start from</p>
            <div className="grid grid-cols-2 gap-2 mb-4">
              <button
                onClick={() => setSourceType('idea')} disabled={busy}
                aria-pressed={sourceType === 'idea'}
                className={`ag-option px-3.5 py-2.5 rounded-xl text-[14px] font-medium inline-flex items-center gap-2 ${
                  sourceType === 'idea' ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                <Lightbulb className="h-3.5 w-3.5" />An idea
              </button>
              <button
                onClick={() => setSourceType('signal')} disabled={busy || signals.length === 0}
                title={signals.length === 0 ? 'No signals in this workspace yet' : undefined}
                aria-pressed={sourceType === 'signal'}
                className={`ag-option px-3.5 py-2.5 rounded-xl text-[14px] font-medium inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed ${
                  sourceType === 'signal' ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                <Radio className="h-3.5 w-3.5" />A signal
              </button>
            </div>

            {sourceType === 'signal' && (
              <div className="mb-4">
                {/* REAL SIGNALS ONLY. The list is the workspace's own feed; there
                    is no sample data here, so an empty workspace says so. */}
                <select
                  value={signalId ?? ''} disabled={busy}
                  onChange={(e) => setSignalId(e.target.value || null)}
                  className="ag-field w-full h-10 px-3 rounded-lg text-[14px] text-foreground"
                >
                  <option value="">Choose a signal…</option>
                  {signals.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.account_name ? `${s.account_name} — ` : ''}{s.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <textarea
              value={idea} disabled={busy}
              onChange={(e) => setIdea(e.target.value)}
              rows={4}
              placeholder={sourceType === 'idea'
                ? 'What should this be about? e.g. "Why businesses need an AI workforce rather than disconnected AI tools"'
                : 'Optional: the angle you want on this signal.'}
              className="ag-field w-full text-[14px] text-foreground leading-relaxed rounded-lg p-3 resize-y placeholder:text-muted-foreground/55"
            />

            {error && (
              <p className="mt-3 text-[13px] text-amber-300/90">{error}</p>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={onClose} disabled={busy}
                className="ag-btn ag-btn-ghost h-9 px-3.5 rounded-lg text-[13.5px] disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={submit} disabled={!ready || busy}
                className="ag-btn ag-btn-primary h-9 px-4 rounded-lg text-[13.5px] font-medium inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {busy ? 'Scribe is writing…' : 'Create draft'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
