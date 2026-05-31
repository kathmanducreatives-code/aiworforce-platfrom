import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/contexts/WorkspaceContext';

export interface CompanyBrainRow {
  profile: Record<string, any>;
  onboarding_completed: boolean;
  onboarding_completed_at: string | null;
}

export function useCompanyBrain() {
  const { workspaceId, loading: wsLoading } = useWorkspace();
  const [data, setData] = useState<CompanyBrainRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (wsLoading) return;
    if (!workspaceId) { setData(null); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    supabase
      .from('company_brain')
      .select('profile, onboarding_completed, onboarding_completed_at')
      .eq('workspace_id', workspaceId)
      .maybeSingle()
      .then(({ data: row }) => {
        if (cancelled) return;
        setData({
          profile: (row?.profile as any) ?? {},
          onboarding_completed: !!row?.onboarding_completed,
          onboarding_completed_at: row?.onboarding_completed_at ?? null,
        });
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [workspaceId, wsLoading, tick]);

  return { workspaceId, data, loading: loading || wsLoading, refresh };
}
