import { AlertTriangle, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { formatCredits } from '@/lib/credits/ledger';

interface Props {
  needed: number;
  balance: number;
  onClose?: () => void;
}

export default function InsufficientCreditsCard({ needed, balance, onClose }: Props) {
  const navigate = useNavigate();
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.05] p-4 space-y-3">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="h-5 w-5 text-amber-300 shrink-0 mt-0.5" />
        <div>
          <div className="text-[14px] font-semibold text-amber-200">
            Not enough credits to run this workflow
          </div>
          <div className="text-[13px] text-amber-100/80 mt-1">
            You need <span className="font-mono tabular-nums">{formatCredits(needed)}</span> credits and have{' '}
            <span className="font-mono tabular-nums">{formatCredits(balance)}</span>. Upgrade or buy more to continue.
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="bg-emerald-600 hover:bg-emerald-500"
          onClick={() => { onClose?.(); navigate('/settings/billing'); }}
        >
          <Sparkles className="h-3.5 w-3.5 mr-1.5" /> See plans
        </Button>
        {onClose && (
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
        )}
      </div>
    </div>
  );
}
