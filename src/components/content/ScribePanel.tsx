// SCRIBE — CONTENT STRATEGIST. The side panel, about the draft you are editing.
//
// One Content employee, one name. The page used to host "Mira" here — but in
// the product's own registry Mira is the OUTREACH writer (Penn), while every
// Content generation runs on Scribe. So this panel is Scribe, and it works on
// the open draft:
//
//   Scribe    contextual revisions ("Improve hook", "Make more concise", …) and
//             "Ask Scribe…" — each a typed revision on the one generation path,
//             written as a new version. "Generate visual" is the image operation.
//   History   this draft's versions and images. Viewing an old version never
//             makes it current; nothing here can overwrite either.
//
// Collapsible to a thin rail so the editor can take the whole width.

import { useState } from "react";
import {
  PanelRightClose, PanelRightOpen, Sparkles, History as HistoryIcon, Loader2, ArrowUp,
  Image as ImageIcon,
} from "lucide-react";
import type { ContentItem, ContentItemVersion } from "@/lib/content/contentItems";
import type { StudioAsset } from "@/components/content/ContentStudioEditor";
import { SCRIBE_ACTIONS, versionLabel } from "@/lib/content/contentStudioModel";
import scribeImg from "@/assets/agents/scribe.webp";

type Tab = "scribe" | "history";

export default function ScribePanel({
  collapsed, onToggle, item, dirty, versions, assets, previewId, onPreview, onRevise, onImage,
}: {
  collapsed: boolean;
  onToggle: () => void;
  item: ContentItem | null;
  /** An unsaved edit exists: Scribe would write over it, so it waits. */
  dirty: boolean;
  versions: ContentItemVersion[];
  assets: StudioAsset[];
  previewId: string | null;
  onPreview: (v: ContentItemVersion | null) => void;
  onRevise: (revision: string) => Promise<void>;
  onImage: () => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>("scribe");
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (collapsed) {
    return (
      <aside className="flex h-full w-12 shrink-0 flex-col items-center gap-2 border-l border-white/[0.05] py-4">
        <button onClick={onToggle} aria-label="Open Scribe panel" title="Open Scribe"
          className="rounded-lg p-2 text-muted-foreground/70 hover:bg-white/[0.05] hover:text-foreground">
          <PanelRightOpen className="h-4 w-4" />
        </button>
        <button onClick={() => { setTab("scribe"); onToggle(); }} aria-label="Scribe" title="Scribe"
          className="rounded-lg p-2 text-muted-foreground/60 hover:text-foreground"><Sparkles className="h-4 w-4" /></button>
        <button onClick={() => { setTab("history"); onToggle(); }} aria-label="History" title="History"
          className="rounded-lg p-2 text-muted-foreground/60 hover:text-foreground"><HistoryIcon className="h-4 w-4" /></button>
      </aside>
    );
  }

  const hasCopy = !!item && (item.body ?? "").trim().length > 0;
  const blocked = !item ? "Open a draft — Scribe works on the one you are editing."
    : item.status === "archived" ? "This draft is archived. Restore it to keep working."
    : dirty ? "Save your edit first — Scribe would write over it."
    : null;

  const run = async (key: string, fn: () => Promise<void>, done: string) => {
    if (busy) return;
    setBusy(key); setError(null); setNotice(null);
    try { await fn(); setNotice(done); }
    catch (e) { setError(e instanceof Error ? e.message : "Something went wrong"); }
    finally { setBusy(null); }
  };

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-white/[0.05]" aria-label="Scribe panel">
      {/* identity + tabs */}
      <div className="flex items-center gap-3 px-4 pb-3 pt-4">
        <img src={scribeImg} alt="" className="h-8 w-8 rounded-full object-cover ring-1 ring-white/10" />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-[13.5px] font-semibold text-foreground">Scribe</p>
          <p className="text-[11.5px] text-muted-foreground/65">Content Strategist</p>
        </div>
        <button onClick={onToggle} aria-label="Collapse Scribe panel" title="Collapse"
          className="rounded-lg p-1.5 text-muted-foreground/60 hover:bg-white/[0.05] hover:text-foreground">
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>
      <div className="mx-4 flex gap-1 rounded-lg bg-white/[0.03] p-0.5" role="tablist">
        {(["scribe", "history"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`flex-1 rounded-md py-1.5 text-[12.5px] font-medium transition-colors ${
              tab === t ? "bg-white/[0.08] text-foreground" : "text-muted-foreground/65 hover:text-foreground/85"
            }`}>
            {t === "scribe" ? "Scribe" : `History${versions.length ? ` · ${versions.length}` : ""}`}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-4">
        {tab === "scribe" ? (
          <div className="space-y-5">
            {item && (
              <p className="text-[12.5px] leading-relaxed text-muted-foreground/70">
                Working on <span className="text-foreground/85">{item.title || "this draft"}</span>.
                Each change is a new version — nothing is lost.
              </p>
            )}
            <div className="space-y-1">
              {SCRIBE_ACTIONS.map((a) => {
                // Every action needs copy: a revision edits it, a visual illustrates it.
                const disabled = !!blocked || !!busy || !hasCopy;
                return (
                  <button key={a.id} disabled={disabled}
                    onClick={() => a.revision
                      ? run(a.id, () => onRevise(a.revision!), "Scribe wrote a new version.")
                      : run(a.id, onImage, "New image ready. The text is unchanged.")}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-foreground/85 transition-colors hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:text-muted-foreground/40 disabled:hover:bg-transparent">
                    {busy === a.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : a.id === "visual" ? <ImageIcon className="h-3.5 w-3.5 text-muted-foreground/70" /> : <Sparkles className="h-3.5 w-3.5 text-muted-foreground/70" />}
                    {a.label}
                  </button>
                );
              })}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const text = ask.trim();
                if (!text) return;
                void run("ask", async () => { await onRevise(text); setAsk(""); }, "Scribe wrote a new version.");
              }}
              className="rounded-xl bg-white/[0.03] ring-1 ring-white/[0.06] focus-within:ring-white/[0.14]">
              <textarea value={ask} onChange={(e) => setAsk(e.target.value)} rows={3}
                disabled={!!blocked || !hasCopy}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement)?.requestSubmit(); } }}
                placeholder={hasCopy ? "Ask Scribe… e.g. “open with the customer’s pain”" : "Ask Scribe once there is a draft."}
                aria-label="Ask Scribe"
                className="block w-full resize-none bg-transparent px-3 pt-2.5 text-[13px] text-foreground/90 outline-none placeholder:text-muted-foreground/40 disabled:cursor-not-allowed" />
              <div className="flex justify-end px-2 pb-2">
                <button type="submit" disabled={!!blocked || !ask.trim() || !!busy} aria-label="Send to Scribe"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-violet-500 text-white disabled:bg-white/[0.06] disabled:text-muted-foreground/40">
                  {busy === "ask" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
                </button>
              </div>
            </form>
            <div className="text-[12px]" aria-live="polite">
              {blocked && <p className="text-muted-foreground/60">{blocked}</p>}
              {!blocked && !hasCopy && item && <p className="text-muted-foreground/60">Draft the post first — then Scribe can revise it.</p>}
              {notice && !error && <p className="text-emerald-300/85">{notice}</p>}
              {error && <p className="text-amber-300/90">{error}</p>}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {!item ? (
              <p className="text-[12.5px] text-muted-foreground/60">Open a draft to see its history.</p>
            ) : (
              <>
                <section>
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/55">Versions</p>
                  {versions.length === 0 && <p className="text-[12.5px] text-muted-foreground/60">No versions yet.</p>}
                  <ul className="space-y-0.5">
                    {versions.map((v) => {
                      const isCurrent = v.id === item.current_version_id;
                      const selected = previewId === v.id;
                      return (
                        <li key={v.id}>
                          <button onClick={() => onPreview(isCurrent || selected ? null : v)}
                            aria-current={isCurrent ? "true" : undefined}
                            className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${
                              selected ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"
                            }`}>
                            <span className="flex items-center gap-2 text-[12.5px]">
                              <span className="font-semibold text-foreground/90">v{v.version}</span>
                              {isCurrent && <span className="text-[11px] text-violet-300">current</span>}
                              <span className="ml-auto text-[11px] text-muted-foreground/50">{new Date(v.created_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</span>
                            </span>
                            <span className="mt-0.5 block truncate text-[12px] text-muted-foreground/70">{versionLabel(v)}</span>
                            {v.model && (
                              <span className="block truncate text-[11px] text-muted-foreground/45">{[v.provider, v.model].filter(Boolean).join(" / ")}</span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
                <section>
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/55">Images</p>
                  {assets.length === 0 && <p className="text-[12.5px] text-muted-foreground/60">No images yet.</p>}
                  <ul className="grid grid-cols-2 gap-2">
                    {assets.map((a) => {
                      const isCurrent = a.id === item.current_asset_id;
                      const forV = versions.find((v) => v.id === a.content_version_id)?.version;
                      return (
                        <li key={a.id} className="min-w-0">
                          {a.url
                            ? <img src={a.url} alt={isCurrent ? "Current image" : "Earlier image"} loading="lazy"
                                className={`aspect-square w-full rounded-lg object-cover ${isCurrent ? "ring-1 ring-violet-400/60" : "ring-1 ring-white/[0.06]"}`} />
                            : <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-white/[0.03] p-2 text-center text-[10.5px] leading-snug text-muted-foreground/55" title={a.failure_reason ?? undefined}>
                                {a.status === "failed" ? "Failed" : a.status}
                              </div>}
                          <p className="mt-1 truncate text-[11px] text-muted-foreground/55">
                            {isCurrent ? "current · " : ""}{forV ? `v${forV} · ` : ""}{new Date(a.created_at).toLocaleDateString()}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
