// R1.2.1 · A CONVERSATION BELONGS TO ONE WORKSPACE — INCLUDING ONES THE APP CREATED.
//
// R1.2 stamped `conversations.workspace_id` only on conversations pilot-chat
// created itself. The app's "New chat" inserts the row directly (RLS: user_id =
// auth.uid()) and, before R1.2.1, without a workspace — so every chat started
// from the UI stayed NULL, and the "reused in another workspace → 404" check
// never applied to it (production smoke test, conversation f5fae205, 2026-11-21).
//
// THE RULE. A conversation with no workspace is bound on its FIRST use, to the
// workspace of that request (already membership-checked by the caller), in one
// conditional UPDATE … WHERE workspace_id IS NULL. Two concurrent first uses
// cannot both win: the loser re-reads and is refused unless the winner bound
// the same workspace.
//
// LEGACY HISTORY. A NULL conversation that already has turns may carry text
// from the workspace it was used in. Before binding, the server's own record of
// where it was used (`request_understanding_log.workspace_id`, written by
// pilot-chat after the membership check — never by the client) decides:
//   - every recorded workspace equals this request's → bind;
//   - any recorded workspace differs → refuse (its history belongs elsewhere);
//   - nothing recorded and no messages → bind (an empty "New chat");
//   - nothing recorded but messages exist → bind only when the user belongs to
//     exactly ONE workspace (there is nowhere else the history can be from);
//     otherwise refuse — start a new chat.
// A refused conversation is answered exactly like someone else's: 404.

export const CONVERSATION_BINDING_VERSION = "conversation-binding-v1" as const;

export type BindingRefusal =
  | "not_found"
  | "bound_to_other_workspace"
  | "history_from_other_workspace"
  | "legacy_history_unattributed"
  | "bound_concurrently_elsewhere";

export type BindingDecision =
  | { ok: true; bind: boolean }
  | { ok: false; reason: BindingRefusal };

/** Pure. `evidenceWorkspaces` are the distinct workspaces the server logged for this conversation. */
export function decideConversationBinding(i: {
  conversationWorkspace: string | null;
  requestWorkspace: string;
  evidenceWorkspaces: readonly string[];
  hasMessages: boolean;
  userWorkspaceCount: number;
}): BindingDecision {
  if (i.conversationWorkspace) {
    return i.conversationWorkspace === i.requestWorkspace
      ? { ok: true, bind: false }
      : { ok: false, reason: "bound_to_other_workspace" };
  }
  const evidence = [...new Set(i.evidenceWorkspaces.filter(Boolean))];
  if (evidence.some((w) => w !== i.requestWorkspace)) return { ok: false, reason: "history_from_other_workspace" };
  if (evidence.length > 0) return { ok: true, bind: true };
  if (!i.hasMessages) return { ok: true, bind: true };
  return i.userWorkspaceCount === 1
    ? { ok: true, bind: true }
    : { ok: false, reason: "legacy_history_unattributed" };
}

/** The narrow service-role client surface this module uses. */
export interface BindingDb {
  // deno-lint-ignore no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a PostgREST builder; see `ReadDb`
  from: (table: string) => any;
}

export type BindingResult =
  | { ok: true; bound_now: boolean }
  | { ok: false; reason: BindingRefusal };

/**
 * Check, and on first use atomically claim, the workspace of an existing
 * conversation. The caller has already verified that `userId` is a member of
 * `workspaceId`. Fails closed: any read error refuses.
 */
export async function bindConversationWorkspace(db: BindingDb, a: {
  conversationId: string; userId: string; workspaceId: string;
}): Promise<BindingResult> {
  try {
    const { data: conv, error } = await db.from("conversations")
      .select("id, user_id, workspace_id").eq("id", a.conversationId).maybeSingle();
    if (error || !conv || conv.user_id !== a.userId) return { ok: false, reason: "not_found" };
    if (conv.workspace_id) {
      return conv.workspace_id === a.workspaceId
        ? { ok: true, bound_now: false }
        : { ok: false, reason: "bound_to_other_workspace" };
    }

    const ev = await db.from("request_understanding_log")
      .select("workspace_id").eq("conversation_id", a.conversationId).limit(50);
    if (ev.error) return { ok: false, reason: "legacy_history_unattributed" };
    const evidenceWorkspaces = ((ev.data ?? []) as Array<{ workspace_id: string | null }>)
      .map((r) => r.workspace_id).filter((w): w is string => !!w);

    const msg = await db.from("messages").select("id").eq("conversation_id", a.conversationId).limit(1);
    if (msg.error) return { ok: false, reason: "legacy_history_unattributed" };
    const hasMessages = ((msg.data ?? []) as unknown[]).length > 0;

    let userWorkspaceCount = 0;
    if (hasMessages && evidenceWorkspaces.length === 0) {
      const mem = await db.from("workspace_members").select("workspace_id").eq("user_id", a.userId).limit(2);
      if (mem.error) return { ok: false, reason: "legacy_history_unattributed" };
      userWorkspaceCount = new Set(((mem.data ?? []) as Array<{ workspace_id: string }>).map((m) => m.workspace_id)).size;
    }

    const d = decideConversationBinding({
      conversationWorkspace: null, requestWorkspace: a.workspaceId, evidenceWorkspaces, hasMessages, userWorkspaceCount,
    });
    if (!d.ok) return d;

    // ATOMIC FIRST-USE CLAIM: only a row that is still unbound is written.
    const upd = await db.from("conversations").update({ workspace_id: a.workspaceId })
      .eq("id", a.conversationId).eq("user_id", a.userId).is("workspace_id", null).select("id");
    if (!upd.error && ((upd.data ?? []) as unknown[]).length === 1) return { ok: true, bound_now: true };

    // Lost a race (or the write failed): accept only if the row is now bound to THIS workspace.
    const { data: again } = await db.from("conversations")
      .select("workspace_id, user_id").eq("id", a.conversationId).maybeSingle();
    return again && again.user_id === a.userId && again.workspace_id === a.workspaceId
      ? { ok: true, bound_now: false }
      : { ok: false, reason: "bound_concurrently_elsewhere" };
  } catch {
    return { ok: false, reason: "not_found" };
  }
}
