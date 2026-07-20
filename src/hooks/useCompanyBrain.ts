// Company Brain read, cached per workspace.
//
// WHY THIS IS A QUERY AND NOT A useEffect
//   The previous implementation fetched inside `useEffect([workspaceId,
//   wsLoading, tick])` with local state, and set `loading` true on every run.
//   Returning to the browser tab produced this chain:
//
//     Supabase fires TOKEN_REFRESHED on focus
//       → useAuth setUser(session.user)          — NEW object identity
//       → WorkspaceContext effect deps [user, …] re-run
//       → setLoading(true)                        — wsLoading true
//       → this hook returned `loading: loading || wsLoading` → FULL-PAGE LOADER
//       → workspace resolves, effect re-runs, refetch
//       → a NEW `data` object reaches the editor  — unsaved edits clobbered
//
//   Caching the read removes the refetch. Deriving `loading` from "nothing to
//   show yet" rather than "a request is in flight" removes the flash even while
//   the workspace re-resolves.

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import type { BrainProfile } from '@/lib/companyBrainView';

export interface CompanyBrainRow {
  profile: BrainProfile;
  onboarding_completed: boolean;
  onboarding_completed_at: string | null;
}

/** Stable, workspace-scoped key. One workspace's cache can never serve another. */
export const companyBrainKey = (workspaceId: string | null | undefined) =>
  ['company_brain', workspaceId ?? null] as const;

export function useCompanyBrain() {
  const { workspaceId, loading: wsLoading } = useWorkspace();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: companyBrainKey(workspaceId),
    enabled: !wsLoading && !!workspaceId,

    // Five minutes of freshness: a tab switch or route return inside that
    // window renders from cache with no request at all.
    staleTime: 5 * 60_000,
    // Survive route unmounts comfortably.
    gcTime: 30 * 60_000,

    // Focus must never refetch. It is the event that caused the original bug,
    // and it tells us nothing staleTime does not already handle.
    refetchOnWindowFocus: false,
    // Regaining connectivity IS a real reason to re-read.
    refetchOnReconnect: true,
    // `true`, not `false`: remounting refetches once the data is stale, so the
    // page cannot sit on indefinitely old content.
    refetchOnMount: true,

    queryFn: async (): Promise<CompanyBrainRow> => {
      const { data: row, error } = await supabase
        .from('company_brain')
        .select('profile, onboarding_completed, onboarding_completed_at')
        .eq('workspace_id', workspaceId!)
        .maybeSingle();
      // Surfaced rather than swallowed: the old code ignored `error` entirely
      // and left the page spinning forever on a failed read.
      if (error) throw error;
      return {
        profile: (row?.profile ?? {}) as BrainProfile,
        onboarding_completed: !!row?.onboarding_completed,
        onboarding_completed_at: row?.onboarding_completed_at ?? null,
      };
    },
  });

  const data = query.data ?? null;

  /**
   * INITIAL loading only: nothing usable to show AND a first read is pending.
   * A background refetch keeps the existing page on screen — that distinction
   * is what removes the flash.
   */
  const loading = !data && (query.isPending || wsLoading);

  /** A read is in flight but there is already something to render. */
  const isRefreshing = !!data && query.isFetching;

  const refresh = useCallback(
    () => qc.invalidateQueries({ queryKey: companyBrainKey(workspaceId) }),
    [qc, workspaceId],
  );

  return {
    workspaceId,
    data,
    loading,
    isRefreshing,
    error: query.error instanceof Error ? query.error : null,
    refresh,
  };
}
