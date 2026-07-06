## Problem

Two issues in the conversations sidebar (`src/components/chat/workspace/ConversationsSidebar.tsx`):

1. **Delete looks successful but the row stays.** `useConversationActions.deleteConversation` runs `supabase.from('conversations').delete().eq('id', id)` without `.select()`. Supabase + RLS returns no error even when 0 rows are actually deleted (e.g. stale session, auth lock contention — we can see `Lock ... was released because another request stole it` in the runtime logs). We then show a green "Conversation deleted" toast even though nothing changed in the DB, so on next refresh the chat reappears.
2. **No way to delete multiple chats at once.** Users have to open the per-row menu one by one.

Database side is fine: DELETE policy is `auth.uid() = user_id`, and `messages.conversation_id` cascades on delete. No schema changes needed.

## Fix

### 1. Make delete actually verify the row was removed

In `src/hooks/useConversationActions.ts`:
- Change `deleteConversation` to `.delete().eq('id', id).select('id')` and treat an empty result as a failure (show an error toast — usually "Not signed in / permission denied. Try signing in again."), not a success.
- Add a new `deleteConversations(ids: string[])` that uses `.delete().in('id', ids).select('id')`, returns the count actually removed, and closes the workbench if the currently open chat was among them.
- Also remove the deleted IDs from `lastConversationId` if they match.

### 2. Multi-select mode in the sidebar

In `src/components/chat/workspace/ConversationsSidebar.tsx`:
- Add local state `selectionMode: boolean` and `selectedIds: Set<string>`.
- Add a small "Select" toggle button in the sidebar header (next to the New chat / search area). While active:
  - Each `ConversationItem` shows a checkbox on the left instead of the agent avatar hover behavior; clicking the row toggles selection instead of opening the chat.
  - A compact action bar appears at the top of the list showing `N selected`, a "Select all (filtered)" link, a "Clear" link, and a red "Delete" button.
  - Delete opens a single confirm dialog ("Delete N conversations? Messages will be removed. This cannot be undone.") and calls the new `deleteConversations` bulk action.
- Exiting selection mode (button, Escape key, or after a successful bulk delete) clears `selectedIds`.
- Per-row Rename / Delete menu stays as-is for single-chat actions.

### 3. Small correctness cleanup

- After bulk delete, rely on the existing realtime `postgres_changes` subscription in `useUserConversations` to prune the list; also optimistically remove the ids so the UI updates instantly even if realtime is slow.

## Files changed

- `src/hooks/useConversationActions.ts` — harden `deleteConversation`, add `deleteConversations`.
- `src/components/chat/workspace/ConversationsSidebar.tsx` — selection mode, checkboxes, bulk action bar, confirm dialog.
- `src/components/chat/workspace/DeleteConversationDialog.tsx` — small extension (or a sibling `BulkDeleteConversationsDialog.tsx`) for the "delete N" copy.

## Out of scope

- No schema/RLS changes (current policies are correct).
- No changes to messages storage, agents, or channels.
- Auth-lock warnings in the console are a separate Supabase client issue and not addressed here.
