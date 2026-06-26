import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthReady } from './useAuthReady';
import type { ConversationLoadState } from '@/lib/chat/state';

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

const LAST_CONV_KEY = 'agentory.last_conversation_id';

export function getLastConversationId(): string | null {
  try { return localStorage.getItem(LAST_CONV_KEY); } catch { return null; }
}
export function setLastConversationId(id: string | null) {
  try {
    if (id) localStorage.setItem(LAST_CONV_KEY, id);
    else localStorage.removeItem(LAST_CONV_KEY);
  } catch { /* ignore */ }
}

export function useUserConversations() {
  const { isReady, userId } = useAuthReady();
  const [conversations, setConversations] = useState<ChatConversationRow[]>([]);
  const [state, setState] = useState<ConversationLoadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const inflightRef = useRef(0);

  const retry = useCallback(() => setReloadTick((t) => t + 1), []);

  useEffect(() => {
    if (!isReady) return;
    if (!userId) {
      setConversations([]);
      setState('empty');
      return;
    }

    let cancelled = false;
    const myTick = ++inflightRef.current;

    const load = async () => {
      setState((s) => (s === 'ready' ? s : 'loading'));
      setError(null);
      const { data, error: err } = await supabase
        .from('conversations' as any)
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(50);
      if (cancelled || myTick !== inflightRef.current) return;
      if (err) {
        setError(err.message);
        setState('error');
        return;
      }
      const rows = (data ?? []) as unknown as ChatConversationRow[];
      // Dedupe by id, sort by updated_at desc.
      const seen = new Set<string>();
      const unique = rows.filter((r) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      }).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
      setConversations(unique);
      setState(unique.length === 0 ? 'empty' : 'ready');
    };
    load();

    // Realtime: scope to this user_id to avoid cross-user noise.
    const topic = `user-conversations:${userId}:${Math.random().toString(36).slice(2)}`;
    const ch = supabase.channel(topic);
    ch.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'conversations', filter: `user_id=eq.${userId}` },
      (payload) => {
        const evt = payload.eventType;
        const row = (payload.new ?? payload.old) as ChatConversationRow | undefined;
        if (!row) return;
        setConversations((prev) => {
          if (evt === 'DELETE') {
            return prev.filter((c) => c.id !== row.id);
          }
          const next = prev.filter((c) => c.id !== row.id);
          next.unshift(row);
          next.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
          return next;
        });
        setState((s) => (s === 'error' ? 'ready' : s));
      },
    );
    ch.subscribe();

    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [isReady, userId, reloadTick]);

  // Local cache update — used by createConversation for instant appearance.
  const upsertLocal = useCallback((row: ChatConversationRow) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== row.id);
      next.unshift(row);
      return next;
    });
    setState('ready');
  }, []);

  return { conversations, state, error, retry, loading: state === 'loading', upsertLocal };
}
