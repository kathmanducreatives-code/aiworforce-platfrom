// Premium reusable section card for the saved Company Brain surface.
//
// Visual layers mirror the onboarding SceneFrame but lighter and more practical:
//   - gradient border shell
//   - translucent dark glass surface + backdrop blur
//   - inner top highlight + top hairline
//   - soft emerald ambient glow (contained, no viewport bleed)
//   - deep black depth shadow underneath
//   - subtle film grain
//   - 20px radius (sharper than bubbly onboarding)
//   - clean hover lift + soft edge-glow
//   - staggered entrance animation (honors reduced-motion)
//
// Health is shown as a small dot + short label, never a big percentage.

import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/company-brain/Pill';
import { HEALTH_LABEL, type SectionHealth } from '@/lib/companyBrainSections';
import { cn } from '@/lib/utils';

const NOISE_URI =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")";

const HEALTH_DOT_CLS: Record<SectionHealth, string> = {
  configured: 'bg-primary',
  'needs-confirmation': 'bg-amber-400',
  'needs-detail': 'bg-muted-foreground/60',
};

const HEALTH_PILL_TONE: Record<SectionHealth, 'emerald' | 'amber' | 'neutral'> = {
  configured: 'emerald',
  'needs-confirmation': 'amber',
  'needs-detail': 'neutral',
};

interface Props {
  eyebrow: string;
  title: string;
  explanation: string;
  icon?: React.ComponentType<{ className?: string }>;
  health: SectionHealth;
  /** Optional small confidence whisper, e.g. "From your website". */
  whisper?: string;
  onEdit?: () => void;
  /** Edit-button label override; defaults to "Edit". */
  editLabel?: string;
  children: ReactNode;
  /** Index used for staggered entrance. */
  index?: number;
  /** Whether this card was just saved — triggers a confirmation pulse. */
  justSaved?: boolean;
  className?: string;
}

export function BrainSectionCard({
  eyebrow, title, explanation, icon: Icon, health, whisper, onEdit, editLabel = 'Edit',
  children, index = 0, justSaved, className,
}: Props) {
  const reduce = useReducedMotion();
  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: reduce ? 0 : 0.06 * index, ease: [0.22, 1, 0.36, 1] }}
      whileHover={reduce ? undefined : { y: -3 }}
      className={cn('group relative h-full', className)}
    >
      {/* contained emerald ambient glow (no viewport bleed) */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-3 -top-4 -bottom-4 -z-10 opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100"
        style={{ background: 'radial-gradient(60% 60% at 50% 18%, hsl(var(--primary) / 0.16), transparent 72%)' }}
      />

      {/* gradient border shell */}
      <div
        className={cn(
          'rounded-[20px] p-px transition-shadow duration-500',
          justSaved && 'shadow-[0_0_0_2px_hsl(var(--primary)/0.45),0_0_40px_-6px_hsl(var(--primary)/0.5)]',
        )}
        style={{
          background:
            'linear-gradient(165deg, hsl(var(--primary) / 0.40) 0%, hsl(var(--border) / 0.45) 24%, hsl(var(--border) / 0.16) 55%, hsl(var(--primary) / 0.20) 100%)',
        }}
      >
        <div
          className="relative flex h-full flex-col gap-4 overflow-hidden rounded-[19px] px-5 py-5 backdrop-blur-xl"
          style={{
            background: 'linear-gradient(180deg, hsl(var(--card) / 0.66) 0%, hsl(var(--card) / 0.48) 100%)',
            boxShadow: [
              'inset 0 1px 0 hsl(var(--foreground) / 0.07)',
              '0 40px 80px -48px rgba(0,0,0,0.85)',
              '0 18px 56px -34px hsl(var(--primary) / 0.30)',
            ].join(', '),
          }}
        >
          {/* top gradient hairline */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-6 top-0 h-px"
            style={{ background: 'linear-gradient(to right, transparent, hsl(var(--primary) / 0.55), transparent)' }}
          />
          {/* interior sheen */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-20"
            style={{ background: 'linear-gradient(180deg, hsl(var(--foreground) / 0.035), transparent)' }}
          />
          {/* film grain */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.05] mix-blend-overlay"
            style={{ backgroundImage: NOISE_URI }}
          />

          <header className="relative flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              {Icon && (
                <div
                  className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10"
                  style={{ boxShadow: '0 0 16px -6px hsl(var(--primary) / 0.5)' }}
                >
                  <Icon className="h-4 w-4 text-primary" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/80">{eyebrow}</p>
                <h3 className="mt-0.5 text-[15px] font-semibold leading-tight tracking-tight text-foreground">{title}</h3>
                <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">{explanation}</p>
              </div>
            </div>
          </header>

          <div className="relative flex items-center gap-2">
            <span className={cn('h-1.5 w-1.5 rounded-full', HEALTH_DOT_CLS[health], health === 'configured' && 'shadow-[0_0_6px_hsl(var(--primary)/0.6)]')} />
            <Pill tone={HEALTH_PILL_TONE[health]} className="!px-2 !py-[2px] !text-[11px]">
              {HEALTH_LABEL[health]}
            </Pill>
            {whisper && (
              <span className="truncate text-[11px] text-muted-foreground/60">{whisper}</span>
            )}
          </div>

          <div className="relative flex-1 text-[13px] leading-relaxed text-foreground/90">{children}</div>

          {onEdit && (
            <div className="relative flex justify-end">
              <Button
                size="sm"
                variant="ghost"
                onClick={onEdit}
                className="h-8 shrink-0 gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <Pencil className="h-3.5 w-3.5" /> {editLabel}
              </Button>
            </div>
          )}
        </div>
      </div>
    </motion.section>
  );
}

// ---- small content helpers used by the dashboard ---------------------------------

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <div className="text-[13px] text-foreground/90">{children}</div>
    </div>
  );
}
