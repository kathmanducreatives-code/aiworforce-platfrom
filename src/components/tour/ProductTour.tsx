import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { useProductTour } from '@/hooks/useProductTour';
import { TOUR_STEPS } from './tourSteps';
import { useAnchorRect } from './useAnchorRect';
import SpotlightOverlay from './SpotlightOverlay';
import GuideCard from './GuideCard';

/**
 * Pilot-led contextual product tour. Mounted once in MainLayout.
 * - Auto-opens after onboarding if not completed and not skipped.
 * - Listens to `agentory:tour:restart` to be reopened from anywhere.
 * - Spotlights the real UI for each step; falls back to centered card
 *   when the anchor can't be found or the viewport is too small.
 */
export default function ProductTour() {
  const navigate = useNavigate();
  const location = useLocation();
  const { shouldAutoOpen, consumeTourPending, markCompleted, markSkipped, restart } = useProductTour();
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

  const step = TOUR_STEPS[index];
  const total = TOUR_STEPS.length;
  const isLast = index === total - 1;
  const rect = useAnchorRect(open ? step?.anchorSelector : null, step?.fallbackSelector);

  // Keyboard shortcuts.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { void skip(); }
      else if (e.key === 'ArrowRight') { next(); }
      else if (e.key === 'ArrowLeft') { back(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index, isLast]);

  // Don't render while inside the onboarding wizard route.
  if (location.pathname.startsWith('/onboarding/') && step?.id !== 'company_brain') return null;
  if (!open || !step) return null;

  const close = () => setOpen(false);
  const skip = async () => { close(); await markSkipped(); };
  const finish = async () => { close(); await markCompleted(); };

  const next = () => {
    if (isLast) void finish();
    else setIndex((i) => Math.min(total - 1, i + 1));
  };
  const back = () => setIndex((i) => Math.max(0, i - 1));

  const openFeature = () => {
    if (location.pathname !== step.ctaRoute) {
      navigate(step.ctaRoute);
    }
    // Keep tour open — anchor will re-measure on route render.
  };

  return (
    <AnimatePresence mode="wait">
      <SpotlightOverlay key={`spot-${step.id}`} rect={rect} onDismiss={skip} />
      <GuideCard
        key={`card-${step.id}`}
        step={step}
        index={index}
        total={total}
        rect={rect}
        isLast={isLast}
        onBack={back}
        onNext={next}
        onSkip={skip}
        onOpen={openFeature}
      />
    </AnimatePresence>
  );
}

export function restartProductTour() {
  window.dispatchEvent(new Event('agentory:tour:restart'));
}
