// ONE MESSAGE, HOWEVER MANY TIMES THE SYSTEM LEARNS ABOUT IT.
//
// ── WHY THIS IS A MODULE AND NOT THREE LINES IN A HOOK ─────────────────────
//
// A chat message can reach the client by three routes: the initial fetch when a
// conversation opens, a realtime event, and a reconciliation read after the
// socket has been away. Any two of those can observe the same row, and they
// race — the reconcile query can return a row realtime is about to deliver, and
// realtime can deliver a row the query already had.
//
// If that produces two bubbles the user sees Pilot answer twice. If it produces
// none, the reply is invisible until a reload — which is the bug this work
// started from, and it would be a poor outcome to fix the transport and then
// reintroduce the symptom in the merge.
//
// So identity is the row id and nothing else, ordering comes from the server's
// `created_at`, and both are pinned by tests rather than argued about.
//
// Pure. No React, no network.

export interface MergeableMessage {
  id: string;
  created_at?: string | null;
  [key: string]: unknown;
}

/**
 * Fold a fetched set into what is already on screen.
 *
 * A LATER OBSERVATION WINS PER FIELD, not per row. A realtime UPDATE may have
 * already patched a row that the reconciliation query read a moment earlier;
 * spreading the incoming row over the existing one keeps whichever fields the
 * server most recently stated without dropping any the caller had.
 */
export function mergeMessages<T extends MergeableMessage>(
  prev: readonly T[], incoming: readonly T[],
): T[] {
  const byId = new Map<string, T>();
  for (const m of prev) byId.set(m.id, m);
  for (const m of incoming) {
    const existing = byId.get(m.id);
    byId.set(m.id, existing ? { ...existing, ...m } : m);
  }
  return sortByCreatedAt([...byId.values()]);
}

/**
 * Server order, stably.
 *
 * `created_at` is an ISO-8601 string from Postgres, so lexicographic comparison
 * IS chronological comparison and no Date parsing is needed. Rows that share a
 * timestamp — two assistant messages written in the same millisecond, which
 * happens when one turn writes a Scout line and a Pilot line together — keep
 * their existing relative order rather than being shuffled by an unstable
 * comparison.
 */
export function sortByCreatedAt<T extends MergeableMessage>(rows: T[]): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const at = String(a.row.created_at ?? '');
      const bt = String(b.row.created_at ?? '');
      if (at !== bt) return at < bt ? -1 : 1;
      return a.index - b.index;
    })
    .map((x) => x.row);
}

export type RealtimeEventType = 'INSERT' | 'UPDATE' | 'DELETE';

/**
 * Apply one realtime event to what is on screen.
 *
 * TOTAL AND IDEMPOTENT. Replaying the same INSERT produces the same list, which
 * is what makes it safe for the fetch and the socket to observe a row in either
 * order — and Supabase can redeliver an event after a reconnect.
 */
export function applyRealtimeEvent<T extends MergeableMessage>(
  prev: readonly T[], event: RealtimeEventType, row: T,
): T[] {
  if (event === 'DELETE') return prev.filter((m) => m.id !== row.id);
  const idx = prev.findIndex((m) => m.id === row.id);
  if (idx >= 0) {
    const next = prev.slice();
    next[idx] = { ...next[idx], ...row };
    return next;
  }
  // A NEW ROW GOES WHERE THE SERVER SAYS, not on the end. An assistant reply
  // that lands while a slower earlier message is still arriving must not jump
  // ahead of it.
  return sortByCreatedAt([...prev, row]);
}

/**
 * Is this optimistic bubble now redundant?
 *
 * The composer renders the user's text immediately, before any row exists. Once
 * the real row arrives the placeholder has to disappear, and it cannot be
 * matched by id because it never had one — so it is matched on being a user
 * message with the same text.
 *
 * Deliberately narrow: only the pending text, only the `user` role. Matching
 * more loosely would hide a genuine repeat of the same message, which people do
 * send.
 */
export function pendingIsResolved<T extends MergeableMessage & { role?: unknown; content?: unknown }>(
  messages: readonly T[], pendingText: string | null | undefined,
): boolean {
  if (!pendingText) return true;
  return messages.some((m) => m.role === 'user' && m.content === pendingText);
}
