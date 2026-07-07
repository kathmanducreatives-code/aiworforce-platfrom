import { AlertTriangle, Bookmark, Check, ExternalLink, EyeOff } from "lucide-react";
import type { FeedSignal } from "@/lib/signalFeedModel";
import type { ReviewStatus } from "@/lib/signalReviewModel";
import { sendAgentCommand } from "@/lib/agentCommand";
import { buildTurnIntoCommand, type SignalIdeaAction } from "@/lib/signalIdeaActions";

export default function SignalToContentCard({
  signal,
  reviewStatus,
  onReview,
}: {
  signal: FeedSignal;
  reviewStatus?: ReviewStatus | null;
  /** Persists a saved/ignored review for this signal (no chat involved). */
  onReview?: (action: SignalIdeaAction) => void | Promise<void>;
}) {
  const verified = Boolean((signal as any).verified ?? signal.source_url);
  const priority = (signal as any).priority ?? "normal";
  const why = (signal as any).why_it_matters ?? signal.description ?? "";
  const type = signal.signal_type ?? "signal";
  const title = signal.title ?? signal.signal_label ?? "Signal";
  const saved = reviewStatus === "saved";
  const ignored = reviewStatus === "ignored";

  const turnInto = (kind: "post" | "comment") => {
    if (!verified) {
      const ok = window.confirm("This signal is unverified. Continue as idea only?");
      if (!ok) return;
    }
    void sendAgentCommand(buildTurnIntoCommand(kind, { title, sourceUrl: signal.source_url }), {
      success: "Sent to Pilot",
      action_source: "content_action",
    });
  };

  // Save/Ignore persist directly via signal_reviews — they must work with the
  // chat closed. Clicking the active state toggles it back to `new`.
  const toggle = (action: SignalIdeaAction) => onReview?.(action);

  return (
    <article className={`rounded-xl border border-border/70 bg-background/40 p-4 transition-opacity ${ignored ? "opacity-50" : ""}`}>
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
        {onReview && (
          <>
            <ActionBtn active={saved} onClick={() => toggle("save")}>
              <Bookmark className="h-3 w-3" /> {saved ? "Saved" : "Save idea"}
            </ActionBtn>
            <ActionBtn active={ignored} onClick={() => toggle("ignore")}>
              {ignored ? <Check className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />} {ignored ? "Ignored" : "Ignore"}
            </ActionBtn>
          </>
        )}
      </div>
    </article>
  );
}

function ActionBtn({ children, onClick, primary, active }: { children: React.ReactNode; onClick: () => void; primary?: boolean; active?: boolean }) {
  const cls = primary
    ? "bg-primary text-primary-foreground hover:opacity-90"
    : active
      ? "border border-primary/50 bg-primary/10 text-primary"
      : "border border-border/70 bg-background/50 text-foreground/90 hover:border-primary/40";
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-1 text-[13px] font-medium px-2.5 py-1 rounded-md transition ${cls}`}>{children}</button>
  );
}
