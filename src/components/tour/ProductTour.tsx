import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, ChevronLeft, X, Sparkles } from 'lucide-react';
import { PILOT_PROFILE } from '@/data/agentProfiles';
import { useProductTour } from '@/hooks/useProductTour';
import { TOUR_STEPS } from './tourSteps';

/**
 * Premium Pilot-led product walkthrough. Mounted once in MainLayout.
 * - Auto-opens after onboarding if not completed and not skipped.
 * - Listens to `agentory:tour:restart` to be reopened from anywhere.
 * - Skippable, non-blocking, no DOM spotlight (avoids layout breakage).
 */
export default function ProductTour() {
  const navigate = useNavigate();
  const location = useLocation();
  const { state, shouldAutoOpen, consumeTourPending, markCompleted, markSkipped, restart } = useProductTour();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  // Auto-open once per session if conditions match, or on explicit restart.
  useEffect(() => {
    if (open) return;
    const pending = consumeTourPending();
    if (pending || shouldAutoOpen) {
      setIndex(0);
      setOpen(true);
    }
  }, [open, shouldAutoOpen, consumeTourPending]);

  // Listen for restart events from menus / command palette.
  useEffect(() => {
    const handler = async () => {
      await restart();
      setIndex(0);
      setOpen(true);
    };
    window.addEventListener('agentory:tour:restart', handler);
    return () => window.removeEventListener('agentory:tour:restart', handler);
  }, [restart]);

  // Don't auto-open while still inside the onboarding wizard route.
  if (location.pathname.startsWith('/onboarding/')) return null;
  if (!open) return null;

  const step = TOUR_STEPS[index];
  const total = TOUR_STEPS.length;
  const isLast = index === total - 1;

  const close = () => setOpen(false);
  const skip = async () => { close(); await markSkipped(); };
  const finish = async () => { close(); await markCompleted(); };

  const next = () => {
    if (isLast) finish();
    else setIndex((i) => Math.min(total - 1, i + 1));
  };
  const back = () => setIndex((i) => Math.max(0, i - 1));
  const takeMeThere = async () => {
    const route = step.ctaRoute;
    if (isLast) await markCompleted();
    close();
    navigate(route);
  };

  void state; // included for future personalization

  return (
    <AnimatePresence>
      <motion.div
        key="tour-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[120] flex items-center justify-center px-4"
      >
        <div
          className="absolute inset-0 bg-black/70 backdrop-blur-md"
          onClick={skip}
          aria-hidden
        />

        <motion.div
          key={step.id}
          initial={{ opacity: 0, y: 12, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.99 }}
          transition={{ type: 'spring', stiffness: 220, damping: 26 }}
          className="relative w-full max-w-[640px] rounded-2xl border border-emerald-500/20 bg-[#0a0c0a]/90 shadow-[0_30px_120px_-20px_rgba(16,185,129,0.35)] overflow-hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="product-tour-title"
        >
          {/* Glow */}
          <div className="pointer-events-none absolute -top-32 -right-24 h-72 w-72 rounded-full bg-emerald-500/20 blur-[120px]" />
          <div className="pointer-events-none absolute -bottom-24 -left-16 h-56 w-56 rounded-full bg-emerald-500/10 blur-[100px]" />

          {/* Close */}
          <button
            type="button"
            onClick={skip}
            aria-label="Skip tour"
            className="absolute top-3 right-3 z-10 h-8 w-8 rounded-md text-neutral-400 hover:text-foreground hover:bg-white/[0.05] flex items-center justify-center"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Header — Pilot avatar */}
          <div className="relative px-7 pt-7 pb-3 flex items-center gap-3.5">
            <div className="relative h-11 w-11 rounded-full overflow-hidden ring-1 ring-emerald-500/40 bg-emerald-500/10 shrink-0">
              {PILOT_PROFILE.image ? (
                <img src={PILOT_PROFILE.image} alt="Pilot" className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full flex items-center justify-center text-emerald-300 font-semibold">P</div>
              )}
              <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-[#0a0c0a]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-mono uppercase tracking-[0.22em] text-emerald-300/80 flex items-center gap-1.5">
                <Sparkles className="h-3 w-3" /> Pilot · Workforce guide
              </div>
              <div className="text-[13px] text-neutral-300 mt-0.5">Step {index + 1} of {total}</div>
            </div>
          </div>

          {/* Progress */}
          <div className="relative px-7">
            <div className="h-1 w-full rounded-full bg-white/[0.05] overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-emerald-400 to-emerald-300"
                initial={false}
                animate={{ width: `${((index + 1) / total) * 100}%` }}
                transition={{ type: 'spring', stiffness: 180, damping: 24 }}
              />
            </div>
            <div className="mt-3 flex gap-1.5">
              {TOUR_STEPS.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`Go to step ${i + 1}: ${s.title}`}
                  className={
                    'h-1.5 flex-1 rounded-full transition-colors ' +
                    (i <= index ? 'bg-emerald-400/80' : 'bg-white/[0.07] hover:bg-white/[0.12]')
                  }
                />
              ))}
            </div>
          </div>

          {/* Body */}
          <div className="relative px-7 pt-6 pb-6">
            <h2 id="product-tour-title" className="text-[28px] font-semibold tracking-tight text-foreground leading-[1.1]">
              {step.title}
            </h2>
            <p className="mt-3 text-[15px] leading-[1.55] text-neutral-300">
              {step.body}
            </p>
            <ul className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {step.bullets.map((b) => (
                <li key={b} className="flex items-start gap-2 text-[13.5px] text-neutral-200">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400/80 shrink-0" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Footer */}
          <div className="relative px-7 pb-6 pt-1 flex items-center justify-between gap-3 border-t border-white/[0.04]">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={back}
                disabled={index === 0}
                className="h-9 px-3 rounded-md text-[13px] font-medium text-neutral-300 hover:text-foreground hover:bg-white/[0.05] disabled:opacity-30 disabled:hover:bg-transparent flex items-center gap-1"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Back
              </button>
              <button
                type="button"
                onClick={skip}
                className="h-9 px-3 rounded-md text-[13px] font-medium text-neutral-400 hover:text-foreground hover:bg-white/[0.05]"
              >
                Skip tour
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={takeMeThere}
                className="h-9 px-3.5 rounded-md text-[13px] font-medium text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 hover:border-emerald-500/50 bg-emerald-500/[0.06]"
              >
                {step.ctaLabel}
              </button>
              <button
                type="button"
                onClick={next}
                className="h-9 px-4 rounded-md text-[13.5px] font-semibold bg-emerald-500 hover:bg-emerald-400 text-black shadow-[0_0_24px_rgba(16,185,129,0.35)] flex items-center gap-1.5"
              >
                {isLast ? 'Done' : 'Next'} <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export function restartProductTour() {
  window.dispatchEvent(new Event('agentory:tour:restart'));
}
