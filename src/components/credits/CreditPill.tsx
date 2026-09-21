import { useState } from 'react';
import { IconCredits } from '@/components/nav/NavIcons';
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
      {/* Account status, not a call to action — a quiet emerald-inked row in
          the sidebar's own system (nav/sidebar.css). */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-tour="sidebar-credits"
        className={low ? 'sb__row sb__button sb__credits sb__credits--low' : 'sb__row sb__button sb__credits'}
        title={`${formatCredits(balance)} credits remaining`}
        aria-label={collapsed ? `${formatCredits(balance)} credits remaining` : undefined}
      >
        <IconCredits className="sb__icon" size={18} />
        <span className="sb__label sb__credits-value">
          {loading ? '…' : low ? `Low · ${formatCredits(balance)} credits left` : `${formatCredits(balance)} credits`}
        </span>
        {state?.billing_status === 'trial' && <span className="sb__credits-tag">Trial</span>}
      </button>
      <CreditDrawer open={open} onClose={() => { setOpen(false); refresh(); }} />
    </>
  );
}
