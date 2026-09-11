// Content draft detail drawer. Shows the source signal, core argument, hook
// options, draft body, CTA, proof used, missing proof and approval status.
// Read + approve only — nothing publishes from here.
import { useEffect, useRef, useState } from "react";
import { X, ExternalLink, ShieldAlert, Loader2, Sparkles, RefreshCw, History, Image as ImageIcon } from "lucide-react";
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
/** What produced a version, in words a person reads. */
const LABEL: Record<string, string> = {
  manual_edit: "edited by you",
  scribe_generation: "written by Scribe",
  scribe_regeneration: "rewritten by Scribe",
};

/** One past version, newest first. Read-only — history is not editable. */
export interface ContentVersionRow {
  id: string;
  version: number;
  body: string;
  generation_source: string;
  created_at: string;
  is_current: boolean;
}

export default function ContentDetailDrawer({
  detail, onClose, onSave, onGenerate, onRegenerate, versions, onLoadVersions,
  onGenerateImage, imageUrl, imageCount,
}: {
  detail: ContentDetail | null;
  onClose: () => void;
  onSave?: (patch: { body: string }) => Promise<void>;
  /**
   * Ask Scribe for a FRESH draft from the item's own source and context.
   *
   * Distinct from `onGenerate`, which fills an empty draft. Regenerating an
   * existing one replaces the body and the trigger records version N+1, so the
   * previous wording stays readable rather than being overwritten.
   */
  onRegenerate?: () => Promise<void>;
  /** Past versions, newest first. Loaded on demand. */
  versions?: ContentVersionRow[];
  onLoadVersions?: () => Promise<void>;
  /**
   * Ask Scribe to write this draft.
   *
   * EXPLICIT, never automatic on create. Generating whenever the create modal
   * is used would spend a model call on every stray click, including the ones
   * that were a mis-tap. The user asks, and pays, deliberately.
   */
  onGenerate?: () => Promise<void>;
  /**
   * Ask for an illustration of the CURRENT text.
   *
   * A separate button and a separate spend on purpose. "Regenerate" rewrites
   * copy and must never quietly buy a new picture, which is the single easiest
   * way for one click to cost twice what the user expected.
   */
  onGenerateImage?: () => Promise<void>;
  /** The current image, already signed. Null while there is none. */
  imageUrl?: string | null;
  /** How many images this draft has had. History is kept; only the pointer moves. */
  imageCount?: number;
}) {
  const editable = typeof onSave === "function";
  const [generating, setGenerating] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [imaging, setImaging] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // The body this editor was last seeded from. Not state — changing it must
  // never itself cause a render.
  const seeded = useRef("");

  // A DIFFERENT draft opened: hard reset. Keyed on id rather than on `detail`,
  // because the parent rebuilds `detail` in a useMemo on every list refresh and
  // depending on the object would wipe what the user has typed each time.
  useEffect(() => {
    const incoming = detail?.body ?? "";
    setDraftBody(incoming);
    seeded.current = incoming;
    setSaveError(null);
    setSavedAt(null);
    setGenError(null);
  }, [detail?.id]);

  // THE SAME draft changed underneath us — which is what generation does: Scribe
  // writes the row server-side and the parent re-reads it, so the id is
  // unchanged and only the body moves. Without this the textarea would keep
  // showing the empty draft and "Draft with Scribe" would look like it did
  // nothing. Adopt ONLY when there is nothing unsaved to lose.
  useEffect(() => {
    const incoming = detail?.body ?? "";
    if (incoming === seeded.current) return;
    setDraftBody((current) => (current === seeded.current ? incoming : current));
    seeded.current = incoming;
  }, [detail?.body]);

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
                    disabled={saving || draftBody === seeded.current}
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
                  {onGenerate && (
                    <button
                      onClick={async () => {
                        if (generating) return;
                        setGenerating(true); setGenError(null);
                        try {
                          await onGenerate();
                        } catch (err) {
                          setGenError(err instanceof Error ? err.message : "Could not generate");
                        } finally {
                          setGenerating(false);
                        }
                      }}
                      disabled={generating}
                      title="Scribe writes a draft here. Nothing publishes."
                      className="h-8 px-3 rounded-lg text-[12.5px] font-medium inline-flex items-center gap-1.5 border border-white/[0.1] hover:border-white/20 bg-white/[0.03] hover:bg-white/[0.06] text-[#C9D1D9] disabled:text-neutral-500 disabled:cursor-not-allowed transition-colors"
                    >
                      {generating
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Sparkles className="h-3.5 w-3.5" />}
                      {generating ? "Scribe is writing…" : "Draft with Scribe"}
                    </button>
                  )}
                  {/* REGENERATE. Offered only once there is something to replace —
                      on an empty draft "Draft with Scribe" is the same action
                      under an honest name. */}
                  {onRegenerate && (detail.body ?? "").trim().length > 0 && (
                    <button
                      onClick={async () => {
                        if (regenerating) return;
                        setRegenerating(true); setGenError(null);
                        try {
                          await onRegenerate();
                        } catch (err) {
                          setGenError(err instanceof Error ? err.message : "Could not regenerate");
                        } finally {
                          setRegenerating(false);
                        }
                      }}
                      disabled={regenerating || generating}
                      title="Scribe writes a new version. The current one is kept in history."
                      className="h-8 px-3 rounded-lg text-[12.5px] font-medium inline-flex items-center gap-1.5 border border-white/[0.1] hover:border-white/20 bg-white/[0.03] hover:bg-white/[0.06] text-[#C9D1D9] disabled:text-neutral-500 disabled:cursor-not-allowed transition-colors"
                    >
                      {regenerating
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <RefreshCw className="h-3.5 w-3.5" />}
                      {regenerating ? "Rewriting…" : "Regenerate"}
                    </button>
                  )}
                  {/* IMAGE. Only once there is copy to illustrate — the server
                      refuses an empty draft with `no_draft_to_illustrate`, and
                      offering a button that is going to be refused is worse
                      than not offering it. */}
                  {onGenerateImage && (detail.body ?? "").trim().length > 0 && (
                    <button
                      onClick={async () => {
                        if (imaging) return;
                        setImaging(true); setGenError(null);
                        try {
                          await onGenerateImage();
                        } catch (err) {
                          setGenError(err instanceof Error ? err.message : "Could not generate an image");
                        } finally {
                          setImaging(false);
                        }
                      }}
                      disabled={imaging || generating || regenerating}
                      title={(imageCount ?? 0) > 0
                        ? "Generate another image. The current one is kept."
                        : "Generate an image for this draft."}
                      className="h-8 px-3 rounded-lg text-[12.5px] font-medium inline-flex items-center gap-1.5 border border-white/[0.1] hover:border-white/20 bg-white/[0.03] hover:bg-white/[0.06] text-[#C9D1D9] disabled:text-neutral-500 disabled:cursor-not-allowed transition-colors"
                    >
                      {imaging
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <ImageIcon className="h-3.5 w-3.5" />}
                      {imaging
                        ? "Generating image…"
                        : (imageCount ?? 0) > 0 ? "New image" : "Generate image"}
                    </button>
                  )}
                  {onLoadVersions && (
                    <button
                      onClick={async () => {
                        const next = !historyOpen;
                        setHistoryOpen(next);
                        if (next) {
                          setHistoryLoading(true);
                          try { await onLoadVersions(); } finally { setHistoryLoading(false); }
                        }
                      }}
                      className="h-8 px-3 rounded-lg text-[12.5px] font-medium inline-flex items-center gap-1.5 border border-white/[0.1] hover:border-white/20 bg-white/[0.03] hover:bg-white/[0.06] text-[#C9D1D9] transition-colors"
                    >
                      <History className="h-3.5 w-3.5" />
                      {historyOpen ? "Hide history" : "History"}
                    </button>
                  )}
                  {genError && (
                    <span className="text-[12px] text-amber-300/90">{genError}</span>
                  )}
                </div>
              </>
            ) : detail.body ? (
              <div className="text-[14px] text-neutral-100 leading-relaxed whitespace-pre-wrap rounded-lg border border-white/[0.06] bg-white/[0.015] p-3.5">{detail.body}</div>
            ) : (
              <p className="text-[13px] text-neutral-500 italic">No draft body yet — Scribe will draft it for your review.</p>
            )}
          </Section>

          {/* ── THE IMAGE ────────────────────────────────────────────────────
              Rendered from a SIGNED url the parent minted. The bucket is
              private — a draft is unpublished work — so there is no public
              link to fall back on, and an expired signature shows the alt
              text rather than a broken-image glyph pretending to be the post. */}
          {imageUrl && (
            <Section title="Image">
              <img
                src={imageUrl}
                alt="Generated illustration for this draft"
                className="w-full max-w-md rounded-lg border border-white/[0.08]"
                loading="lazy"
              />
              {(imageCount ?? 0) > 1 && (
                <p className="mt-2 text-[12px] text-neutral-500">
                  {imageCount} images generated. Earlier ones are kept.
                </p>
              )}
            </Section>
          )}

          {/* ── VERSION HISTORY ──────────────────────────────────────────────
              Read-only, and deliberately so: a version is what the draft said
              at a point in time, and an editable history is not a history.
              Every entry names what produced it, which is the whole reason
              `generation_source` is carried on the row. */}
          {historyOpen && (
            <Section title="History">
              {historyLoading && (
                <p className="text-[13px] text-neutral-500">Loading versions…</p>
              )}
              {!historyLoading && (versions ?? []).length === 0 && (
                <p className="text-[13px] text-neutral-500 italic">No versions recorded yet.</p>
              )}
              <div className="space-y-2">
                {(versions ?? []).map((v) => (
                  <div
                    key={v.id}
                    className={`rounded-lg border p-3 ${
                      v.is_current
                        ? "border-emerald-500/30 bg-emerald-500/[0.06]"
                        : "border-white/[0.06] bg-white/[0.015]"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[12px] font-semibold text-[#C9D1D9]">v{v.version}</span>
                      {v.is_current && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-500/30 text-emerald-300">current</span>
                      )}
                      <span className="text-[11px] text-neutral-500">
                        {LABEL[v.generation_source] ?? v.generation_source}
                      </span>
                      <span className="text-[11px] text-neutral-600 ml-auto">
                        {new Date(v.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-[12.5px] text-neutral-300 leading-relaxed whitespace-pre-wrap line-clamp-4">
                      {v.body || <span className="italic text-neutral-500">empty</span>}
                    </p>
                  </div>
                ))}
              </div>
            </Section>
          )}
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
