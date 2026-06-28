import { Coins, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { formatCredits } from '@/lib/credits/ledger';
import { cn } from '@/lib/utils';

export type CreditsUsedVariant = 'success' | 'partial' | 'blocked';

interface Props {
  variant: CreditsUsedVariant;
  actual: number;
  estimated?: number;
  note?: string;
  className?: string;
}

/**
 * Standardized post-run credit usage row. Use after a workflow completes
 * to show actual vs estimated credits in consistent wording across the app.
 */
export default function CreditsUsedRow({ variant, actual, estimated, note, className }: Props) {
  const tone =
    variant === 'blocked'
      ? 'border-amber-500/25 bg-amber-500/[0.04] text-amber-200'
      : variant === 'partial'
        ? 'border-amber-500/20 bg-amber-500/[0.03] text-amber-100/90'
        : 'border-emerald-500/20 bg-emerald-500/[0.03] text-emerald-200';

  const Icon = variant === 'blocked' ? AlertTriangle : variant === 'partial' ? Coins : CheckCircle2;

  const label =
    variant === 'blocked'
      ? 'Credits used: 0'
      : estimated != null
        ? `Credits used: ${formatCredits(actual)} of estimated ${formatCredits(estimated)}`
        : `Credits used: ${formatCredits(actual)}`;

  const defaultNote =
    variant === 'blocked'
      ? 'Setup needed before this workflow can run.'
      : variant === 'partial'
        ? 'Scout returned partial results and rejected weak matches.'
        : undefined;

  return (
    <div className={cn('rounded-lg border px-3 py-2 text-[12.5px] flex items-start gap-2', tone, className)}>
      <Icon className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <div className="font-mono tabular-nums">{label}</div>
        {(note ?? defaultNote) && (
          <div className="text-[11.5px] opacity-80 mt-0.5">{note ?? defaultNote}</div>
        )}
      </div>
    </div>
  );
}
