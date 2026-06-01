import type { ReactNode } from 'react';
import { Loader2, AlertTriangle, RefreshCw, LogOut, Compass } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';

/**
 * Ensures any protected screen always shows a visible state — never a blank
 * panel — while the workspace is resolving or if it fails to load.
 */
export default function WorkspaceGate({ children }: { children: ReactNode }) {
  const { workspaceId, loading, error, retry } = useWorkspace();
  const { signOut } = useAuth();
  const navigate = useNavigate();

  if (loading && !workspaceId) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading workspace…
        </div>
      </div>
    );
  }

  if (!workspaceId) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-border bg-card/90 backdrop-blur-xl p-6 text-center shadow-2xl">
          <AlertTriangle className="h-6 w-6 text-warning mx-auto mb-3" />
          <div className="text-base font-medium mb-1 text-foreground">Workspace couldn't load</div>
          <div className="text-xs text-muted-foreground mb-5 break-words">
            {error?.message ?? 'No workspace is linked to this account yet.'}
          </div>
          <div className="flex gap-2 justify-center flex-wrap">
            <button
              onClick={retry}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <RefreshCw className="h-3 w-3" /> Retry
            </button>
            <button
              onClick={() => navigate('/onboarding/company-brain')}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            >
              <Compass className="h-3 w-3" /> Go to setup
            </button>
            <button
              onClick={async () => { await signOut(); navigate('/auth'); }}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            >
              <LogOut className="h-3 w-3" /> Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
