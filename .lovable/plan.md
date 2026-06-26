# Plan — Conversations reliability + alive execution states

Goal: make the chat feel ChatGPT-reliable and ChatGPT-alive while keeping the AI-workforce identity. Scope is presentation + frontend state. No schema migrations, no production data writes, no landing-page changes, no auto-send / DM / email / post. Migration 145631 untouched.

## 1. Chat history reliability (`useUserConversations`, `useConversationActions`, sidebar)

Rewrite `src/hooks/useUserConversations.ts`:
- Wait for `supabase.auth.getSession()` before the first fetch (avoids the "sometimes empty history" caused by the race documented in our auth-ready note).
- Filter `conversations` by the current `user_id` explicitly so RLS edge cases don't return an empty set silently.
- Track `state: 'idle' | 'loading' | 'ready' | 'empty' | 'error'` and expose `retry()`.
- Realtime channel filtered by `user_id=eq.<uid>`; on INSERT/UPDATE/DELETE patch the local array in place (no full re-fetch storm).
- Sort by `updated_at desc`; dedupe by id.
- Persist `lastConversationId` in `localStorage`; restore on workspace open when the row still exists, otherwise fall back to most-recent.

Rewrite `src/hooks/useChatConversation.ts`:
- Same auth-ready gate.
- Append/patch messages by id; keep optimistic temp messages with `temp_id`; reconcile when the real row arrives (replace by `temp_id`).
- Expose `state` + `retry()` so the message list can show a real error/retry surface instead of an empty container.

`useConversationActions.createConversation`:
- Guard against double-click: keep an in-flight ref so a second click reuses the in-flight promise (kills duplicate blank chats).
- After insert, optimistically prepend to the cache used by `useUserConversations` (instant appearance, no waiting for realtime).
- Auto-title from the first user message (first 60 chars) the first time we persist a message in a "New chat".

Sidebar (`ConversationsSidebar.tsx`):
- Skeleton rows while `state === 'loading'`.
- Empty state copy: "No conversations yet. Ask your AI workforce to run a workflow."
- Retry button on `error`.
- Show last-message preview (1 line) and a small status chip (`Running / Needs approval / Failed / Complete`) derived from the latest plan linked to the conversation.

## 2. Conversation state model

Add `src/lib/chat/state.ts` exporting the union types from the brief (`ConversationLoadState`, `MessageSendState`, `WorkflowRunUiState`) and small helpers (`deriveWorkflowUiState(plan, tasks, approvals, lastActivityAt)`).

Every consumer (`ConversationView`, `ChatView`, `ExecutionPlanCard`, sidebar row) renders from these types so no state is silent.

## 3. Execution card — no more frozen "Executing"

`ExecutionPlanCard.tsx` + `ExecutionTaskRow.tsx`:
- Replace the static "executing" pill with a state derived from `deriveWorkflowUiState`: `preparing | waiting_confirmation | running | streaming_progress | partial | complete | failed`.
- Animated border (shimmer) while running, pulse dot on the active step, agent avatar stack, elapsed timer, "last activity Xs ago".
- "View output" only when the step truly has output; otherwise show the honest reason (zero results / connector missing / skipped — already wired in metadata).
- New `LiveProgressLine.tsx` under the active step: rotates workflow-aware copy from `src/lib/chat/progressCopy.ts` (the lead-sourcing / decision-maker / enrichment / outreach / content / fallback strings from the brief). Rotation is tied to the current step type, not faked.

## 4. Execution heartbeat (`useExecutionHeartbeat`)

New hook wrapping `usePlanDetail`:
- While `state` is preparing/running, run a 4s poll in addition to the realtime channel (covers dropped sockets — already the documented cause of "stuck Executing").
- Track `lastChangeAt`; if no change for 25s show "Still working — waiting for the latest backend update", at 90s show "This is taking longer than expected. Keep waiting or retry." Never auto-mark failed.
- Stop polling on `complete | failed | cancelled`.

## 5. Alive agent messages (`ConversationView` / `buildPlanMessages`)

Expand `src/lib/chatMessageStream.ts`:
- Map activity/task events to the correct owning agent (Pilot coordinator, Scout sourcing, Aria ranking, Hawk research, Penn drafts, Scribe content) using the existing `slugForTask` rules; fall back to step-type inference instead of generic "Agent · Operations".
- Emit short, human messages on milestones: search-strategy ready, raw reviewed/accepted, ranking done, drafts queued, Workbench opened. No raw provider names as primary content.
- AgentTypingIndicator shows current speaker while their step is running.

## 6. Workbench open trigger

Only auto-open Workbench when at least one task has real output. Otherwise show the inline honest reason in the chat (no blank "No output" cards).

## 7. Loading / transition polish

- Message-list skeleton on first load.
- Smooth scroll-to-latest on append; freeze auto-scroll when user is scrolled up + "new activity ↓" pill (extend existing `unread` logic in `ConversationView`).
- Disabled send button while `MessageSendState === 'sending'`; retry chip on `failed`.
- Reconnect banner if a realtime channel errors (`channel.subscribe` status).

## 8. Errors

Centralize via `toast.error` + inline banners using the exact copy from the brief ("Couldn't load chat history. Retry.", "This workflow could not start because Apify is not configured.", etc.). No silent failures.

## 9. Light state cleanup (UI-only, no DB writes)

- Frontend filter: hide plans whose `status='executing'` with no activity for >24h from the "running" badge; render them as `stale` in the sidebar with a "Mark as done" UI action that updates only that conversation row.
- No automatic deletes. No data migration.

## 10. Tests

`src/lib/chat/__tests__/`:
- `state.test.ts` — `deriveWorkflowUiState` truth table (no tasks, all complete, mixed failed, awaiting approval, stale).
- `progressCopy.test.ts` — every workflow type returns a non-empty rotation.
- `useUserConversations.test.tsx` — dedupes, sorts by updated_at, retries on error.
- `useChatConversation.test.tsx` — optimistic temp message reconciles by temp_id, no duplicates after realtime echo.

## 11. Validation

- `npx tsc --noEmit`
- `npm run build`
- `deno test supabase/functions/_shared --allow-all` (no edge-function changes, but run to confirm clean)
- Manual browser QA: history reliability flow (A), running-state flow (B), slow-backend flow (C — simulated by pausing the heartbeat), zero-results flow (D).
- Safety scan: no secrets, no migrations, migration 145631 untouched, no landing change, no auto-send/DM/post/email.

## Files touched

Modify:
- `src/hooks/useUserConversations.ts`
- `src/hooks/useChatConversation.ts`
- `src/hooks/useConversationActions.ts`
- `src/hooks/usePlanDetail.ts`
- `src/components/chat/workspace/ConversationsSidebar.tsx`
- `src/components/chat/workspace/ConversationView.tsx`
- `src/components/chat/workspace/ChatView.tsx`
- `src/components/chat/workspace/ChatWorkspace.tsx` (restore-last-conversation on open)
- `src/components/chat/workspace/plan/ExecutionPlanCard.tsx`
- `src/components/chat/workspace/plan/ExecutionTaskRow.tsx`
- `src/components/chat/workspace/plan/ActivityMiniFeed.tsx`
- `src/lib/chatMessageStream.ts`

Create:
- `src/lib/chat/state.ts`
- `src/lib/chat/progressCopy.ts`
- `src/hooks/useExecutionHeartbeat.ts`
- `src/components/chat/workspace/plan/LiveProgressLine.tsx`
- tests in `src/lib/chat/__tests__/` and `src/hooks/__tests__/`

Out of scope: schema migrations, landing page, edge functions, outreach automation, production data mutations.

## Open question

The brief mentions "delete/archive chat action if existing backend supports it." The current `conversations` table has no `archived_at` column. Should I (a) keep delete-only (current behavior) or (b) add a lightweight client-side "Done" toggle using the existing `status` column? I'll default to (b) unless you say otherwise — it requires no schema change.
