import { useNavigate } from 'react-router-dom';
import { X, Sparkles, TrendingUp, Clock, ExternalLink } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useCreditBalance } from '@/hooks/useCreditBalance';
import { formatCredits, isDevBypass } from '@/lib/credits/ledger';
import { getPlan } from '@/lib/pricing/plans';

interface Props {
  open: boolean;
  onClose: () => void;
}

function relTime(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function CreditDrawer({ open, onClose }: Props) {
  const { state, loading } = useCreditBalance();
  const navigate = useNavigate();
  const plan = getPlan(state?.plan_id ?? 'free_trial');
  const balance = state?.credit_balance ?? 0;
  const allowance = state?.monthly_credit_allowance ?? plan.credits;
  const used = Math.max(0, allowance - balance);
  const pct = allowance > 0 ? Math.min(100, Math.round((used / allowance) * 100)) : 0;
  const resetDate = state?.current_period_end
    ? new Date(state.current_period_end).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : '—';
  const txns = (state?.transactions ?? []).slice(0, 12);

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md bg-[#070708]/95 border-l border-white/[0.06] text-[#E6EBF0] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-2 text-[#F0F6FC]">
            <Sparkles className="h-4 w-4 text-emerald-300" /> Credits & usage
          </SheetTitle>
          <SheetDescription className="text-neutral-400 text-[13px]">
            Credits are used when your AI workforce runs real work. Confirmation cards always show the estimated cost first.
          </SheetDescription>
        </SheetHeader>

        {isDevBypass() && (
          <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[12px] text-amber-200">
            Dev mode · credits are estimated locally and not charged.
          </div>
        )}

        <div className="mt-5 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.14em] font-mono text-neutral-500">Balance</div>
              <div className="text-3xl font-semibold tabular-nums text-[#F0F6FC]">
                {loading ? '—' : formatCredits(balance)}
              </div>
              <div className="text-[12px] text-neutral-400 mt-1">
                of {formatCredits(allowance)} this cycle · resets {resetDate}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-[0.14em] font-mono text-neutral-500">Plan</div>
              <div className="text-[14px] font-semibold text-emerald-300">{plan.name}</div>
              <div className="text-[11px] text-neutral-500 capitalize">{state?.billing_status ?? 'trial'}</div>
            </div>
          </div>

          <div className="mt-4 h-2 rounded-full bg-white/[0.04] overflow-hidden">
            <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-neutral-500 tabular-nums">
            <span>{formatCredits(used)} used</span>
            <span>{pct}%</span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button
            variant="default"
            className="bg-emerald-600 hover:bg-emerald-500"
            onClick={() => { onClose(); navigate('/settings/billing'); }}
          >
            <TrendingUp className="h-4 w-4 mr-1.5" /> Upgrade
          </Button>
          <Button
            variant="outline"
            className="border-white/10 bg-white/[0.02] hover:bg-white/[0.05]"
            onClick={() => { onClose(); navigate('/settings/billing'); }}
          >
            Buy more credits
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-neutral-500">
          Overage on {plan.name}: ${plan.overagePerCredit.toFixed(2)} per credit.
        </p>

        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] uppercase tracking-[0.14em] font-mono text-neutral-500">Recent activity</div>
            <button onClick={() => { onClose(); navigate('/settings/billing'); }} className="text-[11px] text-emerald-300 inline-flex items-center gap-1 hover:underline">
              View all <ExternalLink className="h-3 w-3" />
            </button>
          </div>
          {txns.length === 0 ? (
            <div className="rounded-md border border-white/[0.06] bg-white/[0.02] p-4 text-[12.5px] text-neutral-500">
              No activity yet. Run a workflow from the Workflow Center to get started.
            </div>
          ) : (
            <div className="space-y-1.5">
              {txns.map((t) => {
                const delta = t.transaction_type === 'reservation' || t.transaction_type === 'charge'
                  ? -(t.actual_credits ?? t.reserved_credits ?? t.estimated_credits ?? 0)
                  : (t.refunded_credits ?? t.actual_credits ?? 0);
                const positive = delta > 0;
                return (
                  <div key={t.id} className="flex items-center gap-3 rounded-md border border-white/[0.05] bg-white/[0.015] px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] text-[#E6EBF0] truncate">
                        {t.workflow_title || t.workflow_id || labelForType(t.transaction_type)}
                      </div>
                      <div className="text-[11px] text-neutral-500 flex items-center gap-1.5">
                        <Clock className="h-3 w-3" /> {relTime(t.created_at)} · {t.status.replace('_', ' ')}
                      </div>
                    </div>
                    <div className={`text-[13px] font-mono tabular-nums ${positive ? 'text-emerald-300' : 'text-neutral-300'}`}>
                      {positive ? '+' : ''}{delta}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <button onClick={onClose} className="absolute top-4 right-4 text-neutral-500 hover:text-white" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </SheetContent>
    </Sheet>
  );
}

function labelForType(t: string): string {
  switch (t) {
    case 'monthly_grant': return 'Monthly credit grant';
    case 'refund': return 'Refund';
    case 'partial_refund': return 'Partial refund';
    case 'overage_purchase': return 'Overage purchase';
    case 'manual_adjustment': return 'Adjustment';
    default: return t.replace('_', ' ');
  }
}
