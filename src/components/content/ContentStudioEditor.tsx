// CONTENT STUDIO — THE DRAFT, AND ONLY WHAT SERVES IT.
//
// The centre of the page. One content object: its strategy (audience,
// objective, angle, CTA), its hook, the draft, its visual, and the actions that
// move it towards approval. History and Scribe live in the side panel; they are
// context for this, not competitors with it.
//
// It owns no data. The row, its versions and its current image arrive as props
// from the page, which reads them through `contentService`; every action calls
// back into the page, which calls the service. Local state is only the unsaved
// editing buffer — reload the page and what you see is what is persisted.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2, Sparkles, RefreshCw, Image as ImageIcon, Check, Archive, RotateCcw, Save,
  ChevronDown, MoreHorizontal, Eye, ExternalLink,
} from "lucide-react";
import type { ContentItem, ContentItemVersion } from "@/lib/content/contentItems";
import type { ContentAssetRow } from "@/lib/content/contentService";
import type { ContentBriefFields, SignalSubject } from "@/lib/content/contentInstruction";
import {
  briefFieldsOf, deriveHook, describeContentSource, studioActions, versionLabel,
  CONTENT_TYPE_LABEL, STATUS_LABEL,
} from "@/lib/content/contentStudioModel";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "@/components/content/studioStyles";

// The Leads/Signals look, shared with the rest of the Content page — see studioStyles.

export interface StudioAsset extends ContentAssetRow {
  /** A short-lived signed URL, minted by the page. Null for a failed asset. */
  url: string | null;
}

type Busy = null | "save" | "text" | "image" | "approve" | "archive" | "restore";

export default function ContentStudioEditor({
  item, versions, assets, signal, preview, onExitPreview,
  onSave, onWriteText, onImage, onApprove, onArchive, onRestore, onDirtyChange,
}: {
  item: ContentItem;
  versions: ContentItemVersion[];
  assets: StudioAsset[];
  /** The source signal as the page read it — ownership from the row, not from the draft. */
  signal?: { title: string | null; subject: SignalSubject } | null;
  /** An older version being looked at. Read-only; it never becomes current by being viewed. */
  preview?: ContentItemVersion | null;
  onExitPreview?: () => void;
  onSave: (patch: { body?: string; fields?: ContentBriefFields }) => Promise<void>;
  onWriteText: () => Promise<void>;
  onImage: () => Promise<void>;
  onApprove: () => Promise<void>;
  onArchive: () => Promise<void>;
  onRestore: () => Promise<void>;
  /** Lets the page (and Scribe) know an unsaved edit exists, so nothing overwrites it. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [draftBody, setDraftBody] = useState(item.body ?? "");
  const [fields, setFields] = useState(() => briefFieldsOf(item));
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // What the editor was last seeded from — not state, so it never renders.
  const seeded = useRef(item.body ?? "");
  const seededFields = useRef(briefFieldsOf(item));

  // A DIFFERENT draft opened: hard reset.
  useEffect(() => {
    const incoming = item.body ?? "";
    setDraftBody(incoming);
    seeded.current = incoming;
    const f = briefFieldsOf(item);
    setFields(f);
    seededFields.current = f;
    setStrategyOpen(false);
    setError(null);
    setNotice(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  // THE SAME draft changed underneath us — Scribe writes the row server-side
  // and the page re-reads it. Adopt the new copy ONLY when nothing is unsaved.
  useEffect(() => {
    const incoming = item.body ?? "";
    if (incoming === seeded.current) return;
    setDraftBody((current) => (current === seeded.current ? incoming : current));
    seeded.current = incoming;
  }, [item.body]);

  const dirtyBody = draftBody !== seeded.current;
  const dirtyBrief = JSON.stringify(fields) !== JSON.stringify(seededFields.current);
  useEffect(() => { onDirtyChange?.(dirtyBody || dirtyBrief); }, [dirtyBody, dirtyBrief, onDirtyChange]);

  const source = useMemo(() => describeContentSource(item, signal), [item, signal]);
  const readyAssets = assets.filter((a) => a.status === "ready");
  const current = assets.find((a) => a.id === item.current_asset_id) ?? readyAssets[0] ?? null;
  const previewing = !!preview && preview.id !== item.current_version_id;
  const shownBody = previewing ? preview!.body : draftBody;
  const hook = deriveHook(shownBody);
  const actions = studioActions({
    status: item.status, body: draftBody, dirtyBody, dirtyBrief,
    assetCount: readyAssets.length, busy: busy !== null || previewing,
  });
  const versionNo = (id: string | null) => versions.find((v) => v.id === id)?.version ?? null;
  const strategySummary = [fields.audience, fields.objective, fields.angle].filter(Boolean).join(" · ");

  const run = async (kind: Exclude<Busy, null>, fn: () => Promise<void>, done?: string) => {
    if (busy) return;
    setBusy(kind); setError(null); setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
    } catch (err) {
      // The user's text stays in the editor. A failed write must never look
      // like a successful one, and must never cost them what they typed.
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

  const save = () => run("save", async () => {
    await onSave({
      ...(dirtyBody ? { body: draftBody } : {}),
      ...(dirtyBrief ? { fields } : {}),
    });
    if (dirtyBody) seeded.current = draftBody;
    if (dirtyBrief) seededFields.current = fields;
  }, dirtyBody ? "Saved as a new version." : "Strategy saved — the next generation uses it.");

  return (
    <article className="flex min-h-full flex-col">
      {/* ── meta: type, status, source, whose news ─────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-muted-foreground/70">
        <span>{CONTENT_TYPE_LABEL[item.format] ?? item.format}</span>
        <Dot />
        <StatusText status={item.status} />
        {versionNo(item.current_version_id) !== null && (<><Dot /><span>v{versionNo(item.current_version_id)}</span></>)}
        <Dot />
        <span className="min-w-0 truncate">{source.label}{source.about ? ` — ${source.about}` : ""}</span>
        {source.subject && source.kind !== "idea" && (
          <span className="rounded-md border border-white/[0.06] bg-white/[0.03] px-1.5 py-0.5 text-[11px] text-muted-foreground/85">
            About: {subjectText(source.subject)} — not us
          </span>
        )}
        {source.url && (
          <a href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground/70 hover:text-foreground">
            <ExternalLink className="h-3 w-3" /> post
          </a>
        )}
      </div>

      {/* ── version preview banner ──────────────────────────────────────── */}
      {previewing && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-2.5 text-[13px] backdrop-blur-xl">
          <span className="inline-flex items-center gap-2 text-foreground/85">
            <Eye className="h-3.5 w-3.5" />
            Viewing v{preview!.version} · {versionLabel(preview!)} — not the current version
          </span>
          <button onClick={onExitPreview} className="text-[12.5px] font-medium text-foreground hover:underline">Back to current</button>
        </div>
      )}

      {/* ── strategy: compact until opened ──────────────────────────────── */}
      {!previewing && (
        <section className="mt-6">
          <button onClick={() => setStrategyOpen((v) => !v)} aria-expanded={strategyOpen}
            className="flex w-full items-center justify-between gap-3 text-left">
            <span className="flex min-w-0 items-baseline gap-3">
              <span className="shrink-0 text-[12px] font-medium text-muted-foreground/70">Strategy</span>
              <span className="truncate text-[13px] text-muted-foreground/80">
                {strategySummary || "Audience, objective, angle and call to action"}
              </span>
            </span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform ${strategyOpen ? "rotate-180" : ""}`} />
          </button>
          {strategyOpen && (
            <div className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <Field label="Audience" value={fields.audience} onChange={(v) => setFields({ ...fields, audience: v })} placeholder="Who is this for?" />
              <Field label="Objective" value={fields.objective} onChange={(v) => setFields({ ...fields, objective: v })} placeholder="What should it achieve?" />
              <Field label="Angle" value={fields.angle} onChange={(v) => setFields({ ...fields, angle: v })} placeholder="Our point of view" />
              <Field label="Call to action" value={fields.cta} onChange={(v) => setFields({ ...fields, cta: v })} placeholder="What should a reader do?" />
              <p className="text-[12px] text-muted-foreground/55 sm:col-span-2">
                Scribe writes as us — the Company Brain says who we are. Saved strategy is used the next time Scribe writes.
              </p>
            </div>
          )}
        </section>
      )}

      {/* ── hook ────────────────────────────────────────────────────────── */}
      <section className="mt-7">
        <p className="text-[12px] font-medium text-muted-foreground/70">Hook</p>
        <p className="mt-2 text-[19px] font-semibold leading-snug tracking-[-0.01em] text-foreground">
          {hook ?? <span className="font-normal text-muted-foreground/50">The draft's opening line appears here.</span>}
        </p>
      </section>

      {/* ── the draft — the thing this page exists for ──────────────────── */}
      <section className="mt-5">
        <textarea
          value={shownBody}
          readOnly={previewing || item.status === "archived"}
          onChange={(e) => { setDraftBody(e.target.value); setNotice(null); }}
          rows={14}
          placeholder="Write your draft, or ask Scribe to draft it. It is saved to this workspace — never posted."
          aria-label="Draft"
          className={`w-full resize-y rounded-xl border border-white/[0.06] bg-white/[0.02] px-5 py-4 text-[15px] leading-[1.7] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] outline-none backdrop-blur-xl transition focus:border-emerald-500/30 focus:ring-1 focus:ring-emerald-500/20 ${
            previewing ? "text-foreground/70" : "text-foreground/95"
          }`}
        />
      </section>

      {/* ── visual ──────────────────────────────────────────────────────── */}
      {!previewing && (
        <section className="mt-6">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-medium text-muted-foreground/70">Visual</p>
            {readyAssets.length > 1 && <span className="text-[12px] text-muted-foreground/55">{readyAssets.length} images · earlier ones kept</span>}
          </div>
          {current?.url ? (
            <img src={current.url} alt="Current image for this draft" loading="lazy"
              className="mt-3 w-full max-w-[420px] rounded-xl border border-white/[0.06]" />
          ) : (
            <div className="mt-3 flex max-w-[420px] items-center justify-between gap-3 rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] px-4 py-5">
              <span className="text-[13px] text-muted-foreground/65">No visual yet.</span>
              <ActionButton onClick={() => run("image", onImage, "Image ready. The text is unchanged.")}
                disabled={!actions.image.enabled} busy={busy === "image"} icon={ImageIcon} title={actions.image.reason ?? undefined}>
                Generate image
              </ActionButton>
            </div>
          )}
        </section>
      )}

      {/* ── actions: one bar, the primary one obvious ───────────────────── */}
      <div className="sticky bottom-0 mt-8 flex flex-wrap items-center gap-2 bg-gradient-to-t from-background via-background/95 to-transparent pb-2 pt-5">
        <ActionButton primary onClick={save} disabled={!actions.save.enabled} busy={busy === "save"} icon={Save}>
          Save
        </ActionButton>
        <ActionButton onClick={() => run("text", onWriteText, "Scribe wrote a new version. The previous one is kept.")}
          disabled={!actions.writeText.enabled} busy={busy === "text"}
          icon={(item.body ?? "").trim() ? RefreshCw : Sparkles} title={actions.writeText.reason ?? undefined}>
          {actions.writeText.label}
        </ActionButton>
        {readyAssets.length > 0 && (
          <ActionButton onClick={() => run("image", onImage, "New image ready. The text is unchanged; earlier images are kept.")}
            disabled={!actions.image.enabled} busy={busy === "image"} icon={ImageIcon} title={actions.image.reason ?? undefined}>
            {actions.image.label}
          </ActionButton>
        )}
        {item.status !== "archived" && (
          <ActionButton onClick={() => run("approve", onApprove, "Approved. Nothing is posted — publish it yourself.")}
            disabled={!actions.approve.enabled} busy={busy === "approve"} icon={Check}>
            Approve
          </ActionButton>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button aria-label="More actions" className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-muted-foreground/70 hover:border-white/[0.08] hover:bg-white/[0.04] hover:text-foreground">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {item.status !== "archived" ? (
              <DropdownMenuItem disabled={!actions.archive.enabled}
                onSelect={() => run("archive", onArchive, "Archived. Its versions and images stay in History.")}>
                <Archive className="mr-2 h-3.5 w-3.5" /> Archive
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem disabled={!actions.restore.enabled}
                onSelect={() => run("restore", onRestore, "Restored to drafts.")}>
                <RotateCcw className="mr-2 h-3.5 w-3.5" /> Restore
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="basis-full text-[12px]" aria-live="polite">
          {actions.writeText.reason && (dirtyBody || dirtyBrief) && !previewing && (
            <p className="text-muted-foreground/65">{actions.writeText.reason}</p>
          )}
          {notice && !error && <p className="text-emerald-300/85">{notice}</p>}
          {error && <p className="text-amber-300/90">{error}</p>}
        </div>
      </div>
    </article>
  );
}

function subjectText(s: SignalSubject): string {
  const base = { competitor: "Competitor", external_company: "Company", market: "Market trend", external: "External" }[s.relationship];
  return s.name ? `${base} · ${s.name}` : base;
}

function Dot() { return <span className="h-0.5 w-0.5 shrink-0 rounded-full bg-muted-foreground/40" aria-hidden />; }

function StatusText({ status }: { status: string }) {
  const tone = status === "approved" ? "text-emerald-300/85" : status === "archived" ? "text-muted-foreground/50" : "text-foreground/80";
  return <span className={tone}>{STATUS_LABEL[status] ?? status}</span>;
}

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <label className="block">
      <span className="text-[12px] text-muted-foreground/65">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="mt-1.5 w-full rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[13.5px] text-foreground/90 outline-none placeholder:text-muted-foreground/40 focus:border-emerald-500/30 focus:ring-1 focus:ring-emerald-500/20" />
    </label>
  );
}

function ActionButton({ children, onClick, disabled, busy, icon: Icon, primary, title }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; busy?: boolean;
  icon: React.ComponentType<{ className?: string }>; primary?: boolean; title?: string;
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-colors disabled:cursor-not-allowed ${
        primary
          ? PRIMARY_BUTTON
          : SECONDARY_BUTTON
      }`}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}
