// Credit lifecycle helpers (frontend v1).
//
// v1 storage: workspace credit state lives inside `company_brain.profile.credits`
// as a JSON blob. Interfaces are designed so a future migration to dedicated
// `workspace_credits` / `credit_transactions` tables is mechanical.
//
// NOTHING here calls payment providers and NOTHING auto-sends outreach. Every
// reservation is the result of an explicit user confirmation in the UI.

import { supabase } from '@/integrations/supabase/client';
import { getWorkflowCost, computeActualCharge } from '@/lib/pricing/workflowCosts';
import { getPlan } from '@/lib/pricing/plans';

export type CreditTxnType =
  | 'monthly_grant'
  | 'workflow_estimate'
  | 'reservation'
  | 'charge'
  | 'partial_refund'
  | 'refund'
  | 'manual_adjustment'
  | 'overage_purchase';

export type CreditTxnStatus =
  | 'estimated'
  | 'reserved'
  | 'charged'
  | 'partial'
  | 'minimum_charge'
  | 'not_charged'
  | 'refunded';

export interface CreditTransaction {
  id: string;
  workflow_id?: string;
  workflow_title?: string;
  transaction_type: CreditTxnType;
  status: CreditTxnStatus;
  estimated_credits?: number;
  reserved_credits?: number;
  actual_credits?: number;
  refunded_credits?: number;
  reason?: string;
  created_at: string;
}

export interface CreditState {
  plan_id: string;
  credit_balance: number;
  monthly_credit_allowance: number;
  billing_status: 'trial' | 'active' | 'past_due' | 'canceled';
  current_period_start: string;
  current_period_end: string;
  transactions: CreditTransaction[];
}

const DEFAULT_STATE = (): CreditState => {
  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  return {
    plan_id: 'free_trial',
    credit_balance: 30,
    monthly_credit_allowance: 30,
    billing_status: 'trial',
    current_period_start: now.toISOString(),
    current_period_end: periodEnd.toISOString(),
    transactions: [
      {
        id: cryptoRandomId(),
        transaction_type: 'monthly_grant',
        status: 'charged',
        actual_credits: 30,
        reason: 'Free trial credits',
        created_at: now.toISOString(),
      },
    ],
  };
};

export function isDevBypass(): boolean {
  return (
    import.meta.env?.VITE_DEV_BYPASS_CREDITS === 'true' ||
    import.meta.env?.MODE === 'development'
  );
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `txn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function getWorkspaceId(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as { workspace_id?: string } | null)?.workspace_id ?? null;
}

async function loadBrain(workspaceId: string): Promise<{ profile: Record<string, unknown> }> {
  const { data } = await supabase
    .from('company_brain')
    .select('profile')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  const profile = (data?.profile as Record<string, unknown> | null) ?? {};
  return { profile };
}

async function saveCreditState(workspaceId: string, state: CreditState): Promise<void> {
  const { profile } = await loadBrain(workspaceId);
  const next = { ...profile, credits: state };
  await supabase
    .from('company_brain')
    .upsert(
      { workspace_id: workspaceId, profile: next as unknown as never },
      { onConflict: 'workspace_id' },
    );
}

export async function getCreditState(): Promise<CreditState> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return DEFAULT_STATE();
  const workspaceId = await getWorkspaceId(user.id);
  if (!workspaceId) return DEFAULT_STATE();
  const { profile } = await loadBrain(workspaceId);
  const existing = (profile?.credits as CreditState | undefined) ?? null;
  if (!existing) {
    const fresh = DEFAULT_STATE();
    await saveCreditState(workspaceId, fresh);
    return fresh;
  }
  return existing;
}

export async function reserveCredits(opts: {
  workflowId: string;
  workflowTitle?: string;
  estimatedCredits: number;
  metadata?: Record<string, unknown>;
}): Promise<
  | { ok: true; transactionId: string; balanceAfter: number; devBypass: boolean }
  | { ok: false; error: 'insufficient_credits'; balance: number; needed: number }
> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { ok: true, transactionId: 'dev', balanceAfter: 0, devBypass: true };
  }
  const workspaceId = await getWorkspaceId(user.id);
  if (!workspaceId) return { ok: true, transactionId: 'dev', balanceAfter: 0, devBypass: true };

  const { profile } = await loadBrain(workspaceId);
  const state: CreditState = (profile?.credits as CreditState | undefined) ?? DEFAULT_STATE();

  if (isDevBypass()) {
    const txn: CreditTransaction = {
      id: cryptoRandomId(),
      workflow_id: opts.workflowId,
      workflow_title: opts.workflowTitle,
      transaction_type: 'reservation',
      status: 'reserved',
      estimated_credits: opts.estimatedCredits,
      reserved_credits: 0,
      reason: 'Dev mode — not charged',
      created_at: new Date().toISOString(),
    };
    state.transactions = [txn, ...state.transactions].slice(0, 100);
    await saveCreditState(workspaceId, state);
    return { ok: true, transactionId: txn.id, balanceAfter: state.credit_balance, devBypass: true };
  }

  if (state.credit_balance < opts.estimatedCredits) {
    return { ok: false, error: 'insufficient_credits', balance: state.credit_balance, needed: opts.estimatedCredits };
  }

  const txn: CreditTransaction = {
    id: cryptoRandomId(),
    workflow_id: opts.workflowId,
    workflow_title: opts.workflowTitle,
    transaction_type: 'reservation',
    status: 'reserved',
    estimated_credits: opts.estimatedCredits,
    reserved_credits: opts.estimatedCredits,
    created_at: new Date().toISOString(),
  };
  state.credit_balance -= opts.estimatedCredits;
  state.transactions = [txn, ...state.transactions].slice(0, 100);
  await saveCreditState(workspaceId, state);
  return { ok: true, transactionId: txn.id, balanceAfter: state.credit_balance, devBypass: false };
}

export async function finalizeCharge(opts: {
  transactionId: string;
  workflowId: string;
  estimated: number;
  requested: number;
  accepted: number;
  providerRan: boolean;
  failedBeforeProvider?: boolean;
  resultSummary?: string;
}): Promise<{ actual: number; refunded: number; status: CreditTxnStatus }> {
  const { actual, status } = computeActualCharge({
    estimated: opts.estimated,
    requested: opts.requested,
    accepted: opts.accepted,
    providerRan: opts.providerRan,
    failedBeforeProvider: opts.failedBeforeProvider,
  });
  const refunded = Math.max(0, opts.estimated - actual);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { actual, refunded, status };
  const workspaceId = await getWorkspaceId(user.id);
  if (!workspaceId) return { actual, refunded, status };

  const { profile } = await loadBrain(workspaceId);
  const state: CreditState = (profile?.credits as CreditState | undefined) ?? DEFAULT_STATE();

  if (!isDevBypass()) {
    // Refund difference to balance (reservation already deducted full estimate).
    state.credit_balance += refunded;
  }

  // Update reservation row + add charge row.
  state.transactions = state.transactions.map((t) =>
    t.id === opts.transactionId
      ? { ...t, status, actual_credits: actual, refunded_credits: refunded, reason: opts.resultSummary }
      : t,
  );
  state.transactions.unshift({
    id: cryptoRandomId(),
    workflow_id: opts.workflowId,
    transaction_type: refunded > 0 ? 'partial_refund' : 'charge',
    status,
    actual_credits: actual,
    refunded_credits: refunded,
    reason: opts.resultSummary,
    created_at: new Date().toISOString(),
  });
  state.transactions = state.transactions.slice(0, 100);
  await saveCreditState(workspaceId, state);
  return { actual, refunded, status };
}

export async function refundCredits(transactionId: string, amount: number, reason: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const workspaceId = await getWorkspaceId(user.id);
  if (!workspaceId) return;
  const { profile } = await loadBrain(workspaceId);
  const state: CreditState = (profile?.credits as CreditState | undefined) ?? DEFAULT_STATE();
  state.credit_balance += amount;
  state.transactions.unshift({
    id: cryptoRandomId(),
    transaction_type: 'refund',
    status: 'refunded',
    refunded_credits: amount,
    reason,
    created_at: new Date().toISOString(),
  });
  await saveCreditState(workspaceId, state);
}

export function formatCredits(n: number): string {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.round(n)));
}

export function creditsToOverageUsd(credits: number, planId: string): number {
  const plan = getPlan(planId);
  return Math.round(credits * plan.overagePerCredit * 100) / 100;
}

export { getWorkflowCost };
