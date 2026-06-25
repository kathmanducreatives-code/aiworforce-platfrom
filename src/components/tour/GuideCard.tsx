import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, ChevronLeft, MapPin, Sparkles, Target, X, Zap } from 'lucide-react';
import { PILOT_PROFILE } from '@/data/agentProfiles';
import type { ProductTourStep, Placement } from './tourSteps';

interface GuideCardProps {
  step: ProductTourStep;
  index: number;
  total: number;
  rect: DOMRect | null;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  onOpen: () => void;
  isLast: boolean;
}

const CARD_W = 360;
const GAP = 18;

function computePosition(
  rect: DOMRect | null,
  placement: Placement = 'auto',
  cardHeight = 360,
): { top: number; left: number; arrow: Placement | null; centered: boolean } {
  if (typeof window === 'undefined') {
    return { top: 100, left: 100, arrow: null, centered: true };
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Small viewport or no rect → centered fallback.
  if (!rect || vw < 900) {
    return {
      top: Math.max(24, vh / 2 - cardHeight / 2),
      left: Math.max(24, vw / 2 - CARD_W / 2),
      arrow: null,
      centered: true,
    };
  }

  const tryPlacements: Placement[] =
    placement === 'auto'
      ? ['right', 'left', 'bottom', 'top']
      : [placement, 'right', 'left', 'bottom', 'top'];

  for (const p of tryPlacements) {
    if (p === 'right' && rect.right + GAP + CARD_W < vw - 12) {
      const left = rect.right + GAP;
      const top = clamp(rect.top + rect.height / 2 - cardHeight / 2, 16, vh - cardHeight - 16);
      return { top, left, arrow: 'left', centered: false };
    }
    if (p === 'left' && rect.left - GAP - CARD_W > 12) {
      const left = rect.left - GAP - CARD_W;
      const top = clamp(rect.top + rect.height / 2 - cardHeight / 2, 16, vh - cardHeight - 16);
      return { top, left, arrow: 'right', centered: false };
    }
    if (p === 'bottom' && rect.bottom + GAP + cardHeight < vh - 12) {
      const top = rect.bottom + GAP;
      const left = clamp(rect.left + rect.width / 2 - CARD_W / 2, 16, vw - CARD_W - 16);
      return { top, left, arrow: 'top', centered: false };
    }
    if (p === 'top' && rect.top - GAP - cardHeight > 12) {
      const top = rect.top - GAP - cardHeight;
      const left = clamp(rect.left + rect.width / 2 - CARD_W / 2, 16, vw - CARD_W - 16);
      return { top, left, arrow: 'bottom', centered: false };
    }
  }

  // Nothing fits — clamp to bottom-right of anchor.
  return {
    top: Math.max(24, vh / 2 - cardHeight / 2),
    left: Math.max(24, vw / 2 - CARD_W / 2),
    arrow: null,
    centered: true,
  };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

export default function GuideCard({
  step, index, total, rect, onBack, onNext, onSkip, onOpen, isLast,
}: GuideCardProps) {
  const [cardH, setCardH] = useState(360);
  const [cardRef, setCardRef] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (cardRef) {
      const h = cardRef.getBoundingClientRect().height;
      if (h && Math.abs(h - cardH) > 2) setCardH(h);
    }
  }, [cardRef, cardH, step.id, rect]);

  const pos = computePosition(rect, step.placement, cardH);

  return (
    <motion.div
      ref={setCardRef}
      key={step.id}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 240, damping: 26 }}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: CARD_W }}
      className="z-[120] rounded-2xl border border-emerald-500/25 bg-[#0a0c0a]/95 backdrop-blur-xl shadow-[0_30px_120px_-20px_rgba(16,185,129,0.4)] overflow-hidden"
      role="dialog"
      aria-modal="false"
      aria-labelledby="product-tour-title"
    >
      {/* Pointer arrow */}
      {pos.arrow && <PointerArrow side={pos.arrow} />}

      {/* Soft glow */}
      <div className="pointer-events-none absolute -top-24 -right-16 h-48 w-48 rounded-full bg-emerald-500/20 blur-[100px]" />

      {/* Close */}
      <button
        type="button"
        onClick={onSkip}
        aria-label="Skip tour"
        className="absolute top-2.5 right-2.5 z-10 h-7 w-7 rounded-md text-neutral-400 hover:text-foreground hover:bg-white/[0.05] flex items-center justify-center"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      {/* Header */}
      <div className="relative px-5 pt-5 pb-2.5 flex items-center gap-3">
        <div className="relative h-9 w-9 rounded-full overflow-hidden ring-1 ring-emerald-500/40 bg-emerald-500/10 shrink-0">
          {PILOT_PROFILE.image ? (
            <img src={PILOT_PROFILE.image} alt="Pilot" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full flex items-center justify-center text-emerald-300 font-semibold text-sm">P</div>
          )}
          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-[#0a0c0a]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-emerald-300/80 flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> Pilot · Guide
          </div>
          <div className="text-[11.5px] text-neutral-400 mt-0.5 tabular-nums">{index + 1} of {total}</div>
        </div>
      </div>

      {/* Progress segments */}
      <div className="relative px-5">
        <div className="flex gap-1">
          {Array.from({ length: total }).map((_, i) => (
            <span
              key={i}
              className={
                'h-[3px] flex-1 rounded-full transition-colors ' +
                (i <= index ? 'bg-emerald-400/80' : 'bg-white/[0.07]')
              }
            />
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="relative px-5 pt-4 pb-4">
        <h2 id="product-tour-title" className="text-[19px] font-semibold tracking-tight text-foreground leading-[1.2]">
          {step.title}
        </h2>
        <p className="mt-1.5 text-[13.5px] leading-[1.55] text-neutral-300">
          {step.body}
        </p>

        <div className="mt-4 space-y-2.5">
          <Row icon={<MapPin className="h-3.5 w-3.5 text-emerald-300/80" />} label="Where" value={step.where} />
          <Row icon={<Target className="h-3.5 w-3.5 text-emerald-300/80" />} label="Use it for" value={step.useItFor} />
          <Row icon={<Zap className="h-3.5 w-3.5 text-emerald-300/80" />} label="Try first" value={step.tryFirst} />
        </div>
      </div>

      {/* Footer */}
      <div className="relative px-5 pb-4 pt-1 flex items-center justify-between gap-2 border-t border-white/[0.04]">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onBack}
            disabled={index === 0}
            className="h-8 px-2.5 rounded-md text-[12px] font-medium text-neutral-300 hover:text-foreground hover:bg-white/[0.05] disabled:opacity-30 disabled:hover:bg-transparent flex items-center gap-1"
          >
            <ChevronLeft className="h-3 w-3" /> Back
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="h-8 px-2.5 rounded-md text-[12px] font-medium text-neutral-400 hover:text-foreground hover:bg-white/[0.05]"
          >
            {isLast ? 'Open Dashboard' : 'Skip'}
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          {!isLast && (
            <button
              type="button"
              onClick={onOpen}
              className="h-8 px-2.5 rounded-md text-[12px] font-medium text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 hover:border-emerald-500/50 bg-emerald-500/[0.06]"
            >
              {step.ctaLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onNext}
            className="h-8 px-3 rounded-md text-[12.5px] font-semibold bg-emerald-500 hover:bg-emerald-400 text-black shadow-[0_0_18px_rgba(16,185,129,0.35)] flex items-center gap-1 transition-all"
          >
            {isLast ? 'Run recommended workflow' : 'Next'} <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-2">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-[10.5px] font-mono uppercase tracking-[0.16em] text-neutral-500">{label}</div>
        <div className="text-[12.5px] text-neutral-200 leading-snug mt-0.5">{value}</div>
      </div>
    </div>
  );
}

function PointerArrow({ side }: { side: Placement }) {
  const base = 'absolute h-3 w-3 rotate-45 border border-emerald-500/25 bg-[#0a0c0a]';
  if (side === 'left') return <span className={base + ' -left-[7px] top-1/2 -translate-y-1/2 border-r-0 border-t-0'} />;
  if (side === 'right') return <span className={base + ' -right-[7px] top-1/2 -translate-y-1/2 border-l-0 border-b-0'} />;
  if (side === 'top') return <span className={base + ' -top-[7px] left-1/2 -translate-x-1/2 border-b-0 border-r-0'} />;
  if (side === 'bottom') return <span className={base + ' -bottom-[7px] left-1/2 -translate-x-1/2 border-t-0 border-l-0'} />;
  return null;
}
