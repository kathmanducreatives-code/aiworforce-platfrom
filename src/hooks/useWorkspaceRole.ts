// The signed-in user's role in the current workspace (roadmap Phase 3a). Read
// from their own membership row (members may read their own membership). While
// it loads, or if it can't be read, the role is `viewer`: the page fails closed
// to read-only, and the server enforces the real rule either way.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { canBrain, normalizeWorkspaceRole, type WorkspaceRole } from '@/lib/brainRole';

export function useWorkspaceRole(): { role: WorkspaceRole; canEditBrain: boolean; loading: boolean } {
  const { user } = useAuth();
  const { workspaceId } = useWorkspace();
  const q = useQuery({
    queryKey: ['workspace-role', workspaceId, user?.id],
    enabled: !!workspaceId && !!user?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workspace_members')
        .select('role')
        .eq('workspace_id', workspaceId!)
        .eq('user_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return normalizeWorkspaceRole((data as { role?: unknown } | null)?.role);
    },
  });
  const role = q.data ?? 'viewer';
  return { role, canEditBrain: canBrain(role, 'edit'), loading: q.isLoading };
}
