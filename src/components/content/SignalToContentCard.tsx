import { AlertTriangle, ExternalLink } from "lucide-react";
import type { FeedSignal } from "@/lib/signalFeedModel";

const dispatchChat = (text: string) =>
  window.dispatchEvent(new CustomEvent("chat:send", { detail: { text } }));

export default function SignalToContentCard({ signal }: { signal: FeedSignal }) {
  const verified = Boolean((signal as any).verified ?? signal.source_url);
  const priority = (signal as any).priority ?? "normal";
  const why = (signal as any).why_it_matters ?? signal.description ?? "";
  const type = signal.signal_type ?? "signal";
  const title = signal.title ?? signal.signal_label ?? "Signal";

  const turnInto = (kind: "post" | "comment") => {
    if (!verified) {
      const ok = window.confirm("This signal is unverified. Continue as idea only?");
      if (!ok) return;
    }
    dispatchChat(`Scribe, turn signal "${title}" into a ${kind} — draft only.${signal.source_url ? ` Source: ${signal.source_url}` : ""}`);
  };

  return (
    <article className="rounded-xl border border-border/70 bg-background/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="text-[16px] font-semibold text-foreground leading-snug">{title}</h4>
          <p className="text-[12px] text-muted-foreground mt-1">
            {type}
            {signal.created_at && <> · {new Date(signal.created_at).toLocaleDateString()}</>}
            {" · "}priority: <span className="text-foreground/80">{priority}</span>
          </p>
        </div>
        {!verified && (
          <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300">
            <AlertTriangle className="h-3 w-3" /> Needs verification
          </span>
        )}
      </div>

      {why && <p className="text-[14px] text-muted-foreground/90 mt-3 line-clamp-3">{why}</p>}

      {signal.source_url ? (
        <a href={signal.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline mt-2">
          <ExternalLink className="h-3 w-3" /> Source proof
        </a>
      ) : (
        <p className="text-[12px] text-amber-300/80 mt-2">No source proof — use as idea only</p>
      )}

      <div className="flex flex-wrap gap-2 mt-3">
        <ActionBtn primary onClick={() => turnInto("post")}>Turn into post</ActionBtn>
        <ActionBtn onClick={() => turnInto("comment")}>Turn into comment</ActionBtn>
        <ActionBtn onClick={() => dispatchChat(`Save idea from signal "${title}".`)}>Save idea</ActionBtn>
        <ActionBtn onClick={() => dispatchChat(`Ignore signal "${title}".`)}>Ignore</ActionBtn>
      </div>
    </article>
  );
}

function ActionBtn({ children, onClick, primary }: { children: React.ReactNode; onClick: () => void; primary?: boolean }) {
  const cls = primary
    ? "bg-primary text-primary-foreground hover:opacity-90"
    : "border border-border/70 bg-background/50 text-foreground/90 hover:border-primary/40";
  return (
    <button onClick={onClick} className={`text-[13px] font-medium px-2.5 py-1 rounded-md transition ${cls}`}>{children}</button>
  );
}
