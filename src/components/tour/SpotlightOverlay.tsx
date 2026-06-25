import { motion } from 'framer-motion';

interface SpotlightOverlayProps {
  rect: DOMRect | null;
  onDismiss: () => void;
  padding?: number;
  radius?: number;
}

/**
 * Full-viewport dim with a rounded cutout around the anchor rect.
 * Cutout edges glow emerald. Clicks outside the cutout dismiss.
 */
export default function SpotlightOverlay({
  rect,
  onDismiss,
  padding = 8,
  radius = 12,
}: SpotlightOverlayProps) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900;

  if (!rect) {
    // No anchor — render a soft dim only (no cutout).
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onDismiss}
        aria-hidden
        className="fixed inset-0 z-[115] bg-black/55 backdrop-blur-[2px]"
      />
    );
  }

  const x = Math.max(0, rect.left - padding);
  const y = Math.max(0, rect.top - padding);
  const w = Math.min(vw - x, rect.width + padding * 2);
  const h = Math.min(vh - y, rect.height + padding * 2);

  return (
    <motion.svg
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      width={vw}
      height={vh}
      viewBox={`0 0 ${vw} ${vh}`}
      className="fixed inset-0 z-[115] pointer-events-none"
      aria-hidden
    >
      <defs>
        <mask id="tour-spotlight-mask">
          <rect x="0" y="0" width={vw} height={vh} fill="white" />
          <rect x={x} y={y} width={w} height={h} rx={radius} ry={radius} fill="black" />
        </mask>
        <filter id="tour-spot-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Dim mask — clickable to dismiss */}
      <rect
        x="0"
        y="0"
        width={vw}
        height={vh}
        fill="rgba(0,0,0,0.55)"
        mask="url(#tour-spotlight-mask)"
        onClick={onDismiss}
        style={{ pointerEvents: 'auto', cursor: 'pointer' }}
      />
      {/* Outline ring */}
      <motion.rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={radius}
        ry={radius}
        fill="none"
        stroke="rgb(16, 185, 129)"
        strokeWidth="1.5"
        opacity="0.95"
        filter="url(#tour-spot-glow)"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
      />
    </motion.svg>
  );
}
