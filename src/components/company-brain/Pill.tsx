// Shared premium pill — the single chip style for the Company Brain surface.
//
// Rounded-full, translucent glass fill, soft emerald border, subtle inset
// highlight. Semantic tones keep the palette disciplined:
//   - emerald   confirmed targeting (industries, models, must-have, geography)
//   - neutral   buyer personas / roles (glass + emerald icon)
//   - signal    buying signals / triggers (cyan-green tint)
//   - warning   amber — reserved for needs-confirmation states
//   - danger    muted red — reserved for real disqualifier warnings
//   - default   plain glass for anything else
//
// Emerald is used sparingly on purpose; most pills are neutral/signal glass.

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type PillTone = 'emerald' | 'neutral' | 'signal' | 'warning' | 'danger' | 'default';

const TONE_CLS: Record<PillTone, string> = {
  emerald: [
    'border-primary/35 bg-primary/[0.10] text-foreground/90',
    'shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.06)]',
    'hover:border-primary/55 hover:bg-primary/[0.16]',
  ].join(' '),
  neutral: [
    'border-border/50 bg-background/45 text-foreground/85',
    'shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.05)]',
    'hover:border-primary/35 hover:bg-background/60',
  ].join(' '),
  signal: [
    'border-emerald-400/25 bg-emerald-400/[0.08] text-foreground/88',
    'shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.05)]',
    'hover:border-emerald-400/45 hover:bg-emerald-400/[0.14]',
  ].join(' '),
  warning: [
    'border-amber-400/35 bg-amber-400/[0.10] text-amber-100/90',
    'shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.05)]',
    'hover:border-amber-400/55 hover:bg-amber-400/[0.16]',
  ].join(' '),
  danger: [
    'border-red-500/30 bg-red-500/[0.09] text-red-100/85',
    'shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.05)]',
    'hover:border-red-500/50 hover:bg-red-500/[0.15]',
  ].join(' '),
  default: [
    'border-border/45 bg-background/40 text-foreground/80',
    'shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.04)]',
    'hover:border-border/70 hover:bg-background/55',
  ].join(' '),
};

export function Pill({
  children,
  tone = 'default',
  icon,
  className,
}: {
  children: ReactNode;
  tone?: PillTone;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px]',
        'text-[12px] font-medium leading-none tracking-tight',
        'transition-colors duration-200',
        TONE_CLS[tone],
        className,
      )}
    >
      {icon && <span className="flex shrink-0 [&>svg]:h-3 [&>svg]:w-3">{icon}</span>}
      <span className="truncate">{children}</span>
    </span>
  );
}
