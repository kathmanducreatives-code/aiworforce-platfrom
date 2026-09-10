// Content draft detail drawer. Shows the source signal, core argument, hook
// options, draft body, CTA, proof used, missing proof and approval status.
// Read + approve only — nothing publishes from here.
import { useEffect, useState } from "react";
import { X, ExternalLink, ShieldAlert, Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

export interface ContentDetail {
  id: string;
  title: string;
  format: string;
  statusLabel: string;
  sourceSignal?: string | null;
  coreArgument?: string | null;
  hookOptions?: string[];
  body?: string | null;
  cta?: string | null;
  proofUrl?: string | null;
  missingProof?: string[];
}

/**
 * `onSave` is OPTIONAL, and the drawer is read-only without it — which is what
 * every caller that renders a `saved_outputs` row still wants, since those are
 * an append-only record with nothing to save back to. A `content_item` is an
 * editable object, so the Content page passes a saver and gets an editor.
 */
export default function ContentDetailDrawer({ detail, onClose, onSave }: {
  detail: ContentDetail | null;
  onClose: () => void;
  onSave?: (patch: { body: string }) => Promise<void>;
}) {
  const editable = typeof onSave === "function";
  const [draftBody, setDraftBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Re-seed when a DIFFERENT draft opens, keyed on id rather than on `detail`:
  // the parent rebuilds `detail` in a useMemo on every list refresh, and
  // depending on the object would wipe what the user has typed each time.
  useEffect(() => {
    setDraftBody(detail?.body ?? "");
    setSaveError(null);
    setSavedAt(null);
  }, [detail?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    if (detail) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail, onClose]);

  const missing = detail?.missingProof ?? [];

  return (
    <AnimatePresence>
      {detail && (
        <motion.div
          key="content-detail-overlay"
          className="fixed inset-0 z-[70]"
          role="dialog"
          aria-modal="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
        <motion.div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        />
        <motion.aside
          className="absolute right-0 top-0 h-full w-full max-w-[560px] bg-[#0d1117] border-l border-white/[0.08] shadow-2xl overflow-y-auto"
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 32, stiffness: 320 }}
        >
        <div className="sticky top-0 z-10 bg-[#0d1117]/95 backdrop-blur border-b border-white/[0.06] px-5 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-neutral-300">{detail.format}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-violet-500/30 bg-violet-500/10 text-violet-300">{detail.statusLabel}</span>
            </div>
            <h2 className="text-[17px] font-semibold text-[#F0F6FC] leading-snug">{detail.title}</h2>
          </div>
          <button onClick={onClose} className="shrink-0 p-1.5 rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.05]"><X className="h-4 w-4" /></button>
        </div>

        <div className="px-5 py-4 space-y-5 text-[#C9D1D9]">
          {detail.sourceSignal && (
            <Section title="Source signal"><p className="text-[14px] text-neutral-300">{detail.sourceSignal}</p></Section>
          )}
          {detail.coreArgument && (
            <Section title="Core argument"><p className="text-[14px] text-neutral-200 leading-relaxed">{detail.coreArgument}</p></Section>
          )}
          {detail.hookOptions && detail.hookOptions.length > 0 && (
            <Section title="Hook options">
              <ul className="space-y-1.5">
                {detail.hookOptions.map((h, i) => (
                  <li key={i} className="text-[13px] text-neutral-200 rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 py-2">{h}</li>
                ))}
              </ul>
            </Section>
          )}
          <Section title="Draft body">
            {editable ? (
              <>
                <textarea
                  value={draftBody}
                  onChange={(e) => { setDraftBody(e.target.value); setSavedAt(null); }}
                  rows={10}
                  placeholder="Write your draft. It is saved to this workspace, not to the chat."
                  className="w-full text-[14px] text-neutral-100 leading-relaxed rounded-lg border border-white/[0.06] bg-white/[0.015] p-3.5 outline-none focus:border-white/20 resize-y"
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={async () => {
                      if (!onSave || saving) return;
                      setSaving(true); setSaveError(null);
                      try {
                        await onSave({ body: draftBody });
                        setSavedAt(Date.now());
                      } catch (err) {
                        // The work stays in the textarea. Losing an edit to a
                        // failed write is the exact failure this whole slice exists
                        // to end.
                        setSaveError(err instanceof Error ? err.message : "Could not save");
                      } finally {
                        setSaving(false);
                      }
                    }}
                    disabled={saving || draftBody === (detail.body ?? "")}
                    className="h-8 px-3 rounded-lg text-[12.5px] font-medium inline-flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-black disabled:bg-white/[0.04] disabled:text-neutral-500 disabled:cursor-not-allowed transition-colors"
                  >
                    {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {saving ? "Saving…" : "Save draft"}
                  </button>
                  {savedAt && !saveError && (
                    <span className="text-[12px] text-emerald-300/90">Saved</span>
                  )}
                  {saveError && (
                    <span className="text-[12px] text-amber-300/90">{saveError}</span>
                  )}
                </div>
              </>
            ) : detail.body ? (
              <div className="text-[14px] text-neutral-100 leading-relaxed whitespace-pre-wrap rounded-lg border border-white/[0.06] bg-white/[0.015] p-3.5">{detail.body}</div>
            ) : (
              <p className="text-[13px] text-neutral-500 italic">No draft body yet — Scribe will draft it for your review.</p>
            )}
          </Section>
          {detail.cta && (<Section title="CTA"><p className="text-[14px] text-neutral-200">{detail.cta}</p></Section>)}
          <Section title="Proof used">
            {detail.proofUrl ? (
              <a href={detail.proofUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] text-sky-300 hover:underline break-all"><ExternalLink className="h-3.5 w-3.5 shrink-0" /> {detail.proofUrl}</a>
            ) : (
              <p className="text-[13px] text-amber-300/80">No source proof attached — add evidence before publishing.</p>
            )}
          </Section>
          {missing.length > 0 && (
            <Section title="Missing proof">
              <ul className="space-y-1">{missing.map((m) => <li key={m} className="text-[13px] text-amber-200/85 inline-flex items-center gap-1.5"><ShieldAlert className="h-3.5 w-3.5 shrink-0" /> {m}</li>)}</ul>
            </Section>
          )}
        </div>

          <div className="sticky bottom-0 bg-[#0d1117]/95 backdrop-blur border-t border-white/[0.06] px-5 py-3 text-[12px] text-neutral-400">
            Review and edit here. When you're happy, publish it yourself — Agentory never posts for you.
          </div>
        </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500 mb-2">{title}</h3>
      {children}
    </section>
  );
}
