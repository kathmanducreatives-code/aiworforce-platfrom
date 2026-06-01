import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { getCurrentWorkspaceId } from '@/lib/orchestration';
import { supabase } from '@/integrations/supabase/client';

interface WorkspaceContextValue {
  workspaceId: string | null;
  loading: boolean;
  error: Error | null;
  retry: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspaceId: null,
  loading: true,
  error: null,
  retry: () => {},
});

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
  const { user, loading: authLoading } = useAuth();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
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
    <WorkspaceContext.Provider value={{ workspaceId, loading, error, retry }}>
      {children}
    </WorkspaceContext.Provider>
  );
};

export const useWorkspace = () => useContext(WorkspaceContext);
