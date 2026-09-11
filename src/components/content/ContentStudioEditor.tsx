// CONTENT STUDIO — ONE DRAFT, EVERYTHING ABOUT IT, IN PLACE.
//
// Replaces the slide-over drawer. The drawer showed the copy and a few buttons;
// what a draft IS — where it came from, whose news it is, who it is for, what
// it is trying to do, every version and every image it has had — was either
// hidden or not shown at all. The Studio shows the canonical object as it is.
//
// It owns no data. The row, its versions and its assets arrive as props from
// the page, which reads them through `contentService`, and every action calls
// back into the page, which calls the service. Nothing here writes Supabase.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2, Sparkles, RefreshCw, Image as ImageIcon, Check, Archive, RotateCcw,
  Save, ExternalLink, Link2, Link2Off,
} from "lucide-react";
import type { ContentItem, ContentItemVersion } from "@/lib/content/contentItems";
import type { ContentAssetRow } from "@/lib/content/contentService";
import type { ContentBriefFields, SignalSubject } from "@/lib/content/contentInstruction";
import {
  briefFieldsOf, deriveHook, describeContentSource, relationshipLabel, studioActions,
  CONTENT_TYPE_LABEL, GENERATION_LABEL, STATUS_LABEL,
} from "@/lib/content/contentStudioModel";

export interface StudioAsset extends ContentAssetRow {
  /** A short-lived signed URL, minted by the page. Null for a failed asset. */
  url: string | null;
}

type Busy = null | "save" | "text" | "image" | "approve" | "archive" | "restore";

export default function ContentStudioEditor({
  item, versions, assets, signal, onSave, onWriteText, onImage, onApprove, onArchive, onRestore,
}: {
  item: ContentItem;
  /** The source signal as the page read it — ownership from the row, not from the draft. */
  signal?: { title: string | null; subject: SignalSubject } | null;
  versions: ContentItemVersion[];
  assets: StudioAsset[];
  onSave: (patch: { body?: string; fields?: ContentBriefFields }) => Promise<void>;
  onWriteText: () => Promise<void>;
  onImage: () => Promise<void>;
  onApprove: () => Promise<void>;
  onArchive: () => Promise<void>;
  onRestore: () => Promise<void>;
}) {
  const [draftBody, setDraftBody] = useState(item.body ?? "");
  const [fields, setFields] = useState(() => briefFieldsOf(item));
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewVersion, setPreviewVersion] = useState<string | null>(null);

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
    setError(null);
    setNotice(null);
    setPreviewVersion(null);
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
  const source = useMemo(() => describeContentSource(item, signal), [item, signal]);
  const hook = deriveHook(draftBody);
  const readyAssets = assets.filter((a) => a.status === "ready");
  const current = assets.find((a) => a.id === item.current_asset_id)
    ?? readyAssets[0] ?? null;
  const actions = studioActions({
    status: item.status, body: draftBody, dirtyBody, dirtyBrief,
    assetCount: readyAssets.length, busy: busy !== null,
  });
  const versionNo = (id: string | null) => versions.find((v) => v.id === id)?.version ?? null;

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
  }, dirtyBody ? "Saved — a new version was recorded." : "Brief saved — the next generation uses it.");

  return (
    <div className="space-y-5">
      {/* ── header: type, status, title ─────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <Pill>{CONTENT_TYPE_LABEL[item.format] ?? item.format}</Pill>
        <Pill tone={item.status === "approved" ? "good" : item.status === "archived" ? "muted" : "accent"}>
          {STATUS_LABEL[item.status] ?? item.status}
        </Pill>
        {item.current_version_id && versionNo(item.current_version_id) !== null && (
          <Pill tone="muted">v{versionNo(item.current_version_id)}</Pill>
        )}
      </div>

      {/* ── SOURCE: where it came from, and whose news it is ────────────── */}
      <Panel title="Source">
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="font-medium text-foreground/90">{source.label}</span>
          {source.kind !== "idea" && (
            source.linked
              ? <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300/80"><Link2 className="h-3 w-3" /> linked</span>
              : <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60"><Link2Off className="h-3 w-3" /> provenance only</span>
          )}
          {relationshipLabel(source.subject) && (
            <span className="rounded-md border border-amber-400/25 bg-amber-500/[0.06] px-1.5 py-0.5 text-[11px] text-amber-200/90">
              About: {relationshipLabel(source.subject)} — not us
            </span>
          )}
        </div>
        {source.about && <p className="mt-1.5 text-[13px] text-muted-foreground/85">{source.about}</p>}
        {source.url && (
          <a href={source.url} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-sky-300 hover:underline break-all">
            <ExternalLink className="h-3 w-3 shrink-0" /> {source.url}
          </a>
        )}
      </Panel>

      {/* ── BRIEF: audience, objective, angle, CTA — feeds the next generation ── */}
      <Panel title="Brief" hint="Used the next time Scribe writes. Author is always us — the Company Brain says who we are.">
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Field label="Audience" value={fields.audience} onChange={(v) => setFields({ ...fields, audience: v })} placeholder="Who is this for?" />
          <Field label="Objective" value={fields.objective} onChange={(v) => setFields({ ...fields, objective: v })} placeholder="What should it achieve?" />
          <Field label="Angle" value={fields.angle} onChange={(v) => setFields({ ...fields, angle: v })} placeholder="Our point of view" />
          <Field label="Call to action" value={fields.cta} onChange={(v) => setFields({ ...fields, cta: v })} placeholder="What should a reader do?" />
        </div>
        <div className="mt-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/55">Hook</p>
          <p className="mt-1 text-[13px] text-foreground/85">{hook ?? <span className="italic text-muted-foreground/55">The draft's opening line appears here.</span>}</p>
        </div>
      </Panel>

      {/* ── DRAFT ───────────────────────────────────────────────────────── */}
      <Panel title="Draft">
        <textarea
          value={draftBody}
          onChange={(e) => { setDraftBody(e.target.value); setNotice(null); }}
          rows={12}
          disabled={item.status === "archived"}
          placeholder="Write your draft, or ask Scribe to draft it. It is saved to this workspace, never posted."
          className="w-full resize-y rounded-lg border border-border/20 bg-background/40 p-3.5 text-[14px] leading-relaxed text-foreground/95 outline-none focus:border-fuchsia-400/30 disabled:opacity-60"
        />
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <ActionButton primary onClick={save} disabled={!actions.save.enabled} busy={busy === "save"} icon={Save}>
            Save
          </ActionButton>
          <ActionButton onClick={() => run("text", onWriteText, "Scribe wrote a new version. The previous one is kept.")}
            disabled={!actions.writeText.enabled} busy={busy === "text"}
            icon={(item.body ?? "").trim() ? RefreshCw : Sparkles} title={actions.writeText.reason ?? undefined}>
            {actions.writeText.label}
          </ActionButton>
          <ActionButton onClick={() => run("image", onImage, "New image ready. The text is unchanged; earlier images are kept.")}
            disabled={!actions.image.enabled} busy={busy === "image"} icon={ImageIcon} title={actions.image.reason ?? undefined}>
            {actions.image.label}
          </ActionButton>
          {item.status !== "archived" && (
            <ActionButton onClick={() => run("approve", onApprove, "Approved. Nothing is posted — publish it yourself.")}
              disabled={!actions.approve.enabled} busy={busy === "approve"} icon={Check}>
              Approve
            </ActionButton>
          )}
          {item.status !== "archived"
            ? (
              <ActionButton onClick={() => run("archive", onArchive, "Archived. Its versions and images stay in History.")}
                disabled={!actions.archive.enabled} busy={busy === "archive"} icon={Archive}>
                Archive
              </ActionButton>
            ) : (
              <ActionButton onClick={() => run("restore", onRestore, "Restored to drafts.")}
                disabled={!actions.restore.enabled} busy={busy === "restore"} icon={RotateCcw}>
                Restore
              </ActionButton>
            )}
        </div>
        {actions.writeText.reason && (dirtyBody || dirtyBrief) && (
          <p className="mt-2 text-[12px] text-muted-foreground/70">{actions.writeText.reason}</p>
        )}
        {notice && !error && <p className="mt-2 text-[12px] text-emerald-300/90">{notice}</p>}
        {error && <p className="mt-2 text-[12px] text-amber-300/90">{error}</p>}
      </Panel>

      {/* ── IMAGE ───────────────────────────────────────────────────────── */}
      <Panel title="Image" hint="Signed, private, short-lived links — drafts are unpublished work.">
        {current?.url ? (
          <img src={current.url} alt="Current image for this draft" loading="lazy"
            className="w-full max-w-md rounded-lg border border-border/20" />
        ) : (
          <p className="text-[13px] italic text-muted-foreground/60">No image yet.</p>
        )}
      </Panel>

      {/* ── VERSION HISTORY — read-only: a history you can edit is not one ─ */}
      <Panel title={`Version history (${versions.length})`}>
        {versions.length === 0 ? (
          <p className="text-[13px] italic text-muted-foreground/60">No versions yet — the first save or generation records one.</p>
        ) : (
          <ul className="space-y-1.5">
            {versions.map((v) => {
              const isCurrent = v.id === item.current_version_id;
              const open = previewVersion === v.id;
              return (
                <li key={v.id} className={`rounded-lg border px-3 py-2 ${isCurrent ? "border-emerald-500/25 bg-emerald-500/[0.05]" : "border-border/15 bg-background/20"}`}>
                  <button className="flex w-full items-center gap-2 text-left" onClick={() => setPreviewVersion(open ? null : v.id)}>
                    <span className="text-[12px] font-semibold text-foreground/90">v{v.version}</span>
                    {isCurrent && <span className="rounded border border-emerald-500/30 px-1 text-[10px] text-emerald-300">current</span>}
                    <span className="text-[11px] text-muted-foreground/70">{GENERATION_LABEL[v.generation_source] ?? v.generation_source}</span>
                    {v.model && <span className="text-[11px] text-muted-foreground/50">{[v.provider, v.model].filter(Boolean).join(" / ")}</span>}
                    <span className="ml-auto text-[11px] text-muted-foreground/50">{new Date(v.created_at).toLocaleString()}</span>
                  </button>
                  {open && (
                    <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground/85">
                      {v.body || <span className="italic">empty</span>}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {/* ── ASSET HISTORY — every image kept; only the pointer moves ─────── */}
      <Panel title={`Asset history (${assets.length})`}>
        {assets.length === 0 ? (
          <p className="text-[13px] italic text-muted-foreground/60">No images generated for this draft.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {assets.map((a) => (
              <li key={a.id} className={`rounded-lg border p-2 ${a.id === current?.id ? "border-emerald-500/25" : "border-border/15"}`}>
                {a.url
                  ? <img src={a.url} alt="Earlier image for this draft" loading="lazy" className="aspect-square w-full rounded-md object-cover" />
                  : <div className="flex aspect-square w-full items-center justify-center rounded-md bg-background/30 text-[11px] text-muted-foreground/60">{a.status === "failed" ? `Failed: ${a.failure_reason ?? "unknown"}` : a.status}</div>}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground/65">
                  {a.id === current?.id && <span className="rounded border border-emerald-500/30 px-1 text-[10px] text-emerald-300">current</span>}
                  {versionNo(a.content_version_id) !== null && <span>for v{versionNo(a.content_version_id)}</span>}
                  {a.model && <span>{[a.provider, a.model].filter(Boolean).join(" / ")}</span>}
                  <span className="ml-auto">{new Date(a.created_at).toLocaleDateString()}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <p className="text-[12px] text-muted-foreground/55">Agentory never posts for you. Approve here, then publish it yourself.</p>
    </div>
  );
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border/15 bg-card/[0.08] p-4">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">{title}</h3>
        {hint && <span className="text-[11px] text-muted-foreground/45">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/55">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-border/20 bg-background/40 px-2.5 py-1.5 text-[13px] text-foreground/90 outline-none focus:border-fuchsia-400/30" />
    </label>
  );
}

function Pill({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "accent" | "good" | "muted" }) {
  const cls = {
    default: "border-border/25 bg-background/30 text-foreground/80",
    accent: "border-fuchsia-400/25 bg-fuchsia-500/10 text-fuchsia-200",
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    muted: "border-border/20 bg-background/20 text-muted-foreground/70",
  }[tone];
  return <span className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>;
}

function ActionButton({ children, onClick, disabled, busy, icon: Icon, primary, title }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; busy?: boolean;
  icon: React.ComponentType<{ className?: string }>; primary?: boolean; title?: string;
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium transition-colors disabled:cursor-not-allowed ${
        primary
          ? "bg-fuchsia-500/80 text-white hover:bg-fuchsia-500 disabled:bg-background/40 disabled:text-muted-foreground/50"
          : "border border-border/25 bg-background/30 text-foreground/85 hover:border-border/45 disabled:text-muted-foreground/45"
      }`}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}
