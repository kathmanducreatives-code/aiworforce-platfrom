// Grouping wrapper for the Review "Brain Board".
// Renders a section header with icon, subtitle, and a masonry-friendly grid of children.

import type { ReactNode } from 'react';

interface Props {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function BrainSection({ icon, eyebrow, title, subtitle, children }: Props) {
  return (
    <section className="space-y-4">
      <header className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary shadow-[0_0_20px_hsl(var(--primary)/0.15)]">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/80">{eyebrow}</p>
          <h3 className="mt-0.5 text-lg font-semibold tracking-tight text-foreground">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </header>
      <div className="grid gap-4 md:grid-cols-2">{children}</div>
    </section>
  );
}
