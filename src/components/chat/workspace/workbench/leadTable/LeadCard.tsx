// ONE LEAD, SEVEN FACTS, NO HORIZONTAL SCROLL.
//
// The table this replaces had fourteen columns behind `w-max min-w-full`. Fit
// was column 12 and Status column 14 — the two facts a reader most needs, sat
// past four padlocked columns and off the right edge at any normal panel width.
//
// The layout ranks them the way a reader asks for them:
//
//     Acme Robotics                            Strong match · 92
//     acme.com ↗
//     Hiring 3 senior ML engineers
//     Matched because US-based, AI vertical, hiring technical roles
//     ● Ready to contact                        Find decision-makers →
//
// Company and score on one line because "which is this, and is it any good" is
// one question. The reason is the quiet line — present, readable, never
// competing. State and next step share the last line: what it is, and what to
// do about it.

import { ArrowUpRight } from 'lucide-react';
import type { LeadCardModel } from '@/lib/workbench/leadCard';

const STATE_DOT: Record<LeadCardModel['state'], string> = {
  ready: 'bg-emerald-400',
  needs_contact: 'bg-amber-400',
  in_review: 'bg-[#6e7681]',
};

const FIT_TONE: Record<string, string> = {
  'Strong match': 'text-emerald-300',
  'Good match': 'text-emerald-200/80',
  'Possible match': 'text-[#8b949e]',
};

interface Props {
  model: LeadCardModel;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  /** Runs the card's own next step. Absent when the model offers none. */
  onNextStep?: () => void;
  /** Per-row progress from a running action, rendered in place of the state. */
  busyLabel?: string | null;
}

export default function LeadCard({
  model, selected, onToggle, onOpen, onNextStep, busyLabel,
}: Props) {
  return (
    <div
      // ONE HAIRLINE PER ROW, and only between rows. The table drew a border on
      // every cell of every column.
      className={`group relative border-b border-white/[0.04] transition-colors ${
        selected ? 'bg-emerald-500/[0.04]' : 'hover:bg-white/[0.015]'
      }`}
    >
      <div className="flex gap-3.5 px-7 py-3.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${model.company}`}
          className="mt-1 h-3.5 w-3.5 rounded accent-emerald-500 cursor-pointer shrink-0 opacity-40 group-hover:opacity-100 checked:opacity-100 transition-opacity"
        />

        <div className="min-w-0 flex-1">
          {/* LINE 1 — name, and the two facts that rank it. */}
          <div className="flex items-baseline justify-between gap-4">
            <button
              onClick={onOpen}
              className="text-[15.5px] font-medium text-[#F0F6FC] truncate hover:text-emerald-300 transition-colors text-left leading-snug"
            >
              {model.company}
            </button>
            <span className="shrink-0 flex items-baseline gap-2.5 text-[13px]">
              <span className="inline-flex items-center gap-1.5 text-[#8b949e]">
                <span className={`h-1.5 w-1.5 rounded-full ${STATE_DOT[model.state]}`} />
                {busyLabel ?? model.stateLabel}
              </span>
              {model.fit !== null && (
                <span className={`tabular-nums ${FIT_TONE[model.fitLabel ?? ''] ?? 'text-[#8b949e]'}`}>
                  Fit {model.fit}
                </span>
              )}
            </span>
          </div>

          {/* LINE 2 — website, quiet. */}
          {model.websiteLabel && (
            model.websiteHref ? (
              <a
                href={model.websiteHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-[13px] text-[#6e7681] hover:text-[#C9D1D9] transition-colors"
              >
                {model.websiteLabel}
                <ArrowUpRight className="h-3 w-3" />
              </a>
            ) : (
              <span className="text-[13px] text-[#6e7681]">{model.websiteLabel}</span>
            )
          )}

          {/* LINE 3 — the signal. The specific fact that put it here. */}
          {model.signal && (
            <div className="mt-1.5 text-[14px] text-[#C9D1D9] leading-snug truncate">
              {model.signalHref ? (
                <a
                  href={model.signalHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="hover:text-emerald-300 transition-colors"
                >
                  {model.signal}
                </a>
              ) : model.signal}
            </div>
          )}

          {/* LINE 4 — why it is here, and the next step if there is one. */}
          <div className="mt-1 flex items-baseline justify-between gap-4">
            <p className="text-[13px] text-[#6e7681] leading-relaxed truncate">
              {model.reason ?? model.whyLine}
            </p>
            {model.nextStep && onNextStep && !busyLabel && (
              <button
                onClick={onNextStep}
                className="shrink-0 text-[13px] text-emerald-300/90 hover:text-emerald-200 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
              >
                {model.nextStep} →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
