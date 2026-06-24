import { useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCompanyBrain } from './useCompanyBrain';

export interface ProductTourState {
  completed: boolean;
  completed_at: string | null;
  skipped_at: string | null;
  first_run_helper_dismissed: boolean;
}

const PENDING_KEY = 'agentory.product_tour_pending';

function readMeta(brain: Record<string, any> | null | undefined): ProductTourState {
  const m = (brain?.onboarding_meta ?? {}) as Record<string, any>;
  return {
    completed: !!m.product_tour_completed,
    completed_at: typeof m.product_tour_completed_at === 'string' ? m.product_tour_completed_at : null,
    skipped_at: typeof m.product_tour_skipped_at === 'string' ? m.product_tour_skipped_at : null,
    first_run_helper_dismissed: !!m.first_run_helper_dismissed,
  };
}

export function markTourPending() {
  try { sessionStorage.setItem(PENDING_KEY, '1'); } catch { /* noop */ }
}

function consumeTourPending(): boolean {
  try {
    const v = sessionStorage.getItem(PENDING_KEY);
    if (v) sessionStorage.removeItem(PENDING_KEY);
    return !!v;
  } catch { return false; }
}

export function useProductTour() {
  const { workspaceId, data, loading, refresh } = useCompanyBrain();
  const state = useMemo(() => readMeta(data?.profile), [data?.profile]);

  const save = useCallback(async (patch: Partial<Record<string, unknown>>) => {
    if (!workspaceId) return;
    const current = ((data?.profile?.onboarding_meta as Record<string, unknown>) ?? {});
    const next = { ...current, ...patch };
    await supabase.functions.invoke('setup-company-brain', {
      body: { action: 'save_structured', workspace_id: workspaceId, onboarding_meta: next },
    });
    refresh();
  }, [workspaceId, data?.profile, refresh]);

  const markCompleted = useCallback(() => save({
    product_tour_completed: true,
    product_tour_completed_at: new Date().toISOString(),
    product_tour_skipped_at: null,
  }), [save]);

  const markSkipped = useCallback(() => save({
    product_tour_completed: false,
    product_tour_skipped_at: new Date().toISOString(),
  }), [save]);

  const restart = useCallback(() => save({
    product_tour_completed: false,
    product_tour_completed_at: null,
    product_tour_skipped_at: null,
  }), [save]);

  const dismissFirstRunHelper = useCallback(() => save({
    first_run_helper_dismissed: true,
  }), [save]);

  // Auto-open conditions: brain ready, never completed, never skipped, OR pending flag set by onboarding.
  const shouldAutoOpen = useMemo(() => {
    if (loading) return false;
    if (!data) return false;
    if (!data.onboarding_completed) return false;
    if (state.completed) return false;
    if (state.skipped_at) return false;
    return true;
  }, [loading, data, state]);

  return {
    loading,
    state,
    shouldAutoOpen,
    consumeTourPending,
    markCompleted,
    markSkipped,
    restart,
    dismissFirstRunHelper,
  };
}
