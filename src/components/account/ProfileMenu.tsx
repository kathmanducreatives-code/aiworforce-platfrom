import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, CreditCard, History, Settings as SettingsIcon, LogOut, TrendingUp } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/useAuth';
import { useCreditBalance } from '@/hooks/useCreditBalance';
import { getPlan } from '@/lib/pricing/plans';
import { formatCredits } from '@/lib/credits/ledger';
import CreditDrawer from '@/components/credits/CreditDrawer';
import { cn } from '@/lib/utils';

interface Props {
  collapsed?: boolean;
}

export default function ProfileMenu({ collapsed }: Props) {
  const navigate = useNavigate();
  const { profile, user, signOut } = useAuth();
  const { state, loading } = useCreditBalance();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const planId = state?.plan_id ?? 'free_trial';
  const plan = getPlan(planId);
  const balance = state?.credit_balance ?? (planId === 'free_trial' ? 30 : 0);
  const allowance = state?.monthly_credit_allowance ?? plan.credits;
  const isTrial = planId === 'free_trial' || state?.billing_status === 'trial';
  const billingConfigured = Boolean(state?.plan_id && state?.billing_status && state.billing_status !== 'trial');
  const renews = state?.current_period_end
    ? new Date(state.current_period_end).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  const initial = profile?.full_name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || 'A';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-tour="profile-menu"
            className={cn(
              'flex items-center gap-3 w-full rounded-md border border-transparent hover:border-white/[0.05] hover:bg-white/[0.03] transition-all',
              collapsed ? 'justify-center p-1.5' : 'px-2 py-1.5',
            )}
          >
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-semibold text-white shrink-0 shadow-inner"
              style={{ background: 'linear-gradient(135deg, hsl(var(--primary-dark)) 0%, hsl(var(--primary)) 100%)' }}
            >
              {initial}
            </div>
            {!collapsed && (
              <>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-[14px] font-medium text-foreground truncate leading-tight">
                    {profile?.full_name || 'Agentory'}
                  </p>
                  <p className="text-[11px] text-neutral-500 truncate font-mono">
                    {plan.name}
                  </p>
                </div>
                <ChevronDown className="h-3.5 w-3.5 text-neutral-500 shrink-0" />
              </>
            )}
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          side="right"
          align="end"
          sideOffset={8}
          className="w-[280px] bg-[#0a0a0b]/98 border-white/[0.08] text-[#E6EBF0] backdrop-blur-xl p-0"
        >
          {/* Identity */}
          <div className="px-3 py-3 border-b border-white/[0.05]">
            <p className="text-[13.5px] font-medium text-[#F0F6FC] truncate">
              {profile?.full_name || 'Agentory'}
            </p>
            <p className="text-[11.5px] text-neutral-500 truncate">{user?.email ?? '—'}</p>
          </div>

          {/* Subscription summary */}
          <div className="px-3 py-3 border-b border-white/[0.05] space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-[0.12em] font-mono text-neutral-500">Current plan</span>
              <span className="text-[12.5px] font-semibold text-emerald-300">{plan.name}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-neutral-400">Credits remaining</span>
              <span className="text-[12.5px] font-mono tabular-nums text-[#F0F6FC]">
                {loading ? '—' : formatCredits(balance)}
              </span>
            </div>
            {isTrial ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-neutral-400">Trial credits</span>
                  <span className="text-[12px] font-mono tabular-nums text-neutral-300">{formatCredits(allowance)}</span>
                </div>
                <p className="text-[11.5px] text-emerald-300/80 pt-1">Upgrade to unlock more workflows.</p>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-neutral-400">Monthly credits</span>
                  <span className="text-[12px] font-mono tabular-nums text-neutral-300">{formatCredits(allowance)}</span>
                </div>
                {renews && (
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-neutral-400">Renews</span>
                    <span className="text-[12px] text-neutral-300">{renews}</span>
                  </div>
                )}
              </>
            )}
            <div className="flex items-center justify-between pt-0.5">
              <span className="text-[12px] text-neutral-400">Billing status</span>
              <span className="text-[11.5px] text-neutral-300 capitalize">
                {billingConfigured ? (state?.billing_status ?? 'active') : 'Coming soon'}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="p-1">
            <DropdownMenuItem
              onSelect={(e) => { e.preventDefault(); setDrawerOpen(true); }}
              className="text-[13px] cursor-pointer focus:bg-white/[0.05]"
            >
              <CreditCard className="h-4 w-4 mr-2 text-neutral-400" /> Billing & Credits
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => navigate('/settings/billing')}
              className="text-[13px] cursor-pointer focus:bg-white/[0.05]"
            >
              <TrendingUp className="h-4 w-4 mr-2 text-neutral-400" /> Upgrade plan
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => navigate('/settings/billing#history')}
              className="text-[13px] cursor-pointer focus:bg-white/[0.05]"
            >
              <History className="h-4 w-4 mr-2 text-neutral-400" /> Credit history
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => navigate('/settings/integrations')}
              className="text-[13px] cursor-pointer focus:bg-white/[0.05]"
            >
              <SettingsIcon className="h-4 w-4 mr-2 text-neutral-400" /> Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-white/[0.05] my-1" />
            <DropdownMenuItem
              onSelect={() => signOut()}
              className="text-[13px] cursor-pointer focus:bg-white/[0.05] text-neutral-300 focus:text-rose-300"
            >
              <LogOut className="h-4 w-4 mr-2 text-neutral-400" /> Sign out
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreditDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}
