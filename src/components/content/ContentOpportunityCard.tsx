// A content opportunity derived from a real signal. Shows the source signal,
// angle, target reader, suggested hook, proof, format, and an approval-gated CTA.
// Turning it into a post/comment creates a draft for review — never posts.
import { ExternalLink, FileText, MessageSquare, Target, Quote } from "lucide-react";
import type { FeedSignal } from "@/lib/signalFeedModel";
import { contentOpportunityFromSignal, type ContentBriefSignal } from "@/lib/contentOps";

function toSig(s: FeedSignal): ContentBriefSignal {
  return {
    title: s.title,
    signal_type: s.signal_type,
    score: Number((s.raw?.score as number) ?? s.fit_score ?? 0),
    company: s.account_name ?? null,
    source_url: s.source_url ?? null,
  };
}

export default function ContentOpportunityCard({
  signal,
  onTurnIntoPost,
  onTurnIntoComment,
}: {
  signal: FeedSignal;
  onTurnIntoPost?: () => void;
  onTurnIntoComment?: () => void;
}) {
  const op = contentOpportunityFromSignal(toSig(signal));
  const isComment = op.format === "LinkedIn comment";

  return (
    <article className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 hover:border-white/[0.12] transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-neutral-500">Source signal</div>
          <div className="text-[14px] font-semibold text-[#F0F6FC] leading-snug line-clamp-2">{op.sourceTitle}</div>
        </div>
        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-300">{op.format}</span>
      </div>

      <div className="mt-3 space-y-1.5 text-[13px]">
        <Row icon={<Target className="h-3.5 w-3.5" />} label="Angle" value={op.angle} />
        <Row icon={<Quote className="h-3.5 w-3.5" />} label="Hook" value={op.hook} muted />
        <Row icon={<Target className="h-3.5 w-3.5" />} label="Reader" value={op.targetReader} muted />
      </div>

      {op.sourceUrl ? (
        <a href={op.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-sky-300 hover:underline mt-2.5">
          <ExternalLink className="h-3 w-3" /> Source proof
        </a>
      ) : (
        <div className="text-[12px] text-amber-300/80 mt-2.5">No source proof — use as an idea only</div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button onClick={isComment ? onTurnIntoComment : onTurnIntoPost}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20 transition-colors">
          {isComment ? <MessageSquare className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
          {isComment ? "Turn into comment" : "Turn into post"}
        </button>
        <span className="text-[11px] text-neutral-500">{op.cta}</span>
      </div>
    </article>
  );
}

function Row({ icon, label, value, muted }: { icon: React.ReactNode; label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-start gap-1.5">
      <span className="text-neutral-500 mt-0.5">{icon}</span>
      <span className="text-neutral-500 text-[11px] uppercase tracking-wide w-14 shrink-0 mt-0.5">{label}</span>
      <span className={muted ? "text-neutral-400" : "text-neutral-200"}>{value}</span>
    </div>
  );
}
