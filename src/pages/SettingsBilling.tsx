import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Coins, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useCreditBalance } from '@/hooks/useCreditBalance';
import { PRICING_PLANS, getPlan } from '@/lib/pricing/plans';
import { formatCredits, isDevBypass } from '@/lib/credits/ledger';

function relTime(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function SettingsBilling() {
  const navigate = useNavigate();
  const { state, loading } = useCreditBalance();
  const plan = getPlan(state?.plan_id ?? 'free_trial');
  const balance = state?.credit_balance ?? 0;
  const allowance = state?.monthly_credit_allowance ?? plan.credits;
  const used = Math.max(0, allowance - balance);
  const pct = allowance > 0 ? Math.min(100, Math.round((used / allowance) * 100)) : 0;
  const txns = state?.transactions ?? [];

  return (
    <div className="min-h-screen">
      <div className="max-w-5xl mx-auto p-6 md:p-8 space-y-8 text-[#E6EBF0]">
        <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 text-[12.5px] text-neutral-400 hover:text-white">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>

        <header>
          <h1 className="text-2xl font-semibold text-[#F0F6FC] tracking-tight flex items-center gap-2">
            <Coins className="h-5 w-5 text-emerald-300" /> Billing & credits
          </h1>
          <p className="text-[14px] text-neutral-400 mt-1.5 max-w-2xl">
            Credits are consumed only when Agentory runs real work. You always see the estimated credit cost before starting.
            If a workflow returns partial results, Agentory charges fairly.
          </p>
        </header>

        {isDevBypass() && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[12.5px] text-amber-200">
            Dev mode · credits estimated locally, not charged.
          </div>
        )}

        {/* Plan & credits */}
        <section className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.14em] font-mono text-neutral-500">Current plan</div>
              <div className="text-xl font-semibold text-[#F0F6FC] mt-0.5">{plan.name}</div>
              <div className="text-[13px] text-neutral-400">{plan.description}</div>
              <div className="text-[12px] text-neutral-500 mt-1 capitalize">Billing status: {state?.billing_status ?? 'trial'}</div>
            </div>
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-[0.14em] font-mono text-neutral-500">Credits remaining</div>
              <div className="text-3xl font-semibold text-[#F0F6FC] tabular-nums">{loading ? '—' : formatCredits(balance)}</div>
              <div className="text-[12px] text-neutral-500">
                of {formatCredits(allowance)} monthly credits · next reset{' '}
                {state?.current_period_end
                  ? new Date(state.current_period_end).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                  : '—'}
              </div>
            </div>
          </div>
          <div className="mt-5 h-2.5 rounded-full bg-white/[0.04] overflow-hidden">
            <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-2 flex items-center justify-between text-[12px] text-neutral-500 tabular-nums">
            <span>{formatCredits(used)} credits used this period</span>
            <span>{pct}%</span>
          </div>
          <div className="mt-4 text-[12px] text-neutral-500">
            Overage: ${plan.overagePerCredit.toFixed(2)} per credit on {plan.name}.
          </div>
        </section>

        {/* Plans */}
        <section>
          <h2 className="text-[16px] font-semibold text-[#F0F6FC] mb-3">Plans</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {PRICING_PLANS.map((p) => {
              const current = p.id === plan.id;
              return (
                <div
                  key={p.id}
                  className={`rounded-xl border p-4 ${
                    p.highlighted ? 'border-emerald-500/35 bg-emerald-500/[0.04]' : 'border-white/[0.07] bg-white/[0.02]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="text-[14px] font-semibold text-[#F0F6FC]">{p.name}</div>
                    {current && (
                      <span className="text-[10px] uppercase tracking-wider font-mono text-emerald-300 border border-emerald-500/30 rounded px-1.5 py-0.5">Current</span>
                    )}
                  </div>
                  <div className="mt-1 text-[12px] text-neutral-400">{p.description}</div>
                  <div className="mt-3">
                    <span className="text-2xl font-semibold tabular-nums text-[#F0F6FC]">€{p.priceMonthly}</span>
                    <span className="text-[12px] text-neutral-500">/mo</span>
                  </div>
                  <div className="text-[12px] text-emerald-300 mt-1 font-mono tabular-nums">
                    {formatCredits(p.credits)} credits · {p.seats} seat{p.seats > 1 ? 's' : ''}
                  </div>
                  <ul className="mt-3 space-y-1.5">
                    {p.features.slice(0, 5).map((f) => (
                      <li key={f} className="flex items-start gap-1.5 text-[12px] text-neutral-300">
                        <Check className="h-3 w-3 text-emerald-400 mt-0.5 shrink-0" /> {f}
                      </li>
                    ))}
                  </ul>
                  <Button
                    variant={p.highlighted ? 'default' : 'outline'}
                    size="sm"
                    className={`w-full mt-4 ${p.highlighted ? 'bg-emerald-600 hover:bg-emerald-500' : 'border-white/10 bg-white/[0.02]'}`}
                    disabled={current}
                  >
                    {current ? 'Current plan' : 'Contact us'}
                  </Button>
                </div>
              );
            })}
          </div>
          <p className="text-[11.5px] text-neutral-500 mt-3">
            Checkout coming soon. Email founders@agentory.space to upgrade or buy overage credits.
          </p>
        </section>

        {/* Transactions */}
        <section id="history">
          <h2 className="text-[16px] font-semibold text-[#F0F6FC] mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-300" /> Recent credit activity
          </h2>
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
            {txns.length === 0 ? (
              <div className="p-6 text-[13px] text-neutral-500">No credit activity yet. Credits will appear here after workflows run.</div>
            ) : (
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-neutral-500 border-b border-white/[0.05]">
                    <th className="px-4 py-2 font-mono">When</th>
                    <th className="px-4 py-2 font-mono">Workflow</th>
                    <th className="px-4 py-2 font-mono">Type</th>
                    <th className="px-4 py-2 font-mono">Status</th>
                    <th className="px-4 py-2 font-mono text-right">Credits</th>
                  </tr>
                </thead>
                <tbody>
                  {txns.map((t) => {
                    const delta = t.transaction_type === 'reservation' || t.transaction_type === 'charge'
                      ? -(t.actual_credits ?? t.reserved_credits ?? t.estimated_credits ?? 0)
                      : (t.refunded_credits ?? t.actual_credits ?? 0);
                    const positive = delta > 0;
                    return (
                      <tr key={t.id} className="border-t border-white/[0.04] hover:bg-white/[0.015]">
                        <td className="px-4 py-2.5 text-neutral-400">{relTime(t.created_at)}</td>
                        <td className="px-4 py-2.5 text-neutral-200">{t.workflow_title || t.workflow_id || '—'}</td>
                        <td className="px-4 py-2.5 text-neutral-400 capitalize">{t.transaction_type.replace('_', ' ')}</td>
                        <td className="px-4 py-2.5 text-neutral-400 capitalize">{t.status.replace('_', ' ')}</td>
                        <td className={`px-4 py-2.5 font-mono tabular-nums text-right ${positive ? 'text-emerald-300' : 'text-neutral-200'}`}>
                          {positive ? '+' : ''}{delta}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
