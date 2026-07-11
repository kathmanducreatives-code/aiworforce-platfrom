// One glass card per scene — the visual hero of the onboarding.
//
// Premium treatment: wide presence (760–900px), gradient border shell, inner
// top highlight, emerald ambient aura, layered depth shadow and a whisper of
// noise so the glass never reads flat. Owns the fade+lift transition and the
// standard layout: eyebrow → headline → helper → body → footer CTAs.
//
// No internal scrollbars by design: scenes pass compact content. The whole
// page can scroll on very short viewports, but a scene never scrolls inside.

import type { ReactNode } from 'react';
import { motion } from 'framer-motion';

// Barely-there film grain so the glass surface has texture (inline, no asset).
const NOISE_URI =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")";

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
  const max = width === 'xl' ? 'max-w-[900px]' : width === 'lg' ? 'max-w-[820px]' : 'max-w-[760px]';
  return (
    <motion.div
      initial={{ opacity: 0, y: 18, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12, scale: 0.99 }}
      transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
      className={`relative mx-auto w-full ${max}`}
    >
      {/* emerald ambient aura hugging the card */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-10 -top-14 -bottom-10 -z-10 opacity-80 blur-3xl"
        style={{ background: 'radial-gradient(55% 55% at 50% 12%, hsl(var(--primary) / 0.14), transparent 72%)' }}
      />

      {/* gradient border shell */}
      <div
        className="rounded-[22px] p-px"
        style={{
          background:
            'linear-gradient(165deg, hsl(var(--primary) / 0.45) 0%, hsl(var(--border) / 0.5) 22%, hsl(var(--border) / 0.18) 55%, hsl(var(--primary) / 0.22) 100%)',
        }}
      >
        <div
          className="relative overflow-hidden rounded-[21px] px-6 py-8 backdrop-blur-2xl sm:px-10 sm:py-10"
          style={{
            background:
              'linear-gradient(180deg, hsl(var(--card) / 0.72) 0%, hsl(var(--card) / 0.55) 100%)',
            boxShadow: [
              'inset 0 1px 0 hsl(var(--foreground) / 0.07)',           // inner top highlight
              '0 50px 100px -48px rgba(0,0,0,0.85)',                    // depth below
              '0 24px 80px -36px hsl(var(--primary) / 0.35)',           // emerald bloom
            ].join(', '),
          }}
        >
          {/* top gradient hairline */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-8 top-0 h-px"
            style={{ background: 'linear-gradient(to right, transparent, hsl(var(--primary) / 0.6), transparent)' }}
          />
          {/* interior sheen falling from the top edge */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-28"
            style={{ background: 'linear-gradient(180deg, hsl(var(--foreground) / 0.035), transparent)' }}
          />
          {/* film grain */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.05] mix-blend-overlay"
            style={{ backgroundImage: NOISE_URI }}
          />

          <div className="relative">
            {eyebrow && (
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.3em] text-primary/90">
                {eyebrow}
              </p>
            )}
            <h1 className="text-balance text-[26px] font-semibold leading-[1.12] tracking-[-0.022em] text-foreground sm:text-[32px]">
              {title}
            </h1>
            {helper && (
              <div className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-muted-foreground/90">
                {helper}
              </div>
            )}
            {children && <div className="mt-7">{children}</div>}
            {footer && <div className="mt-9">{footer}</div>}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
