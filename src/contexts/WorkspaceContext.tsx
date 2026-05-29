import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { getCurrentWorkspaceId } from '@/lib/orchestration';

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

export const WorkspaceProvider = ({ children }: { children: ReactNode }) => {
  const { user, loading: authLoading } = useAuth();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);

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
    setLoading(true);
    setError(null);
    getCurrentWorkspaceId()
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
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, tick]);

  return (
    <WorkspaceContext.Provider value={{ workspaceId, loading, error, retry }}>
      {children}
    </WorkspaceContext.Provider>
  );
};

export const useWorkspace = () => useContext(WorkspaceContext);
