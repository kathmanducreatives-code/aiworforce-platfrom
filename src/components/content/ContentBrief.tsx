// Today's Content Brief — premium summary at the top of the Scribe Command Center.
// Real data only: strongest content angle from the best verified signal, the
// source it's grounded in, a suggested direction, and the next best action.
import { PenLine, Lightbulb, ArrowRight, Sparkles, Inbox } from "lucide-react";
import { deriveContentBrief, type ContentBriefSignal } from "@/lib/contentOps";
import type { FeedSignal } from "@/lib/signalFeedModel";

function toBrief(s: FeedSignal): ContentBriefSignal {
  return {
    title: s.title,
    signal_type: s.signal_type,
    score: Number((s.raw?.score as number) ?? s.fit_score ?? 0),
    company: s.account_name ?? null,
    source_url: s.source_url ?? null,
  };
}

export default function ContentBrief({
  signals,
  draftsAwaiting,
  onStart,
}: {
  signals: FeedSignal[];
  draftsAwaiting: number;
  onStart?: (text: string) => void;
}) {
  const brief = deriveContentBrief(signals.map(toBrief), draftsAwaiting);

  return (
    <section className="rounded-2xl border border-white/[0.07] bg-gradient-to-b from-white/[0.03] to-transparent p-5 md:p-6">
      <div className="flex items-center gap-2 mb-4">
        <PenLine className="h-4 w-4 text-violet-300" />
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-neutral-400">Today's Content Brief</h2>
      </div>

      {brief.isEmpty ? (
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="min-w-0 flex items-start gap-3">
            <Inbox className="h-5 w-5 text-neutral-500 mt-0.5 shrink-0" />
            <div>
              <div className="text-[16px] font-semibold text-[#F0F6FC]">No content-ready signals yet</div>
              <p className="text-[14px] text-neutral-400 mt-1 max-w-xl">
                {brief.nextAction ?? "Run a Scout radar scan or save a signal, then Scribe can turn it into a founder post or comment draft."}
              </p>
            </div>
          </div>
          {onStart && (
            <button
              onClick={() => onStart("Scribe, turn my latest strong signals into a LinkedIn founder POV post — draft only.")}
              className="shrink-0 inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-[14px] font-semibold bg-violet-500/15 border border-violet-500/30 text-violet-200 hover:bg-violet-500/25 transition-colors"
            >
              <Sparkles className="h-4 w-4" /> Draft from signals
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Cell icon={<Lightbulb className="h-4 w-4 text-violet-300" />} label="Strongest angle">
            <div className="text-[14px] font-medium text-[#F0F6FC] leading-snug line-clamp-3">{brief.angle}</div>
          </Cell>
          <Cell icon={<ArrowRight className="h-4 w-4 text-violet-300" />} label="Grounded in">
            <div className="text-[14px] text-neutral-200 leading-snug line-clamp-2">{brief.sourceSignal?.company ?? brief.sourceSignal?.title}</div>
            {brief.sourceSignal?.sourceUrl && (
              <a href={brief.sourceSignal.sourceUrl} target="_blank" rel="noreferrer" className="text-[12px] text-sky-300 hover:underline mt-1 inline-block truncate max-w-full">source proof</a>
            )}
          </Cell>
          <Cell icon={<PenLine className="h-4 w-4 text-violet-300" />} label="Suggested direction">
            <div className="text-[13px] text-neutral-300 leading-snug line-clamp-2">{brief.direction}</div>
            {brief.draftsAwaiting > 0 && (
              <div className="text-[12px] text-amber-200/85 mt-1.5">{brief.draftsAwaiting} draft{brief.draftsAwaiting > 1 ? "s" : ""} awaiting your approval</div>
            )}
          </Cell>
        </div>
      )}
    </section>
  );
}

function Cell({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-4">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-neutral-500 mb-2">{icon} {label}</div>
      {children}
    </div>
  );
}
