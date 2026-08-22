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
  /**
   * The next step, ONLY when it can actually run.
   *
   * `disabled` and `hint` are gone. The disabled state rendered a large panel
   * whose entire content explained why it did nothing — permanently, on every
   * run in the persisted history — beside the one number the page exists to
   * show. An action that cannot run does not need prime space to say so.
   */
  cta?: { label: string; onClick: () => void } | null;
}

export default function RunSummaryHero({ summary, cta }: Props) {
  const n = summary.qualified.value;
  const none = n === 0;

  return (
    // Compact: the hero is two lines and an optional inline button. It was
    // taking a third of the panel to say one number.
    <div className="px-7 pt-5 pb-4">
      <div className="flex items-baseline justify-between gap-6 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            {summary.inProgress && (
              <Loader2 className="h-4 w-4 animate-spin text-emerald-400/80 shrink-0" />
            )}
            {/* THE ANSWER. Tabular figures so the number does not reflow as it
                ticks up during a live run. */}
            <h1
              className={`text-[28px] leading-[1.15] font-semibold tracking-[-0.02em] tabular-nums ${
                none ? 'text-[#C9D1D9]' : 'text-[#F0F6FC]'
              }`}
            >
              {summaryHeadline(summary)}
            </h1>
          </div>
          <p className="mt-1.5 text-[13.5px] text-[#8b949e]">
            {summaryCaption(summary)}
          </p>

          {/* SHORTFALL, stated plainly and only when true. The old UI had two
              separate shortfall lines in two different components. */}
          {summary.shortfall > 0 && !summary.inProgress && (
            <p className="mt-1 text-[13.5px] text-amber-300/90">
              {summary.shortfall} short of the {summary.requested} you asked for.
            </p>
          )}
        </div>

        {cta && (
          <button
            onClick={cta.onClick}
            className="shrink-0 h-9 px-4 rounded-lg text-[13.5px] font-medium inline-flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-black transition-colors"
          >
            {cta.label}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
