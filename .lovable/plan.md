# Fix Intermittent Black-Screen Crashes

## Root causes

1. **No top-level ErrorBoundary** around the authenticated app shell. Any render-time exception (e.g. inside `MainLayout`, `CommandDock`, `WorkspaceContext` consumers) unmounts the whole `BrowserRouter` subtree and the page goes black against the global `AuthenticatedBackground`.
2. **Realtime channel topic collisions** in `useChatConversation` and `useUserConversations`:
   - Topics are deterministic (`messages:${conversationId}`, `user-conversations`). In React StrictMode (or when two consumers mount the same hook), two `supabase.channel()` calls for the same topic race. Supabase logs `subscribe can only be called a single time per channel instance` and the second instance throws on `.subscribe()`, surfacing as an unhandled error.
   - On rapid conversation switching, the cleanup `removeChannel` for the old id can run after the new effect already created the new channel, but a stale channel for the same id can still linger if the topic is reused.
3. `useChatConversation` order is correct (`.on` then `.subscribe`) but the channel topic is not unique per hook instance, so it still collides.

## Fixes (frontend-only, no architectural changes)

### 1. Top-level ErrorBoundary
- Create `src/components/AppErrorBoundary.tsx` — class component that catches render errors, logs to console, and renders a visible fallback card (semantic tokens, dark glass surface, "Reload" button calling `window.location.reload()`). Reuse the same visual language as `ChatErrorBoundary`.
- Wrap the `<Routes>` subtree in `src/App.tsx` with `<AppErrorBoundary>` (inside `BrowserRouter`, outside `Routes`) so navigation still works and the fallback is themed.

### 2. Harden `src/hooks/useChatConversation.ts`
- Make channel topic unique per hook instance: `` `messages:${conversationId}:${crypto.randomUUID()}` ``.
- Keep the `.on(...).subscribe()` order; keep `removeChannel(channel)` in cleanup.
- Guard against `conversationId` being a non-string/empty before subscribing.

### 3. Harden `src/hooks/useUserConversations.ts`
- Same unique-topic treatment: `` `user-conversations:${crypto.randomUUID()}` ``.
- Keep `.on` before `.subscribe`, cleanup with `removeChannel`.

### 4. Harden `src/components/dock/CommandDock.tsx`
- It currently calls `useWorkspace()` and reads `workspaceId`. Add null-safety around `view` discriminants (already OK) and ensure `submit()` swallows non-Error throws (already OK). No structural change; only verify it still mounts when `workspaceId` is `null` (it does — it just toasts on submit). No realtime here, no changes needed beyond verifying.

### 5. Verify `src/components/MainLayout.tsx`
- Already wraps active chat surfaces in `ChatErrorBoundary`. No change needed beyond confirming the outer `AppErrorBoundary` catches anything outside that boundary (sidebar, dock, providers).

### 6. Verify `src/contexts/ChatWorkspaceContext.tsx`
- Pure state context; no realtime. No change.

## Non-goals (explicitly preserved)

- Keep `pilot-chat` edge function and call sites.
- Keep `WorkspaceContext` guards; do not hardcode workspace IDs.
- Do not revert to `chat-respond`.
- No UI redesign.

## Verification

After implementing:
1. `/` Landing renders.
2. `/auth` renders.
3. `/dashboard` renders with sidebar + dock.
4. Open ChatWorkspace via Cmd+K — no crash.
5. Switch between two conversations rapidly — only one active channel per conversation in `supabase.getChannels()`; no `subscribe can only be called a single time` warnings.
6. Force a render error in dev (temporary throw) — `AppErrorBoundary` shows the fallback instead of black screen. Remove the test throw.
7. Console: no fatal runtime errors.
