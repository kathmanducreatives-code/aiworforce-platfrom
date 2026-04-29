import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

const useReducedMotion = () => {
  const [r, setR] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setR(mq.matches);
    const fn = () => setR(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return r;
};

interface Props {
  active: boolean;
  /** tailwind color e.g. 'bg-emerald-500' — used to extract the gradient hue */
  tone?: string;
}

export default function AmbientShimmer({ active, tone = 'bg-primary' }: Props) {
  const reduced = useReducedMotion();
  if (!active || reduced) return null;
  // Map dept tones to a usable HSL-friendly tailwind via opacity utility
  const via = tone.replace('bg-', 'via-').replace(/-\d+$/, '-500/15');
  return (
    <motion.div
      aria-hidden
      className={`pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-r from-transparent ${via} to-transparent`}
      initial={{ x: '-100%' }}
      animate={{ x: '100%' }}
      transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
    />
  );
}
