import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { getCurrentWorkspaceId } from '@/lib/orchestration';

interface WorkspaceContextValue {
  workspaceId: string | null;
  loading: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue>({ workspaceId: null, loading: true });

export const WorkspaceProvider = ({ children }: { children: ReactNode }) => {
  const { user, loading: authLoading } = useAuth();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setWorkspaceId(null); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    getCurrentWorkspaceId()
      .then((id) => { if (!cancelled) setWorkspaceId(id); })
      .catch((e) => console.error('workspace resolve failed', e))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user, authLoading]);

  return (
    <WorkspaceContext.Provider value={{ workspaceId, loading }}>
      {children}
    </WorkspaceContext.Provider>
  );
};

export const useWorkspace = () => useContext(WorkspaceContext);
