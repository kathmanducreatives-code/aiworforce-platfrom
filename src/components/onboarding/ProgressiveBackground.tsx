import { motion, useReducedMotion } from 'framer-motion';

/** Fixed grid with an opacity-only light wash to keep ambient motion inexpensive. */
export function ProgressiveBackground() {
  const reducedMotion = useReducedMotion();
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background">
      <motion.div className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at 50% 32%, hsl(var(--primary) / 0.20), transparent 65%), radial-gradient(ellipse at 12% 80%, hsl(var(--primary) / 0.08), transparent 55%)' }}
        animate={{ opacity: reducedMotion ? 1 : [0.7, 1, 0.7] }}
        transition={{ duration: 10, repeat: reducedMotion ? 0 : Infinity, ease: 'easeInOut' }}
      />
      <div className="absolute inset-0" style={{
        backgroundImage: 'linear-gradient(hsl(var(--primary) / 0.10) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary) / 0.10) 1px, transparent 1px)',
        backgroundSize: '56px 56px',
        maskImage: 'radial-gradient(ellipse at 50% 35%, black 15%, transparent 80%)',
      }} />
    </div>
  );
}
