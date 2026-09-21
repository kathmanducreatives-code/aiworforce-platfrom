import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreditCard, History, Settings as SettingsIcon, LogOut, TrendingUp } from 'lucide-react';
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
import { IconChevronDown } from '@/components/nav/NavIcons';

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
          {/* Styled by the sidebar's system (nav/sidebar.css). Name and plan stay
              mounted when collapsed — they fade, and still name the button. */}
          <button
            type="button"
            data-tour="profile-menu"
            className="sb__account-trigger"
            title={collapsed ? (profile?.full_name || 'Account') : undefined}
          >
            <span className="sb__avatar" aria-hidden>{initial}</span>
            <span className="sb__account-meta">
              <span className="sb__account-name">{profile?.full_name || 'Agentory'}</span>
              <span className="sb__account-plan">{plan.name}</span>
            </span>
            <IconChevronDown className="sb__account-chevron" size={14} />
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
