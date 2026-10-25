import { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { brainStorageKeysToPurge, principalOfSession, type BrainPrincipal } from '@/lib/brainScope';
import { getCurrentWorkspaceId } from '@/lib/orchestration';
import { supabase } from '@/integrations/supabase/client';

interface WorkspaceContextValue {
  workspaceId: string | null;
  loading: boolean;
  error: Error | null;
  retry: () => void;
  /** Who the workspace was resolved for: the signed-in user and session. Brain caches are keyed by it. */
  principal: BrainPrincipal | null;
}

const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspaceId: null,
  loading: true,
  error: null,
  retry: () => {},
  principal: null,
});

/** Remove the Brain state a sign-out must not leave behind (brainStorageKeysToPurge). */
function purgeBrainSessionStorage() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); if (k) keys.push(k); }
    for (const k of brainStorageKeysToPurge(keys)) sessionStorage.removeItem(k);
  } catch { /* storage unavailable: nothing was stored */ }
}

const isAuthLockError = (e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return /lock.*(stole|released|timeout)/i.test(msg) || (e as any)?.isAcquireTimeout === true;
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function resolveWithRetry(): Promise<string | null> {
  try {
    return await getCurrentWorkspaceId();
  } catch (e) {
    if (!isAuthLockError(e)) throw e;
    await wait(300);
    try {
      return await getCurrentWorkspaceId();
    } catch (e2) {
      if (!isAuthLockError(e2)) throw e2;
      await wait(800);
      return await getCurrentWorkspaceId();
    }
  }
}

export const WorkspaceProvider = ({ children }: { children: ReactNode }) => {
  const { user, session, loading: authLoading } = useAuth();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  // The principal is stable across token refreshes (same user, same session id).
  const resolvedPrincipal = principalOfSession(session);
  const principalId = resolvedPrincipal ? `${resolvedPrincipal.userId}:${resolvedPrincipal.sessionId}` : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const principal = useMemo(() => resolvedPrincipal, [principalId]);

  // CACHE-SESSION boundary (Codex #185). When the signed-in session ends or
  // changes — sign-out, another user, a new session — nothing cached or in
  // flight for it may serve what comes next: cancel every query (a late
  // response is discarded), clear the cache, forget this workspace, and remove
  // the session-stored client state. Brain keys also carry the principal, so
  // even a response that slipped through lands under a key no one else reads.
  const queryClient = useQueryClient();
  const lastPrincipal = useRef<string | null>(null);
  useEffect(() => {
    const previous = lastPrincipal.current;
    lastPrincipal.current = principalId;
    if (previous === null || previous === principalId) return;
    void queryClient.cancelQueries();
    queryClient.clear();
    setWorkspaceId(null);
    purgeBrainSessionStorage();
  }, [principalId, queryClient]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);
  const inFlight = useRef(false);

  const retry = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (authLoading) {
      setLoading(true);
      return;
    }
    if (!user) {
      setWorkspaceId(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    resolveWithRetry()
      .then((id) => {
        if (cancelled) return;
        setWorkspaceId(id);
        if (!id) setError(new Error('No workspace available for this account.'));
      })
      .catch((e) => {
        if (cancelled) return;
        console.error('workspace resolve failed', e);
        setWorkspaceId(null);
        setError(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        inFlight.current = false;
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, tick]);

  // Re-resolve when auth state settles (covers initial token-refresh races).
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        if (!inFlight.current && !workspaceId) setTick((t) => t + 1);
      }
      if (event === 'SIGNED_OUT') {
        setWorkspaceId(null);
        setError(null);
      }
    });
    return () => subscription.unsubscribe();
  }, [workspaceId]);

  return (
    <WorkspaceContext.Provider value={{ workspaceId, loading, error, retry, principal }}>
      {children}
    </WorkspaceContext.Provider>
  );
};

export const useWorkspace = () => useContext(WorkspaceContext);
