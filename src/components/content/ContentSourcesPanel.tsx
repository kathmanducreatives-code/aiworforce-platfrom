// SOURCES — where a draft starts, and the drafts you already have.
//
// Five lists, one at a time: your Drafts, then the four places content comes
// from — For You, Trends, Comment Opportunities, Saved Ideas. A source card
// carries what a decision needs (what, whose, why, which angle, how relevant)
// and one action. Which agent found or ranked it is behind "Why this?".
//
// Selecting a source opens it in the Studio. Nothing here writes; the page
// owns every action and every write goes through `contentService`.

import { useState } from "react";
import { Plus, Info, Search, Archive } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ContentItem } from "@/lib/content/contentItems";
import {
  CONTENT_TYPE_LABEL, STATUS_LABEL, describeContentSource, sourceCardOf, type SourceSignalLike,
} from "@/lib/content/contentStudioModel";

export type SourceNav = "drafts" | "foryou" | "trends" | "comments" | "ideas";

const NAV: { id: SourceNav; label: string }[] = [
  { id: "drafts", label: "Drafts" },
  { id: "foryou", label: "For You" },
  { id: "trends", label: "Trends" },
  { id: "comments", label: "Comments" },
  { id: "ideas", label: "Ideas" },
];

export interface CommentSource { id: string; title: string; status: string | null; preview?: string; canonical: boolean }

export default function ContentSourcesPanel({
  nav, onNav, items, openId, onOpenItem, forYou, trends, ideas, comments,
  selectedSignalId, onSelectSignal, onNewIdea, onFindComments, commentDiscoveryReady, loading,
}: {
  nav: SourceNav;
  onNav: (n: SourceNav) => void;
  items: ContentItem[];
  openId: string | null;
  onOpenItem: (id: string) => void;
  forYou: SourceSignalLike[];
  trends: SourceSignalLike[];
  ideas: SourceSignalLike[];
  comments: CommentSource[];
  selectedSignalId: string | null;
  onSelectSignal: (s: SourceSignalLike) => void;
  onNewIdea: () => void;
  onFindComments: () => void;
  commentDiscoveryReady: boolean;
  loading: boolean;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const drafts = items.filter((it) => showArchived || it.status !== "archived");

  return (
    <div className="flex h-full flex-col">
      <nav className="flex flex-wrap gap-1 px-1" aria-label="Sources">
        {NAV.map((n) => (
          <button key={n.id} onClick={() => onNav(n.id)} aria-current={nav === n.id ? "page" : undefined}
            className={`rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition-colors ${
              nav === n.id ? "bg-white/[0.08] text-foreground" : "text-muted-foreground/65 hover:text-foreground/90"
            }`}>
            {n.label}
          </button>
        ))}
      </nav>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pb-6 pr-1">
        {loading && <p className="px-2 text-[12.5px] text-muted-foreground/55">Loading…</p>}

        {!loading && nav === "drafts" && (
          <div>
            <ul className="space-y-0.5">
              {drafts.length === 0 && <li className="px-2 py-3 text-[12.5px] text-muted-foreground/60">No drafts yet. Pick a source or start from an idea.</li>}
              {drafts.map((it) => {
                const src = describeContentSource(it);
                return (
                  <li key={it.id}>
                    <button onClick={() => onOpenItem(it.id)} aria-current={it.id === openId ? "true" : undefined}
                      className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors ${
                        it.id === openId ? "bg-white/[0.07]" : "hover:bg-white/[0.035]"
                      }`}>
                      <span className="flex items-center gap-2">
                        <StatusDot status={it.status} />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground/90">{it.title || "Untitled draft"}</span>
                      </span>
                      <span className="mt-0.5 block truncate pl-4 text-[11.5px] text-muted-foreground/55">
                        {STATUS_LABEL[it.status] ?? it.status} · {CONTENT_TYPE_LABEL[it.format] ?? it.format} · {src.label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <button onClick={() => setShowArchived((v) => !v)}
              className="mt-3 inline-flex items-center gap-1.5 px-3 text-[12px] text-muted-foreground/55 hover:text-foreground/80">
              <Archive className="h-3 w-3" /> {showArchived ? "Hide archived" : "Show archived"}
            </button>
          </div>
        )}

        {!loading && (nav === "foryou" || nav === "trends" || nav === "ideas") && (
          <div className="space-y-2">
            {nav === "ideas" && (
              <button onClick={onNewIdea}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium text-foreground/90 hover:bg-white/[0.04]">
                <Plus className="h-3.5 w-3.5" /> Start from your own idea
              </button>
            )}
            {(nav === "foryou" ? forYou : nav === "trends" ? trends : ideas).map((s) => (
              <SourceCardView key={s.id} signal={s} selected={s.id === selectedSignalId} onSelect={() => onSelectSignal(s)} />
            ))}
            {(nav === "foryou" ? forYou : nav === "trends" ? trends : ideas).length === 0 && (
              <p className="px-3 py-3 text-[12.5px] text-muted-foreground/60">
                {nav === "ideas" ? "Signals you save appear here." : "Nothing ranked yet — signals appear here once Radar has run."}
              </p>
            )}
          </div>
        )}

        {!loading && nav === "comments" && (
          <div className="space-y-1">
            {comments.length === 0 && (
              <p className="px-3 py-3 text-[12.5px] text-muted-foreground/60">
                {commentDiscoveryReady ? "No comment opportunities yet." : "Connect LinkedIn discovery to find posts worth commenting on."}
              </p>
            )}
            {comments.map((c) => (
              <button key={c.id} onClick={() => c.canonical && onOpenItem(c.id)} disabled={!c.canonical}
                title={c.canonical ? undefined : "Written before drafts were versioned — read-only"}
                className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors ${
                  c.id === openId ? "bg-white/[0.07]" : "hover:bg-white/[0.035]"
                } disabled:cursor-default disabled:opacity-70`}>
                <span className="block truncate text-[13px] font-medium text-foreground/90">{c.title}</span>
                {c.preview && <span className="mt-0.5 line-clamp-2 block text-[12px] text-muted-foreground/60">{c.preview}</span>}
              </button>
            ))}
            {commentDiscoveryReady && (
              <button onClick={onFindComments}
                className="mt-2 inline-flex items-center gap-1.5 px-3 text-[12.5px] text-muted-foreground/70 hover:text-foreground">
                <Search className="h-3.5 w-3.5" /> Find posts to comment on
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SourceCardView({ signal, selected, onSelect }: { signal: SourceSignalLike; selected: boolean; onSelect: () => void }) {
  const c = sourceCardOf(signal);
  return (
    <div className={`group rounded-xl px-3.5 py-3 transition-colors ${selected ? "bg-white/[0.07]" : "hover:bg-white/[0.035]"}`}>
      <button onClick={onSelect} className="block w-full text-left" aria-pressed={selected}>
        <p className="line-clamp-2 text-[13.5px] font-medium leading-snug text-foreground/95">{c.title}</p>
        <p className="mt-1 truncate text-[11.5px] text-muted-foreground/60">
          {[c.about, c.relevance !== null ? `Relevance ${c.relevance}` : null].filter(Boolean).join(" · ")}
        </p>
        {c.context && <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground/70">{c.context}</p>}
        {c.angle && <p className="mt-1.5 line-clamp-2 text-[12.5px] text-foreground/75"><span className="text-muted-foreground/55">Angle · </span>{c.angle}</p>}
      </button>
      <div className="mt-2 flex items-center gap-3">
        <button onClick={onSelect} className="text-[12.5px] font-medium text-foreground hover:underline">Open in Studio</button>
        {c.why.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <button className="inline-flex items-center gap-1 text-[12px] text-muted-foreground/55 hover:text-foreground/80">
                <Info className="h-3 w-3" /> Why this?
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 text-[12.5px]">
              <ul className="space-y-1.5 text-muted-foreground">
                {c.why.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const cls = status === "approved" ? "bg-emerald-400/80" : status === "archived" ? "bg-white/20" : "bg-violet-400/80";
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${cls}`} aria-hidden />;
}
