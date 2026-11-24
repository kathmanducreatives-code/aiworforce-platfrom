// MOUNTED BROWSER TEST PAGE (tests/browser/brainCacheSession.browser.test.ts).
// The app's REAL provider stack, in App.tsx's order, around the REAL Company
// Brain page: one QueryClient for the page's lifetime (as App.tsx creates one
// per load), the real AuthProvider and WorkspaceProvider, and the real Supabase
// client pointed by VITE_SUPABASE_URL at a local GoTrue/PostgREST/edge gateway.
// Sign-in and sign-out go through the real Supabase auth API; nothing is mocked.
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import '@/index.css';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { WorkspaceProvider, useWorkspace } from '@/contexts/WorkspaceContext';
import { supabase } from '@/integrations/supabase/client';
import CompanyBrainDashboard from '@/pages/CompanyBrainDashboard';

const queryClient = new QueryClient();
const w = window as unknown as Record<string, unknown>;
w.__qc = queryClient;
w.__signIn = async (email: string, password: string) => {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? error.message : 'ok';
};

export function Harness() {
  const { user, signOut, loading } = useAuth();
  const { workspaceId } = useWorkspace();
  w.__signOut = signOut;
  w.__state = { user: user?.id ?? null, workspaceId, loading };
  if (loading) return <div id="auth-loading">Loading…</div>;
  if (!user) return <div id="signed-out">Signed out</div>;
  return <div id="signed-in" data-user={user.id}><CompanyBrainDashboard /></div>;
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <AuthProvider>
        <WorkspaceProvider>
          <div className="min-h-screen bg-background p-6"><Harness /></div>
          <Toaster />
        </WorkspaceProvider>
      </AuthProvider>
    </BrowserRouter>
  </QueryClientProvider>,
);
