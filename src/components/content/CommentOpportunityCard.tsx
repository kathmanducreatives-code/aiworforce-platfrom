// A comment opportunity: a conversation worth engaging, why it matters, a
// suggested angle, and (if drafted) the comment awaiting review. Approval-gated —
// nothing is commented automatically.
import { ExternalLink, MessageCircle, Lightbulb } from "lucide-react";

export interface CommentOpportunity {
  id: string;
  context: string;
  why: string;
  angle: string;
  draft?: string | null;
  statusLabel: string;
  sourceUrl?: string | null;
}

export default function CommentOpportunityCard({
  opportunity,
  onDraft,
}: {
  opportunity: CommentOpportunity;
  onDraft?: () => void;
}) {
  const o = opportunity;
  return (
    <article className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-neutral-500">Conversation</div>
          <div className="text-[14px] font-medium text-[#F0F6FC] leading-snug line-clamp-2">{o.context}</div>
        </div>
        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border border-white/10 bg-white/5 text-neutral-300">{o.statusLabel}</span>
      </div>

      <p className="text-[13px] text-neutral-400 mt-2 flex items-start gap-1.5"><Lightbulb className="h-3.5 w-3.5 mt-0.5 shrink-0 text-neutral-500" />{o.why}</p>
      <div className="text-[13px] text-neutral-300 mt-2"><span className="text-neutral-500">Angle: </span>{o.angle}</div>

      {o.draft && (
        <div className="mt-2 rounded-lg border border-white/[0.06] bg-white/[0.015] p-2.5 text-[13px] text-neutral-200 whitespace-pre-wrap line-clamp-4">{o.draft}</div>
      )}

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        {onDraft && (
          <button onClick={onDraft} className="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20 transition-colors">
            <MessageCircle className="h-3.5 w-3.5" /> {o.draft ? "Refine comment" : "Draft comment"}
          </button>
        )}
        {o.sourceUrl && (
          <a href={o.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-sky-300 hover:underline">
            <ExternalLink className="h-3 w-3" /> View post
          </a>
        )}
        <span className="text-[11px] text-neutral-500">Review before you post — manual only.</span>
      </div>
    </article>
  );
}
