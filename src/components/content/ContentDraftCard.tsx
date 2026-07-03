import { ExternalLink } from "lucide-react";

export type DraftStatus = "needs_input" | "draft_ready" | "review_needed" | "approved" | "published" | "blocked";

const STATUS_STYLE: Record<DraftStatus, { label: string; className: string }> = {
  needs_input:   { label: "Needs input",   className: "border-amber-500/30 bg-amber-500/10 text-amber-300" },
  draft_ready:   { label: "Draft ready",   className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
  review_needed: { label: "Review needed", className: "border-sky-500/30 bg-sky-500/10 text-sky-300" },
  approved:      { label: "Approved",      className: "border-primary/30 bg-primary/10 text-primary" },
  published:     { label: "Published",     className: "border-white/15 bg-white/[0.04] text-neutral-300" },
  blocked:       { label: "Blocked",       className: "border-red-500/30 bg-red-500/10 text-red-300" },
};

const dispatchChat = (text: string) =>
  window.dispatchEvent(new CustomEvent("chat:send", { detail: { text } }));

export interface ContentDraftCardProps {
  id: string;
  title: string;
  contentType: string;
  source?: string;
  sourceUrl?: string | null;
  sourceVerified?: boolean;
  status: DraftStatus;
  date?: string | null;
  preview?: string;
  nextAction?: string;
}

export default function ContentDraftCard(p: ContentDraftCardProps) {
  const s = STATUS_STYLE[p.status];
  return (
    <article className="rounded-xl border border-border/70 bg-background/40 p-4 hover:border-primary/30 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="text-[16px] md:text-[17px] font-semibold text-foreground leading-snug">{p.title}</h4>
          <p className="text-[12px] text-muted-foreground mt-1">
            {p.contentType}
            {p.source && <> · Source: {p.source}</>}
            {p.date && <> · {new Date(p.date).toLocaleDateString()}</>}
          </p>
        </div>
        <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full border ${s.className}`}>{s.label}</span>
      </div>

      {p.preview && (
        <p className="text-[14px] text-muted-foreground/90 mt-3 line-clamp-3">{p.preview}</p>
      )}

      {p.sourceUrl ? (
        <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline mt-2">
          <ExternalLink className="h-3 w-3" /> Source proof
          {!p.sourceVerified && <span className="ml-1 text-amber-300">· unverified</span>}
        </a>
      ) : (
        <p className="text-[12px] text-amber-300/80 mt-2">No source proof — use as idea only</p>
      )}

      {p.nextAction && (
        <p className="text-[13px] text-foreground/90 mt-3">
          <span className="text-muted-foreground">Next: </span>{p.nextAction}
        </p>
      )}

      <div className="flex flex-wrap gap-2 mt-3">
        <ActionBtn onClick={() => dispatchChat(`Scribe, open draft "${p.title}".`)}>Open draft</ActionBtn>
        <ActionBtn onClick={() => dispatchChat(`Scribe, ask me for more context on "${p.title}".`)}>Add context</ActionBtn>
        <ActionBtn onClick={() => dispatchChat(`Scribe, improve the hook on "${p.title}" — draft only.`)}>Improve hook</ActionBtn>
        <ActionBtn onClick={() => dispatchChat(`Scribe, turn "${p.title}" into a carousel — draft only.`)}>Turn into carousel</ActionBtn>
        <ActionBtn onClick={() => dispatchChat(`Mark "${p.title}" as reviewed.`)}>Mark reviewed</ActionBtn>
      </div>
    </article>
  );
}

function ActionBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-[13px] font-medium px-2.5 py-1 rounded-md border border-border/70 bg-background/50 text-foreground/90 hover:border-primary/40 hover:text-foreground transition">
      {children}
    </button>
  );
}
