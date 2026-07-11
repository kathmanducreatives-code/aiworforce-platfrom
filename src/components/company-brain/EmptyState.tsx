// Intentional empty state for Company Brain fields.
//
// Replaces flat italic "Not set" with a compact dashed glass area that guides
// the user: a plus icon, one sentence explaining why the field matters, and an
// optional click target that opens the correct edit section.

import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

export function EmptyState({
  hint,
  onAdd,
  className,
}: {
  /** One sentence explaining why this field matters. */
  hint: string;
  /** Optional click target that opens the correct edit section. */
  onAdd?: () => void;
  className?: string;
}) {
  const Cmp = onAdd ? 'button' : 'div';
  return (
    <Cmp
      type={onAdd ? 'button' : undefined}
      onClick={onAdd}
      className={cn(
        'flex w-full items-center gap-2 rounded-xl border border-dashed border-border/45 bg-background/20 px-2.5 py-1.5 text-left',
        'text-[12px] text-muted-foreground/80 transition-colors',
        onAdd && 'hover:border-primary/45 hover:bg-primary/[0.05] hover:text-foreground/90',
        className,
      )}
    >
      <Plus className="h-3.5 w-3.5 shrink-0 text-primary/70" />
      <span className="leading-snug">{hint}</span>
    </Cmp>
  );
}
