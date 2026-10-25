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
import { AGENCY_SCOPE, type BrainScope } from '@/lib/brainScope';
import { loadClientBrain, type ClientBrainDenial } from '@/lib/clientBrainApi';
import { invokeBrain } from '@/lib/brainInvoke';

export interface CompanyBrainRow {
  profile: BrainProfile;
  onboarding_completed: boolean;
  onboarding_completed_at: string | null;
  /** Row version (set by a database trigger on every update). Edits are built on it. */
  updated_at: string | null;
  /** A CLIENT Brain's integer version (Phase 3c); null for the agency Brain and before a client's first save. */
  version?: number | null;
}

/** A client Brain the server would not show (revoked, archived, signed out…). Never retried, never replaced by another Brain. */
export class ClientBrainDeniedError extends Error {
  constructor(public readonly reason: ClientBrainDenial) { super(`client_brain_denied:${reason}`); }
}

/**
 * Stable, workspace-scoped key. One workspace's cache can never serve another,
 * and one client's never another client's or the agency's. The agency key is
 * unchanged, so existing invalidations keep working.
 */
export const companyBrainKey = (workspaceId: string | null | undefined, scope: BrainScope = AGENCY_SCOPE) =>
  scope.kind === 'agency'
    ? (['company_brain', workspaceId ?? null] as const)
    : (['company_brain', workspaceId ?? null, 'client', scope.clientId] as const);

export function useCompanyBrain(scope: BrainScope = AGENCY_SCOPE) {
  const { workspaceId, loading: wsLoading } = useWorkspace();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: companyBrainKey(workspaceId, scope),
    enabled: !wsLoading && !!workspaceId,
    // A refusal is an answer, not a network blip.
    retry: (count, err) => !(err instanceof ClientBrainDeniedError) && count < 3,

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
      if (scope.kind === 'client') {
        const r = await loadClientBrain(invokeBrain, workspaceId!, scope.clientId);
        if (r.kind === 'denied') throw new ClientBrainDeniedError(r.reason);
        return { profile: r.row.profile, onboarding_completed: r.row.onboarding_completed, onboarding_completed_at: null, updated_at: null, version: r.row.version };
      }
      const { data: row, error } = await supabase
        .from('company_brain')
        .select('profile, onboarding_completed, onboarding_completed_at, updated_at')
        .eq('workspace_id', workspaceId!)
        .maybeSingle();
      // Surfaced rather than swallowed: the old code ignored `error` entirely
      // and left the page spinning forever on a failed read.
      if (error) throw error;
      return {
        profile: (row?.profile ?? {}) as BrainProfile,
        onboarding_completed: !!row?.onboarding_completed,
        onboarding_completed_at: row?.onboarding_completed_at ?? null,
        updated_at: row?.updated_at ?? null,
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

  const scopeId = scope.kind === 'client' ? scope.clientId : null;
  const refresh = useCallback(
    () => qc.invalidateQueries({ queryKey: companyBrainKey(workspaceId, scopeId ? { kind: 'client', clientId: scopeId } : AGENCY_SCOPE), exact: true }),
    [qc, workspaceId, scopeId],
  );

  return {
    workspaceId,
    data,
    loading,
    isRefreshing,
    error: query.error instanceof Error ? query.error : null,
    denied: query.error instanceof ClientBrainDeniedError ? query.error.reason : null,
    refresh,
  };
}
