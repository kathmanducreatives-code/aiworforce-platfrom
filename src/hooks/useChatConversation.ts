import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthReady } from './useAuthReady';
import type { ChatMessageRow } from '@/lib/pilotChat';
import type { ConversationLoadState } from '@/lib/chat/state';
import {
  mergeMessages, applyRealtimeEvent, type RealtimeEventType,
} from '@/lib/chat/messageMerge';

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

    /**
     * Fetch the conversation.
     *
     * `reconcile` is the recovery read: it merges rather than replacing, and it
     * never shows a loading state. A socket that dropped and came back must not
     * blank the transcript the user is reading.
     */
    const load = async (reconcile = false) => {
      if (!reconcile) {
        setState((s) => (s === 'ready' ? s : 'loading'));
        setError(null);
      }
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
      if (reconcile) {
        // MERGE BY ID. The fetch is the source of truth for anything missed
        // while disconnected, but realtime may have already delivered rows the
        // query raced past — union them and keep the server's ordering.
        setMessages((prev) => mergeMessages(prev, rows));
        setState((prevState) => (prevState === 'ready' ? prevState
          : rows.length === 0 ? 'empty' : 'ready'));
        return;
      }
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
        const evt = payload.eventType as RealtimeEventType;
        const row = (payload.new ?? payload.old) as ChatMessageRow | undefined;
        if (!row) return;
        setMessages((prev) => applyRealtimeEvent(prev, evt, row));
        setState('ready');
      },
    );
    // ── A SUBSCRIPTION THAT FAILS MUST NOT FAIL SILENTLY ──────────────────
    //
    // `subscribe()` was called with no callback, so a channel that never
    // reached SUBSCRIBED looked exactly like a channel that was working and
    // simply had nothing to deliver. That is how a missing publication went
    // unnoticed: the socket was healthy, the status was never read, and the
    // absence of events is indistinguishable from a quiet conversation.
    //
    // Reconciling on SUBSCRIBED also covers the re-subscribe after a dropped
    // socket, which is the case where messages were genuinely written while
    // nobody was listening.
    channel.subscribe((status) => {
      if (cancelled) return;
      if (status === 'SUBSCRIBED') {
        void load(true);
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        // Realtime is not going to deliver. Say so in the console — the UI
        // still works, because the read below is what actually recovers it.
        console.warn('[chat] realtime unavailable, falling back to refetch', {
          conversationId, status,
        });
        void load(true);
      }
    });

    // ── AND A RECONCILE WHEN THE TAB COMES BACK ───────────────────────────
    //
    // A backgrounded tab can have its socket closed by the browser without a
    // status change the client sees. Anything written while it was away is
    // recovered by one read on return; realtime stays the fast path, the
    // database stays the truth.
    const onWake = () => {
      if (cancelled) return;
      if (document.visibilityState === 'visible') void load(true);
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('online', onWake);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('online', onWake);
      supabase.removeChannel(channel);
    };
  }, [conversationId, isReady, userId, reloadTick]);

  return { messages, state, error, retry, loading: state === 'loading', setMessages };
}
