import { useState } from 'react';
import { Coins } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCreditBalance } from '@/hooks/useCreditBalance';
import { formatCredits } from '@/lib/credits/ledger';
import CreditDrawer from './CreditDrawer';

interface Props {
  collapsed?: boolean;
}

export default function CreditPill({ collapsed }: Props) {
  const [open, setOpen] = useState(false);
  const { state, loading, refresh } = useCreditBalance();
  const balance = state?.credit_balance ?? 0;
  const low = balance < 20;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-tour="sidebar-credits"
        className={cn(
          'flex items-center gap-2 w-full h-9 px-3 rounded-md text-[13px] font-medium border transition-all',
          'bg-emerald-500/[0.06] border-emerald-500/25 text-emerald-200 hover:bg-emerald-500/[0.1] hover:border-emerald-500/40',
          low && 'bg-amber-500/[0.06] border-amber-500/25 text-amber-200 hover:bg-amber-500/[0.1]',
          collapsed && 'justify-center px-2',
        )}
        title={`${formatCredits(balance)} credits remaining`}
      >
        <Coins className="h-4 w-4 shrink-0" />
        {!collapsed && (
          <>
            <span className="truncate flex-1 text-left tabular-nums">
              {loading ? '…' : low ? `Low · ${formatCredits(balance)} credits left` : `${formatCredits(balance)} credits`}
            </span>
            {state?.billing_status === 'trial' && (
              <span className="text-[10px] font-mono uppercase tracking-wider opacity-70">Trial</span>
            )}
          </>
        )}
      </button>
      <CreditDrawer open={open} onClose={() => { setOpen(false); refresh(); }} />
    </>
  );
}
