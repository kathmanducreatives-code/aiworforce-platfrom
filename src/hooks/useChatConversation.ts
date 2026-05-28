import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { ChatMessageRow } from '@/lib/pilotChat';

export function useChatConversation(conversationId: string | null) {
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!conversationId || typeof conversationId !== 'string') {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setLoading(true);

    (async () => {
      const { data } = await supabase
        .from('messages' as any)
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });
      if (!cancelled) {
        setMessages((data ?? []) as unknown as ChatMessageRow[]);
        setLoading(false);
      }
    })();

    // Unique topic per hook instance to avoid "subscribe can only be called
    // a single time per channel instance" collisions under StrictMode / multi-mount.
    const topic = `messages:${conversationId}:${
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2)
    }`;
    const channel = supabase.channel(topic);
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
      (payload) => {
        const row = payload.new as ChatMessageRow;
        setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
      },
    );
    channel.subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [conversationId]);


  return { messages, loading, setMessages };
}
