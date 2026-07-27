import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { Bug, X } from 'lucide-react';

/** Dev-only floating chip with quick state visibility. */
export default function PreviewDiagnostics() {
  const [open, setOpen] = useState(false);
  const { user, loading: authLoading } = useAuth();
  const { workspaceId, loading: wsLoading, error: wsError } = useWorkspace();
  const location = useLocation();

  if (!import.meta.env.DEV) return null;

  const Row = ({ k, v }: { k: string; v: string }) => (
    <div className="flex justify-between gap-3 text-[11px]">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-mono text-foreground/90 truncate max-w-[180px]">{v}</span>
    </div>
  );

  return (
    <div className="fixed bottom-3 right-3 z-[9999] pointer-events-auto">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-md bg-black/70 text-emerald-300 border border-emerald-500/30 backdrop-blur hover:bg-black/90"
          title="Preview diagnostics (dev only)"
        >
          <Bug className="h-3 w-3" /> dev
        </button>
      ) : (
        <div className="w-[260px] rounded-lg border border-white/10 bg-black/85 backdrop-blur p-3 shadow-xl">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-widest text-emerald-300/80 font-semibold">Diagnostics</div>
            <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="space-y-1">
            <Row k="route" v={location.pathname} />
            <Row k="auth" v={authLoading ? 'loading…' : user ? 'signed-in' : 'anon'} />
            <Row k="user" v={user?.id ? `${user.id.slice(0, 8)}…` : '—'} />
            <Row k="workspace" v={wsLoading ? 'loading…' : workspaceId ? `${workspaceId.slice(0, 8)}…` : '—'} />
            <Row k="supabase" v={(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/^https?:\/\//, '').split('.')[0]?.slice(-6) || '—'} />
            <Row k="mode" v={import.meta.env.MODE ?? '—'} />
            {wsError && <Row k="ws.error" v={wsError.message.slice(0, 40)} />}
          </div>
        </div>
      )}
    </div>
  );
}
