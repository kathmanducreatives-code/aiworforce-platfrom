import { ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  label?: string;
  className?: string;
}

/**
 * Tiny "Draft only · Nothing sent" safety badge. Reused everywhere Penn
 * surfaces drafts so the assurance looks identical and stays compact.
 */
export default function SafetyChip({ label = 'Draft only · Nothing sent', className }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium',
        'border border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-300',
        className,
      )}
    >
      <ShieldCheck className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}
