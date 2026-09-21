import type { ReactNode } from 'react';
import { motion, useMotionValue, useMotionTemplate, useReducedMotion } from 'framer-motion';

/** Shared, quiet surface for every onboarding scene. */
export function SceneFrame({ eyebrow, title, helper, children, footer, width = 'md' }: {
  eyebrow?: string;
  title: string;
  helper?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: 'md' | 'lg' | 'xl';
}) {
  const reducedMotion = useReducedMotion();
  const lightX = useMotionValue(50);
  const lightY = useMotionValue(0);
  const reflection = useMotionTemplate`radial-gradient(480px circle at ${lightX}% ${lightY}%, hsl(var(--primary) / 0.10), transparent 70%)`;
  const max = width === 'xl' ? 'max-w-[900px]' : width === 'lg' ? 'max-w-[820px]' : 'max-w-[760px]';
  return (
    <motion.section
      initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reducedMotion ? 0 : -4 }}
      transition={{ duration: reducedMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
      onPointerMove={(event) => {
        if (reducedMotion || event.pointerType !== 'mouse') return;
        const bounds = event.currentTarget.getBoundingClientRect();
        lightX.set(((event.clientX - bounds.left) / bounds.width) * 100);
        lightY.set(((event.clientY - bounds.top) / bounds.height) * 100);
      }}
      onPointerLeave={() => { lightX.set(50); lightY.set(0); }}
      className={`relative mx-auto w-full overflow-hidden rounded-[22px] border border-primary/20 bg-card/80 backdrop-blur-xl ${max}`}
      style={{
        backgroundImage: 'linear-gradient(135deg, hsl(var(--foreground) / 0.055), transparent 45%, hsl(var(--primary) / 0.025))',
        boxShadow: 'inset 0 1px 0 hsl(var(--foreground) / 0.10), inset 0 -1px 0 hsl(var(--primary) / 0.06), 0 24px 64px -32px rgba(0,0,0,0.65), 0 0 48px -24px hsl(var(--primary) / 0.22)',
      }}
    >
      <motion.div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: reflection }} />
      <div aria-hidden className="pointer-events-none absolute inset-x-8 top-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, hsl(var(--primary) / 0.5), transparent)' }} />
      <div className="relative px-5 py-6 sm:px-9 sm:py-8">
        {eyebrow && <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.16em] text-primary">{eyebrow}</p>}
        <h1 className="text-balance text-[25px] font-semibold leading-[1.2] tracking-[-0.035em] text-foreground sm:text-[32px]">{title}</h1>
        {helper && <div className="mt-3 max-w-[58ch] text-sm leading-6 text-muted-foreground">{helper}</div>}
        {children && <div className="mt-7">{children}</div>}
      </div>
      {footer && <div className="relative border-t border-foreground/10 bg-background/20 px-5 py-4 sm:px-9 sm:py-5">{footer}</div>}
    </motion.section>
  );
}
