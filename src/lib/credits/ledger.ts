// CREDIT DISPLAY. READ-ONLY, AND DELIBERATELY POWERLESS.
//
// WHAT THIS USED TO BE, AND WHY IT CHANGED.
//
// This module used to hold the balance itself, in `company_brain.profile.credits`
// — a JSON blob that RLS policy `company_brain_member_update` lets ANY workspace
// member write. It also exported `reserveCredits`, `finalizeCharge` and
// `refundCredits`, which did balance arithmetic in the browser: read the
// balance, subtract, write it back. Two things saved it from being a hole. It
// was never called by anything, and nothing charged.
//
// Stage 3 charges. So the balance moved to `workspace_credit_balances`, behind
// tables with NO client write policy and functions only the service role may
// execute. This file now READS that, and can do nothing else. The write
// functions are gone rather than deprecated: a live-looking `reserveCredits`
// sitting next to a real ledger is how the wrong one gets wired up.
//
// There is also no dev bypass any more. The browser cannot know whether a charge
// happened — the server decides — so a local flag claiming "not charged" was
// capable of being confidently wrong.

import { supabase } from '@/integrations/supabase/client';
import { getWorkflowCost } from '@/lib/pricing/workflowCosts';
import { getPlan } from '@/lib/pricing/plans';

/** Mirrors `credit_transactions.kind`. */
export type CreditTxnType =
  | 'founder_unlock'
  | 'contact_unlock'
  | 'grant'
  | 'adjustment';

/** Mirrors `credit_transactions.status`. */
export type CreditTxnStatus =
  | 'reserved'
  | 'charged'
  | 'partial'
  | 'not_charged'
  | 'released'
  | 'granted';

export interface CreditTransaction {
  id: string;
  transaction_type: CreditTxnType;
  status: CreditTxnStatus;
  estimated_credits: number;
  reserved_credits: number;
  actual_credits: number;
  refunded_credits: number;
  /**
   * Signed effect on the balance, computed once here.
   *
   * The two views that render history used to derive this themselves from the
   * transaction type, which meant a new type silently rendered a charge as a
   * credit. One derivation, one place.
   */
  delta_credits: number;
  /** The run this belonged to, when it belonged to one. */
  workflow_id?: string;
  workflow_title?: string;
  reason?: string;
  created_at: string;
}

export interface CreditState {
  plan_id: string;
  credit_balance: number;
  /** Held by an in-flight unlock: spent from the balance, not yet charged. */
  reserved_credits: number;
  transactions: CreditTransaction[];
  /**
   * NOT KNOWN SERVER-SIDE YET. Billing periods and allowances do not exist in
   * the ledger, and inventing a 30-day window here — which the old default
   * state did — puts a renewal date in front of a user that nothing honours.
   */
  monthly_credit_allowance?: number;
  billing_status?: 'trial' | 'active' | 'past_due' | 'canceled';
  current_period_start?: string;
  current_period_end?: string;
}

const EMPTY: CreditState = {
  plan_id: 'free_trial',
  credit_balance: 0,
  reserved_credits: 0,
  transactions: [],
};

const LABEL: Record<CreditTxnType, string> = {
  founder_unlock: 'Decision-maker unlock',
  contact_unlock: 'Contact unlock',
  grant: 'Credit grant',
  adjustment: 'Adjustment',
};

interface TxnRow {
  id: string;
  kind: CreditTxnType;
  status: CreditTxnStatus;
  estimated_credits: number | null;
  reserved_credits: number | null;
  actual_credits: number | null;
  refunded_credits: number | null;
  task_id: string | null;
  company_key: string | null;
  reason: string | null;
  created_at: string;
}

function toTransaction(r: TxnRow): CreditTransaction {
  const actual = r.actual_credits ?? 0;
  const reserved = r.reserved_credits ?? 0;
  // A grant adds; a reservation holds; anything finalized costs what it
  // actually charged, which for a released or zero-result unlock is nothing.
  const delta = r.kind === 'grant' || r.kind === 'adjustment'
    ? actual
    : r.status === 'reserved'
      ? -reserved
      : -actual;
  return {
    id: r.id,
    transaction_type: r.kind,
    status: r.status,
    estimated_credits: r.estimated_credits ?? 0,
    reserved_credits: reserved,
    actual_credits: actual,
    refunded_credits: r.refunded_credits ?? 0,
    delta_credits: delta,
    workflow_id: r.task_id ?? undefined,
    workflow_title: r.company_key
      ? `${LABEL[r.kind] ?? r.kind} · ${r.company_key}`
      : LABEL[r.kind] ?? r.kind,
    reason: r.reason ?? undefined,
    created_at: r.created_at,
  };
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

/**
 * Read the workspace's credit state.
 *
 * Both reads go through RLS as the signed-in user, so this returns their own
 * workspace's ledger or nothing. A workspace with no balance row has never been
 * granted credits, and is reported as zero rather than as a default allowance —
 * showing 30 free credits that the server will not honour is worse than showing
 * none.
 */
export async function getCreditState(): Promise<CreditState> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return EMPTY;
  const workspaceId = await getWorkspaceId(user.id);
  if (!workspaceId) return EMPTY;

  const [{ data: balance }, { data: txns }] = await Promise.all([
    supabase
      .from('workspace_credit_balances')
      .select('balance_credits, reserved_credits, plan_id')
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
    supabase
      .from('credit_transactions')
      .select(
        'id, kind, status, estimated_credits, reserved_credits, actual_credits,' +
        ' refunded_credits, task_id, company_key, reason, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  const b = balance as {
    balance_credits?: number; reserved_credits?: number; plan_id?: string;
  } | null;

  return {
    plan_id: b?.plan_id ?? 'free_trial',
    credit_balance: b?.balance_credits ?? 0,
    reserved_credits: b?.reserved_credits ?? 0,
    transactions: ((txns ?? []) as unknown as TxnRow[]).map(toTransaction),
  };
}

export function formatCredits(n: number): string {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.round(n)));
}

export function creditsToOverageUsd(credits: number, planId: string): number {
  const plan = getPlan(planId);
  return Math.round(credits * plan.overagePerCredit * 100) / 100;
}

export { getWorkflowCost };
