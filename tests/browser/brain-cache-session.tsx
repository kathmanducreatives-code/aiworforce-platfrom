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
import { useQuery } from '@tanstack/react-query';
import MemoryOfferCard from '@/components/chat/workspace/bubbles/MemoryOfferCard';
import MemoryReviewStrip from '@/components/dashboard/MemoryReviewStrip';

// Company Brain V2 (B2.3) views of the same signed-in session:
//   ?view=chat&conversation=<id>  the conversation's real messages, with ORION's
//                                 offer rendered by the real MemoryOfferCard;
//   ?view=dashboard               the dashboard's pending-memory strip.
function ConversationView({ conversationId }: { conversationId: string }) {
  const q = useQuery({
    queryKey: ['harness-conversation', conversationId],
    queryFn: async () => {
      const { data, error } = await supabase.from('messages').select('id, role, content, metadata, created_at')
        .eq('conversation_id', conversationId).order('created_at', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
  if (!q.data) return <div id="conversation-loading">Loading…</div>;
  return (
    <ol id="conversation" className="space-y-3 bg-[#0b0f0e] p-4">
      {q.data.map((m) => (
        <li key={m.id} data-role={m.role} className={m.role === 'user' ? 'text-right text-sm text-white' : 'text-sm text-[#ECE9E4]'}>
          <div className="inline-block max-w-[720px] rounded-xl border border-white/10 px-3 py-2">{m.content}</div>
          {m.role === 'assistant' && (m.metadata as Record<string, unknown> | null)?.memory_offer ? <MemoryOfferCard metadata={m.metadata} /> : null}
        </li>
      ))}
    </ol>
  );
}

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
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  if (view === 'chat') return <div id="signed-in" data-user={user.id}><ConversationView conversationId={params.get('conversation') ?? ''} /></div>;
  if (view === 'dashboard') return <div id="signed-in" data-user={user.id}><MemoryReviewStrip workspaceId={workspaceId} /><div id="dashboard-ready" /></div>;
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
