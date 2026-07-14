// Reusable vertical-flow intelligence section for the saved Company Brain page.
//
// Editorial split inside one glass surface: left ~30% holds the oversized
// section number, eyebrow, title, narrative question, status, and Edit action;
// right ~70% holds the actual ICP values. Stacks vertically on tablet/mobile.
//
// Glass system: 26px radius, dark translucent surface, strong backdrop blur,
// low-opacity emerald border shell, soft top-edge highlight, contained ambient
// glow, deep black depth shadow, restrained hover lift, calm reveal animation.
// Honors prefers-reduced-motion.

import { useRef, type ReactNode } from 'react';
import { motion, useReducedMotion, useInView } from 'framer-motion';
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
  number: string;
  eyebrow: string;
  title: string;
  question: string;
  explanation: string;
  health: SectionHealth;
  onEdit: () => void;
  justSaved?: boolean;
  index?: number;
  children: ReactNode;
}

export function IcpSection({ number, eyebrow, title, question, explanation, health, onEdit, justSaved, index = 0, children }: Props) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });

  return (
    <motion.section
      ref={ref}
      initial={reduce ? false : { opacity: 0, y: 20, filter: 'blur(6px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="group relative"
    >
      {/* contained ambient glow — intensifies when in view (scroll-linked) */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-2 -top-4 -bottom-4 -z-10 blur-2xl transition-opacity duration-700 group-hover:opacity-100"
        style={{
          background: 'radial-gradient(50% 45% at 28% 12%, hsl(var(--primary) / 0.14), transparent 72%)',
          opacity: inView ? 0.65 : 0.3,
        }}
      />

      {/* gradient border shell — quieter border, brighter when active */}
      <div
        className={cn(
          'rounded-[26px] p-px transition-all duration-700',
          justSaved && 'shadow-[0_0_0_2px_hsl(var(--primary)/0.45),0_0_44px_-6px_hsl(var(--primary)/0.5)]',
        )}
        style={{
          background: inView
            ? 'linear-gradient(165deg, hsl(var(--primary) / 0.26) 0%, hsl(var(--border) / 0.20) 22%, hsl(var(--border) / 0.06) 55%, hsl(var(--primary) / 0.12) 100%)'
            : 'linear-gradient(165deg, hsl(var(--primary) / 0.14) 0%, hsl(var(--border) / 0.14) 22%, hsl(var(--border) / 0.04) 55%, hsl(var(--primary) / 0.06) 100%)',
        }}
      >
        <div
          className="relative overflow-hidden rounded-[25px] backdrop-blur-2xl backdrop-saturate-[1.5]"
          style={{
            background: 'linear-gradient(180deg, hsl(var(--card) / 0.46) 0%, hsl(var(--card) / 0.28) 100%)',
            boxShadow: [
              'inset 0 1px 0 hsl(var(--foreground) / 0.09)',
              '0 64px 130px -58px rgba(0,0,0,0.94)',
              '0 28px 80px -44px hsl(var(--primary) / 0.16)',
            ].join(', '),
          }}
        >
          {/* top hairline — brighter when in view */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-8 top-0 h-px transition-opacity duration-700"
            style={{
              background: 'linear-gradient(to right, transparent, hsl(var(--primary) / 0.55), transparent)',
              opacity: inView ? 1 : 0.4,
            }}
          />
          {/* interior sheen */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-24"
            style={{ background: 'linear-gradient(180deg, hsl(var(--foreground) / 0.035), transparent)' }}
          />
          {/* film grain */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.04] mix-blend-overlay"
            style={{ backgroundImage: NOISE_URI }}
          />

          {/* editorial split */}
          <div className="relative grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,12fr)]">
            {/* left-edge signal accent — threads through sections */}
            <div
              aria-hidden
              className="absolute left-0 top-8 bottom-8 w-px transition-opacity duration-700"
              style={{
                background: 'linear-gradient(to bottom, transparent, hsl(160 84% 52% / 0.40), transparent)',
                opacity: inView ? 0.9 : 0.35,
              }}
            />
            {/* left — meta */}
            <div className="border-b border-border/20 px-6 py-6 sm:px-7 lg:border-b-0 lg:border-r lg:px-7 lg:py-8">
              <div className="flex items-start gap-4">
                <span
                  className="select-none bg-gradient-to-br from-emerald-400/90 via-primary/70 to-emerald-600/40 bg-clip-text text-[42px] font-semibold leading-[0.9] tracking-tight text-transparent lg:text-[48px]"
                  style={{ filter: 'drop-shadow(0 2px 14px hsl(160 84% 52% / 0.25))' }}
                >
                  {number}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary/75">{eyebrow}</p>
                  <h3 className="mt-1 text-[18px] font-semibold leading-tight tracking-tight text-foreground lg:text-[20px]">{title}</h3>
                </div>
              </div>
              <p className="mt-3 text-[13.5px] font-medium leading-snug text-foreground/85">{question}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground/80">{explanation}</p>
              <div className="mt-4 flex items-center gap-2">
                <span className={cn('h-1.5 w-1.5 rounded-full', HEALTH_DOT_CLS[health], health === 'configured' && 'shadow-[0_0_6px_hsl(var(--primary)/0.6)]')} />
                <Pill tone={HEALTH_PILL_TONE[health]} className="!px-2 !py-[2px] !text-[11px]">
                  {HEALTH_LABEL[health]}
                </Pill>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={onEdit}
                className="mt-4 h-8 gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            </div>

            {/* right — values */}
            <div className="min-w-0 px-6 py-6 sm:px-7 lg:px-8 lg:py-8">
              {children}
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  );
}

// ---- value-presentation helpers ---------------------------------------------------

/** Label + pill row. For short categorical values. */
export function PillGroup({
  label, values, tone, emptyHint, onAdd,
}: {
  label: string;
  values: string[];
  tone: Parameters<typeof Pill>[0]['tone'];
  emptyHint?: string;
  onAdd?: () => void;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">{label}</p>
      {values.length ? (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <Pill key={v} tone={tone}>{v}</Pill>
          ))}
        </div>
      ) : emptyHint ? (
        <InlineAdd hint={emptyHint} onClick={onAdd} />
      ) : null}
    </div>
  );
}

/** Stacked text row for longer values (pain points, reject-if rules, etc.). */
export function TextRows({
  label, values, emptyHint, onAdd,
}: {
  label: string;
  values: string[];
  emptyHint?: string;
  onAdd?: () => void;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">{label}</p>
      {values.length ? (
        <ul className="space-y-1.5">
          {values.map((v) => (
            <li
              key={v}
              className="flex items-start gap-2.5 rounded-lg border border-border/25 bg-background/[0.18] px-3 py-2"
            >
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary/50" />
              <p className="text-[13px] leading-relaxed text-foreground/85">{v}</p>
            </li>
          ))}
        </ul>
      ) : emptyHint ? (
        <InlineAdd hint={emptyHint} onClick={onAdd} />
      ) : null}
    </div>
  );
}

/** Single statement block (positioning promise, voice tone). */
export function StatementField({
  label, value, emptyHint, onAdd, quote,
}: {
  label: string;
  value: string;
  emptyHint: string;
  onAdd?: () => void;
  quote?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">{label}</p>
      {value ? (
        <p className="text-[14px] leading-relaxed text-foreground/90">
          {quote ? <span className="text-primary/60">“</span> : null}
          {value}
          {quote ? <span className="text-primary/60">”</span> : null}
        </p>
      ) : (
        <InlineAdd hint={emptyHint} onClick={onAdd} />
      )}
    </div>
  );
}

/** Compact inline Add action for secondary missing fields. */
export function InlineAdd({ hint, onClick }: { hint: string; onClick?: () => void }) {
  const Cmp = onClick ? 'button' : 'span';
  return (
    <Cmp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 text-[12px] text-muted-foreground/60 transition-colors',
        onClick && 'hover:text-primary/80',
      )}
    >
      <span className="text-primary/50">+</span> {hint}
    </Cmp>
  );
}
