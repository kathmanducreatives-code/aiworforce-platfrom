// ONE EMPTY STATE for department pages: the emerald mark (EMPTY_MARK), a title,
// one line of guidance, optional actions. `framed` draws the dashed well used
// inside a list; `size="lg"` is a whole canvas with nothing in it yet.

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EMPTY_MARK } from '@/components/layout/workspaceStyles';

interface Props {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Small emerald label above a large title. */
  kicker?: string;
  framed?: boolean;
  align?: 'center' | 'start';
  size?: 'md' | 'lg';
  className?: string;
}

export default function DepartmentEmptyState({ icon: Icon, title, description, actions, kicker, framed = false, align = 'center', size = 'md', className }: Props) {
  const lg = size === 'lg';
  return (
    <div
      className={cn(
        'flex flex-col justify-center',
        align === 'center' ? 'items-center text-center' : 'items-start text-left',
        framed && 'rounded-xl border border-dashed border-[var(--ag-line-strong)] bg-[var(--ag-fill)] px-6 py-12',
        className,
      )}
    >
      <span className={cn(EMPTY_MARK, lg ? 'mb-5 h-11 w-11' : 'mb-3 h-10 w-10')}>
        <Icon className={lg ? 'h-5 w-5' : 'h-[18px] w-[18px]'} />
      </span>
      {kicker && <p className="text-[12px] font-medium text-emerald-300/90">{kicker}</p>}
      <p className={cn('font-semibold tracking-[-0.01em] text-foreground', lg ? 'mt-2 text-[22px]' : 'text-[14px]')}>{title}</p>
      {description && (
        <p className={cn('max-w-[46ch] text-muted-foreground/70', lg ? 'mt-2 text-[14px] leading-relaxed' : 'mt-1 text-[12.5px]')}>{description}</p>
      )}
      {actions && <div className={cn('flex gap-2', lg ? 'mt-6' : 'mt-4')}>{actions}</div>}
    </div>
  );
}
