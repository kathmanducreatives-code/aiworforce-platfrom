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
      className={`group relative border-b border-white/[0.05] transition-colors ${
        selected ? 'bg-emerald-500/[0.04]' : 'hover:bg-white/[0.015]'
      }`}
    >
      <div className="flex gap-4 px-6 py-4">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${model.company}`}
          className="mt-1 h-3.5 w-3.5 rounded accent-emerald-500 cursor-pointer shrink-0"
        />

        <div className="min-w-0 flex-1">
          {/* WHICH IS THIS, AND IS IT ANY GOOD — one question, one line. */}
          <div className="flex items-baseline justify-between gap-4">
            <button
              onClick={onOpen}
              className="text-[15px] font-medium text-[#F0F6FC] truncate hover:text-emerald-300 transition-colors text-left"
            >
              {model.company}
            </button>
            {model.fit !== null && (
              <span className="shrink-0 text-[12.5px] tabular-nums">
                <span className={FIT_TONE[model.fitLabel ?? ''] ?? 'text-[#8b949e]'}>
                  {model.fitLabel}
                </span>
                <span className="text-[#6e7681]"> · {model.fit}</span>
              </span>
            )}
          </div>

          {model.websiteLabel && (
            <div className="mt-0.5">
              {model.websiteHref ? (
                <a
                  href={model.websiteHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-[12.5px] text-[#8b949e] hover:text-[#C9D1D9] transition-colors"
                >
                  {model.websiteLabel}
                  <ArrowUpRight className="h-3 w-3" />
                </a>
              ) : (
                // Shown, unlinked. A broken link is worse than no link — it
                // looks checked.
                <span className="text-[12.5px] text-[#6e7681]">{model.websiteLabel}</span>
              )}
            </div>
          )}

          {model.signal && (
            <div className="mt-2.5 text-[13.5px] text-[#C9D1D9] leading-snug">
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

          {model.reason && (
            <p className="mt-1 text-[12.5px] text-[#8b949e] leading-relaxed line-clamp-2">
              {model.reason}
            </p>
          )}

          {/* WHAT IT IS, AND WHAT TO DO ABOUT IT. */}
          <div className="mt-3 flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-[#8b949e]">
              <span className={`h-1.5 w-1.5 rounded-full ${STATE_DOT[model.state]}`} />
              {busyLabel ?? model.stateLabel}
            </span>
            {model.nextStep && onNextStep && !busyLabel && (
              <button
                onClick={onNextStep}
                className="text-[12.5px] text-emerald-300/90 hover:text-emerald-200 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
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
