// Small shared building blocks for the progressive scenes. Kept minimal and
// elegant: large inputs, a consistent Back/Continue footer, read-only chip
// rows, and a soft confirm check. No dense form grids anywhere.

import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** One large, elegant input with a label and subtle focus glow. */
export function SceneInput({
  label, value, onChange, placeholder, onEnter, autoFocus, type = 'text',
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onEnter?: () => void;
  autoFocus?: boolean;
  type?: string;
}) {
  return (
    <div>
      {label && (
        <p className="mb-2.5 text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground/90">{label}</p>
      )}
      <Input
        type={type}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(); } }}
        placeholder={placeholder}
        className={[
          'h-[54px] rounded-xl border-border/50 px-4 text-[15px]',
          'bg-[hsl(var(--background)/0.55)] shadow-[inset_0_1px_0_hsl(var(--foreground)/0.04)]',
          'placeholder:text-muted-foreground/45',
          'transition-[box-shadow,border-color,background-color] duration-300',
          'hover:border-border/80',
          'focus-visible:border-primary/60 focus-visible:bg-[hsl(var(--background)/0.7)]',
          'focus-visible:shadow-[0_0_0_3px_hsl(var(--primary)/0.14),0_0_28px_-8px_hsl(var(--primary)/0.5),inset_0_1px_0_hsl(var(--foreground)/0.05)]',
        ].join(' ')}
      />
    </div>
  );
}

/** Back + primary CTA. Primary is the main action; back is quiet. */
export function SceneFooter({
  onBack, backDisabled, primaryLabel, onPrimary, primaryDisabled, primaryBusy, secondary,
}: {
  onBack?: () => void;
  backDisabled?: boolean;
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  primaryBusy?: boolean;
  secondary?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Button
        size="lg"
        onClick={onPrimary}
        disabled={primaryDisabled || primaryBusy}
        className={[
          'group h-[52px] w-full gap-2 rounded-xl text-[15px] font-medium tracking-tight text-primary-foreground',
          'bg-gradient-to-b from-primary to-[hsl(var(--primary)/0.82)]',
          'shadow-[0_1px_0_hsl(var(--foreground)/0.12)_inset,0_10px_30px_-12px_hsl(var(--primary)/0.55)]',
          'transition-all duration-300',
          'hover:-translate-y-px hover:from-primary hover:to-primary',
          'hover:shadow-[0_1px_0_hsl(var(--foreground)/0.15)_inset,0_14px_40px_-12px_hsl(var(--primary)/0.7),0_0_30px_hsl(var(--primary)/0.25)]',
          'active:translate-y-0',
          'disabled:translate-y-0 disabled:opacity-45 disabled:saturate-[0.75] disabled:shadow-none',
        ].join(' ')}
      >
        {primaryBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {primaryLabel}
        {!primaryBusy && (
          <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
        )}
      </Button>
      <div className="flex items-center justify-between">
        {onBack ? (
          <Button
            variant="ghost" size="sm" onClick={onBack} disabled={backDisabled}
            className="text-muted-foreground/80 transition-colors hover:text-foreground"
          >
            <ArrowLeft className="mr-1.5 h-4 w-4 transition-transform duration-300 group-hover:-translate-x-0.5" /> Back
          </Button>
        ) : <span />}
        {secondary}
      </div>
    </div>
  );
}

/** Read-only chip row for showing what the AI found / drafted. */
export function ReadChips({ label, values, empty = 'None found', max = 10 }: { label: string; values: string[]; empty?: string; max?: number }) {
  const shown = values.slice(0, max);
  const rest = values.length - shown.length;
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      {shown.length === 0 ? (
        <p className="text-xs italic text-muted-foreground/60">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {shown.map((v) => (
            <span key={v} className="rounded-full border border-border/50 bg-background/50 px-2.5 py-1 text-xs text-foreground/85">{v}</span>
          ))}
          {rest > 0 && <span className="rounded-full border border-border/40 px-2.5 py-1 text-xs text-muted-foreground/70">+{rest} more</span>}
        </div>
      )}
    </div>
  );
}

/** A single labelled fact line for verification summaries. */
export function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-border/30 py-2 last:border-0">
      <p className="w-28 shrink-0 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/80">{label}</p>
      <p className="min-w-0 flex-1 text-sm text-foreground/90">{value || <span className="italic text-muted-foreground/50">Not found</span>}</p>
    </div>
  );
}

/** Soft green confirm check, used when a scene is accepted. */
export function ConfirmCheck() {
  return (
    <motion.span
      initial={{ scale: 0.4, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 18 }}
      className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
    >
      <Check className="h-3 w-3" />
    </motion.span>
  );
}
