// Monitoring plans (Signals recovery): the reviewable drafts LISA/ORION create, and their
// approval / activation. Reads are RLS-scoped to the member's workspace; every transition goes
// through the database function monitoring_plan_decide, which checks the caller's live role
// (owner / admin / editor). `available: false` means the held migration is not applied here.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface MonitoringPlanRow {
  id: string;
  kind: 'company' | 'icp';
  status: 'draft' | 'approved' | 'active' | 'rejected' | 'paused';
  title: string;
  target: Record<string, unknown>;
  signal_categories: string[];
  sources: string[];
  frequency: 'once' | 'daily' | 'weekly';
  estimated_usage: Record<string, unknown>;
  constraints: Record<string, unknown>;
  created_at: string;
}
export type PlanDecision = 'approve' | 'reject' | 'activate' | 'pause';

export function decisionText(outcome: string): string {
  switch (outcome) {
    case 'ok': return 'Done.';
    case 'forbidden_role': return 'Only an owner, admin or editor can do that.';
    case 'not_member': return 'You are not a member of this workspace.';
    case 'invalid_transition': return 'That step is not available for this plan right now.';
    case 'not_found': return 'That plan no longer exists.';
    default: return 'That did not go through. Nothing was changed.';
  }
}

export function useMonitoringPlans(workspaceId: string | null) {
  const [plans, setPlans] = useState<MonitoringPlanRow[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('monitoring_plans' as never)
        .select('id, kind, status, title, target, signal_categories, sources, frequency, estimated_usage, constraints, created_at')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) { setAvailable(false); setPlans([]); return; }
      setAvailable(true);
      setPlans((data ?? []) as unknown as MonitoringPlanRow[]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const decide = useCallback(async (planId: string, decision: PlanDecision): Promise<{ ok: boolean; message: string }> => {
    const { data, error } = await supabase.rpc('monitoring_plan_decide' as never, { p_plan_id: planId, p_decision: decision } as never);
    if (error) return { ok: false, message: error.message || 'That did not go through. Nothing was changed.' };
    const outcome = String((data as { outcome?: string } | null)?.outcome ?? '');
    await load();
    return { ok: outcome === 'ok', message: decisionText(outcome) };
  }, [load]);

  const active = plans.filter((p) => p.status === 'active');
  return { plans, available, loading, refresh: load, decide, activeCount: active.length };
}
