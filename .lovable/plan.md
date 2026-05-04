
# Real AI Chat Backend for Chat Workspace

Goal: when the user sends a message in the Chat Workspace, a real AI model (routed by agent) answers, persists, and streams back via Supabase Realtime — with **no visual changes** to the existing minimal design.

---

## 1. Database (migration)

**New table `conversations`**
- `id uuid pk default gen_random_uuid()`
- `user_id uuid not null` (no FK to auth.users per project rules)
- `agent_id uuid not null references public.agents(id)`
- `channel text` — `talent | growth | intelligence | content` (nullable)
- `title text`
- `status text default 'active'` — `active | done`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`
- Trigger: `update_updated_at_column` on update.

RLS (enabled): `select / insert / update` where `user_id = auth.uid()`.

**New table `messages`**
- `id uuid pk default gen_random_uuid()`
- `conversation_id uuid not null references public.conversations(id) on delete cascade`
- `role text not null check (role in ('user','assistant'))`
- `content text not null`
- `agent_id uuid references public.agents(id)`
- `model_used text`
- `tokens_used integer`
- `is_error boolean default false`
- `created_at timestamptz default now()`

RLS: all access gated by `EXISTS (select 1 from conversations c where c.id = messages.conversation_id and c.user_id = auth.uid())`.

Index: `(conversation_id, created_at)`.

Realtime: `ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;` and `REPLICA IDENTITY FULL`.

**Extend `agents` table**
- Add `model_provider text` (`openai | anthropic | google`)
- Add `model_id text`

Seed/update by agent name (case-insensitive):
| Agent  | provider  | model_id |
|--------|-----------|----------|
| Scout  | openai    | gpt-4o |
| Aria   | anthropic | claude-haiku-4-5-20251001 |
| Penn   | anthropic | claude-haiku-4-5-20251001 |
| Hawk   | google    | gemini-pro |
| Scribe | anthropic | claude-sonnet-4-6 |

---

## 2. Secrets

Already present: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`.
Missing: **`GOOGLE_AI_API_KEY`** — request via `add_secret` before deploying (used by Hawk). Function falls back gracefully if missing (Hawk returns a friendly error message).

Note: Spec hard-codes external model providers. We will follow it as written and not silently swap to Lovable AI.

---

## 3. Edge function `chat-respond`

`supabase/functions/chat-respond/index.ts`, JWT-validated in code (`getClaims`), CORS enabled, no streaming (single JSON response — Realtime delivers it to the UI).

Flow:
1. Verify JWT → `userId`.
2. Parse + Zod-validate `{ message, agent_id, conversation_id?, channel? }`.
3. If no `conversation_id` → insert new conversation (`title` = first 50 chars of message). Else load and verify ownership.
4. Insert user message row (`role: 'user'`, `agent_id: null`).
5. Load agent (`name`, `model_provider`, `model_id`) + last 20 messages asc.
6. Build system prompt from a hard-coded `SYSTEM_PROMPTS` map keyed by agent name (Scout/Aria/Penn/Hawk/Scribe text per spec). Fallback generic prompt if unknown.
7. Call provider:
   - **openai**: `POST https://api.openai.com/v1/chat/completions` with `Authorization: Bearer …`, `messages = [system, …history, user]`, `max_tokens: 1500`. Extract `choices[0].message.content`, `usage.total_tokens`.
   - **anthropic**: `POST https://api.anthropic.com/v1/messages` with `x-api-key`, `anthropic-version: 2023-06-01`, `system`, `messages`, `max_tokens: 1500`. Extract `content[0].text`, `usage.input_tokens + output_tokens`.
   - **google**: `POST …/v1beta/models/{model_id}:generateContent?key=…`, prepend system as first user turn, alternate `user`/`model` roles, parts `[{text}]`. Extract `candidates[0].content.parts[0].text`.
8. Insert assistant message with `model_used`, `tokens_used`. On provider error, insert `is_error: true` assistant message ("I couldn't process that request. Please try again.") and still respond 200.
9. Return `{ conversation_id, message }`.

`supabase/config.toml`: add `[functions.chat-respond] verify_jwt = true` (we validate manually too, but keep gateway check on since this is user-scoped).

---

## 4. Frontend wiring (no visual changes)

### 4a. Chat view model

`src/contexts/ChatWorkspaceContext.tsx` — add a new `ChatViewKind` variant:
```ts
| { kind: 'chat'; conversationId: string }
```
Existing `conversation` (plan-based), `channel`, `agent`, `empty` variants stay so the plan/orchestration features still work. Channel default-agent map:
```ts
const CHANNEL_DEFAULT_AGENT = { talent:'scout', growth:'penn', intelligence:'hawk', content:'scribe' };
```

### 4b. New hook `useChatConversation(conversationId)`

`src/hooks/useChatConversation.ts`:
- Fetch all messages for conversation ordered asc.
- Subscribe to `postgres_changes` on `messages` filtered by `conversation_id=eq.{id}` (INSERT) → append.
- Returns `{ messages, loading }`.

### 4c. New hook `useUserConversations()`

Lists `conversations` for `user_id = auth.uid()`, ordered by `updated_at desc`, with active/done filter. Replaces the plan list in the sidebar's All/Active/Done filter for the new chat surface.

### 4d. Sender service

`src/lib/chatRespond.ts`:
```ts
supabase.functions.invoke('chat-respond', { body: { message, agent_id, conversation_id, channel } })
```
Returns `{ conversation_id }`. UI does NOT need to wait for the assistant text — Realtime will deliver it.

### 4e. Composer changes (`ChatComposerPro.tsx`)

In `submit()`:
1. Resolve target agent:
   - If `@mention` → that agent.
   - Else if `view.kind === 'chat'` → reuse the conversation's `agent_id` (passed via context).
   - Else if `view.kind === 'channel'` → `CHANNEL_DEFAULT_AGENT[view.dept]`.
   - Else → default to Scout.
2. Look up agent uuid from `useAgents` (match by slug/name).
3. Call `chatRespond({ message: text, agent_id, conversation_id: currentChatId, channel: viewKind==='channel' ? view.dept : null })`.
4. On success with new id → `setView({ kind: 'chat', conversationId })`.
5. Optimistically insert local user message into a small in-memory queue keyed by conversation id (React Query cache or context) so it appears instantly; Realtime dedupe by `id` after server insert.
6. While `submitting`, `ChatView` shows the typing indicator (existing 22px initial circle + three pulsing 4px dots in `#484F58`, 200ms staggered) — purely typographic, no new visual primitives.

Keep all existing styling tokens. No new colors, no portraits.

### 4f. New view `ChatView`

`src/components/chat/workspace/ChatView.tsx`, used when `view.kind === 'chat'`:
- Uses `useChatConversation(conversationId)`.
- Renders user messages right-aligned plain text (`text-[#F0F6FC]`), agent messages with the existing `InitialCircle` + name + body text.
- Detects "structured" content (has `\n\n` and ≥3 lines or starts with `- ` / `1. `) → wraps in inset block: `bg-white/[0.03]`, `border border-white/[0.06]`, `rounded-md`, `p-4`, copy button (Lucide `Copy`, 12px, `#484F58` → hover `#7D8590`).
- Typing indicator row when `submitting && lastRole==='user'`.

Wire `ChatWorkspace.tsx` body to render `<ChatView/>` for the new variant.

### 4g. Sidebar (`ConversationsSidebar.tsx`)

Add a section above plans (or replace plan list entirely for the All/Active/Done filters) listing `useUserConversations()`:
- 24px `InitialCircle` of agent
- title (truncate 30 chars) + relative timestamp `#484F58`
- Active row: `bg-white/[0.04]`, no border change.
- Click → `setView({ kind: 'chat', conversationId })`.

Plan-based items remain accessible (keeps orchestration features).

### 4h. Channel context & placeholder

`ChatComposerPro` already shows the `# talent` / `@ Scout` pill. Update placeholder when `view.kind === 'channel'` → `Message #${dept}…`. No other visual change.

---

## 5. Files touched

**Created**
- `supabase/functions/chat-respond/index.ts`
- `src/hooks/useChatConversation.ts`
- `src/hooks/useUserConversations.ts`
- `src/lib/chatRespond.ts`
- `src/components/chat/workspace/ChatView.tsx`

**Edited**
- `supabase/config.toml` (function block)
- `src/contexts/ChatWorkspaceContext.tsx` (new view variant + channel→agent map export)
- `src/components/chat/workspace/ChatWorkspace.tsx` (render `ChatView` branch)
- `src/components/chat/workspace/ChatComposerPro.tsx` (route through `chat-respond`)
- `src/components/chat/workspace/ConversationsSidebar.tsx` (chat conversations list + click handler + placeholder for channel)

**Migrations**
- Create `conversations`, `messages`, indexes, RLS, realtime publication.
- Alter `agents` add `model_provider`, `model_id`; UPDATE rows for the 5 agents by name.

---

## 6. Open items / pre-flight

- Need to add secret **`GOOGLE_AI_API_KEY`** before Hawk works. Will request it during implementation.
- Existing `agents` table currently powers the orchestration system — adding two nullable columns is non-breaking. No existing code reads them, so safe.
- Plan-based orchestration (`submitInstruction`, plans/tasks UI) is left intact; the new chat path is additive and used when the composer determines "this is a direct chat" (default for all agent/channel/empty views going forward). If you later want to retire the plan path entirely, that's a follow-up.
