import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useChatWorkspace } from '@/contexts/ChatWorkspaceContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { toast } from 'sonner';

/**
 * Conversation management actions for the chat workspace.
 * Backend table: `conversations`. Never touches workflow/plans.
 */
export function useConversationActions() {
  const { setView, closeWorkbench, view } = useChatWorkspace();
  const { workspaceId } = useWorkspace();

  const createConversation = useCallback(async (agentSlug: string = 'pilot') => {
    if (!workspaceId) {
      toast.error('No workspace selected');
      return null;
    }
    try {
      const { data: userResp } = await supabase.auth.getUser();
      const userId = userResp.user?.id;
      if (!userId) { toast.error('Not signed in'); return null; }
      const { data, error } = await supabase
        .from('conversations' as any)
        .insert({
          user_id: userId,
          agent_slug: agentSlug,
          title: 'New chat',
          status: 'active',
        })
        .select('id, agent_slug')
        .single();
      if (error || !data) throw error ?? new Error('Failed to create');
      const row = data as unknown as { id: string; agent_slug: string };
      closeWorkbench();
      setView({ kind: 'chat', conversationId: row.id, agentSlug: row.agent_slug });
      return row.id;
    } catch (e) {
      toast.error('Could not create chat', { description: e instanceof Error ? e.message : String(e) });
      return null;
    }
  }, [workspaceId, setView, closeWorkbench]);

  const renameConversation = useCallback(async (id: string, title: string) => {
    const next = title.trim().slice(0, 120) || 'Untitled';
    const { error } = await supabase
      .from('conversations' as any)
      .update({ title: next })
      .eq('id', id);
    if (error) {
      toast.error('Rename failed', { description: error.message });
      return false;
    }
    return true;
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    const { error } = await supabase
      .from('conversations' as any)
      .delete()
      .eq('id', id);
    if (error) {
      toast.error('Delete failed', { description: error.message });
      return false;
    }
    // If the deleted chat was active, fall back to empty state.
    if (view.kind === 'chat' && view.conversationId === id) {
      closeWorkbench();
      setView({ kind: 'empty' });
    }
    toast.success('Conversation deleted');
    return true;
  }, [view, setView, closeWorkbench]);

  return { createConversation, renameConversation, deleteConversation };
}
