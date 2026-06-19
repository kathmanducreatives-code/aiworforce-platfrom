import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface ChatConversationRow {
  id: string;
  user_id: string;
  agent_slug: string;
  channel: string | null;
  title: string | null;
  status: 'active' | 'done';
  created_at: string;
  updated_at: string;
}

export function useUserConversations() {
  const [conversations, setConversations] = useState<ChatConversationRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from('conversations' as any)
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(50);
      if (!cancelled) {
        setConversations((data ?? []) as unknown as ChatConversationRow[]);
        setLoading(false);
      }
    };
    load();

    const topic = `user-conversations:${
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2)
    }`;
    const ch = supabase.channel(topic);
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => load());
    ch.subscribe();

    return () => { cancelled = true; supabase.removeChannel(ch); };

  }, []);

  return { conversations, loading };
}
