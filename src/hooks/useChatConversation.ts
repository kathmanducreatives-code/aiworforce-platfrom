import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthReady } from './useAuthReady';
import type { ChatMessageRow } from '@/lib/pilotChat';
import type { ConversationLoadState } from '@/lib/chat/state';

/**
 * Loads messages for a conversation with an auth-ready gate, in-place
 * realtime patching (no full re-fetch storm), and explicit load state.
 *
 * Optimistic user messages (rendered via the pendingUserText prop on
 * ChatView) are reconciled by id when the real row arrives from realtime.
 */
export function useChatConversation(conversationId: string | null) {
  const { isReady, userId } = useAuthReady();
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [state, setState] = useState<ConversationLoadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const inflightRef = useRef(0);

  const retry = useCallback(() => setReloadTick((t) => t + 1), []);

  useEffect(() => {
    if (!conversationId || typeof conversationId !== 'string') {
      setMessages([]); setState('idle'); setError(null);
      return;
    }
    if (!isReady) return;

    let cancelled = false;
    const myTick = ++inflightRef.current;

    const load = async () => {
      setState((s) => (s === 'ready' ? s : 'loading'));
      setError(null);
      const { data, error: err } = await supabase
        .from('messages' as any)
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });
      if (cancelled || myTick !== inflightRef.current) return;
      if (err) {
        setError(err.message);
        setState('error');
        return;
      }
      const rows = (data ?? []) as unknown as ChatMessageRow[];
      setMessages(rows);
      setState(rows.length === 0 ? 'empty' : 'ready');
    };
    load();

    const topic = `messages:${conversationId}:${
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2)
    }`;
    const channel = supabase.channel(topic);
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
      (payload) => {
        const evt = payload.eventType;
        const row = (payload.new ?? payload.old) as ChatMessageRow | undefined;
        if (!row) return;
        setMessages((prev) => {
          if (evt === 'DELETE') return prev.filter((m) => m.id !== row.id);
          if (prev.some((m) => m.id === row.id)) {
            return prev.map((m) => (m.id === row.id ? { ...m, ...row } : m));
          }
          return [...prev, row];
        });
        setState('ready');
      },
    );
    channel.subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [conversationId, isReady, userId, reloadTick]);

  return { messages, state, error, retry, loading: state === 'loading', setMessages };
}
