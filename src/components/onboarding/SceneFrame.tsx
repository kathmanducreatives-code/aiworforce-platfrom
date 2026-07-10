// One glass card per scene. Owns the fade+lift transition and the standard
// layout: eyebrow → headline → helper → body → footer CTAs. Keeps every scene
// visually consistent and enforces "one main card, calm motion".
//
// No internal scrollbars by design: scenes pass compact content. The whole
// page can scroll on very short viewports, but a scene never scrolls inside.

import type { ReactNode } from 'react';
import { motion } from 'framer-motion';

export function SceneFrame({
  eyebrow, title, helper, children, footer, width = 'md',
}: {
  eyebrow?: string;
  title: string;
  helper?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** md = input scenes, lg = research/verify, xl = review/activate. */
  width?: 'md' | 'lg' | 'xl';
}) {
  const max = width === 'xl' ? 'max-w-2xl' : width === 'lg' ? 'max-w-xl' : 'max-w-lg';
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12, scale: 0.985 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className={`relative mx-auto w-full ${max}`}
    >
      <div className="relative overflow-hidden rounded-3xl border border-border/50 bg-card/40 p-6 shadow-[0_30px_80px_-40px_hsl(var(--primary)/0.35)] backdrop-blur-2xl sm:p-8">
        {/* top gradient hairline */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ background: 'linear-gradient(to right, transparent, hsl(var(--primary) / 0.55), transparent)' }}
        />
        {eyebrow && (
          <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.22em] text-primary/80">{eyebrow}</p>
        )}
        <h1 className="text-balance text-2xl font-semibold tracking-tight text-foreground sm:text-[28px] sm:leading-tight">
          {title}
        </h1>
        {helper && <div className="mt-2 text-sm leading-relaxed text-muted-foreground">{helper}</div>}
        {children && <div className="mt-6">{children}</div>}
        {footer && <div className="mt-8">{footer}</div>}
      </div>
    </motion.div>
  );
}
