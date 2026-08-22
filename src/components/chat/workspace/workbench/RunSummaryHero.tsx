// THE ANSWER, AT THE TOP, IN ONE SIZE THAT SAYS SO.
//
// The old header's largest text was 13.5px — the panel title — and the qualified
// count rendered at 11px inside a row of six chips, beside a 10px footnote about
// credit estimation. Nothing on the page was sized like an answer, so the reader
// had to hunt for the number they came for.
//
// One number at 32px. One line of context. One action. Everything else moved
// into Run details.

import { ArrowRight, Loader2 } from 'lucide-react';
import type { RunSummary } from '@/lib/workbench/runSummary';
import { summaryCaption, summaryHeadline } from '@/lib/workbench/runSummary';

interface Props {
  summary: RunSummary;
  /** The single next step. Null when there is nothing useful to offer. */
  cta?: { label: string; onClick: () => void; disabled?: boolean; hint?: string } | null;
}

export default function RunSummaryHero({ summary, cta }: Props) {
  const n = summary.qualified.value;
  const none = n === 0;

  return (
    <div className="px-6 pt-6 pb-5 border-b border-white/[0.06]">
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            {summary.inProgress && (
              <Loader2 className="h-4 w-4 animate-spin text-emerald-400/80 shrink-0" />
            )}
            {/* THE ANSWER. Tabular figures so the number does not reflow as it
                ticks up during a live run. */}
            <h1
              className={`text-[32px] leading-[1.1] font-semibold tracking-[-0.02em] tabular-nums ${
                none ? 'text-[#8b949e]' : 'text-[#F0F6FC]'
              }`}
            >
              {summaryHeadline(summary)}
            </h1>
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-[#8b949e]">
            {summaryCaption(summary)}
          </p>

          {/* SHORTFALL, stated plainly and only when true. The old UI had two
              separate shortfall lines in two different components. */}
          {summary.shortfall > 0 && !summary.inProgress && (
            <p className="mt-1.5 text-[13px] text-amber-300/90">
              {summary.shortfall} short of the {summary.requested} you asked for.
            </p>
          )}
        </div>

        {cta && (
          <div className="shrink-0">
            <button
              onClick={cta.onClick}
              disabled={cta.disabled}
              className={`h-10 px-5 rounded-lg text-[13.5px] font-semibold inline-flex items-center gap-2 transition-colors ${
                cta.disabled
                  ? 'border border-white/[0.07] bg-white/[0.02] text-[#6e7681] cursor-not-allowed'
                  : 'bg-emerald-500 hover:bg-emerald-400 text-black'
              }`}
              title={cta.hint}
            >
              {cta.label}
              {!cta.disabled && <ArrowRight className="h-4 w-4" />}
            </button>
            {cta.hint && cta.disabled && (
              <p className="mt-1.5 text-[11.5px] text-[#6e7681] max-w-[220px] text-right">
                {cta.hint}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
