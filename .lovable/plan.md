# Fix: Card actions must stay in the same conversation

## Root cause

Every chat card (Lead Source Selector, Lead Search Brief, Post-Lead Actions, Clarification, ui_actions, NoResults, ScoutResultsView, SignalFeed, etc.) submits its action by dispatching:

```ts
window.dispatchEvent(new CustomEvent('chat:send', { detail: text }))
```

— a plain text string with **no `conversation_id`**.

`ChatComposerPro` then resolves the conversation from the *current view*:

```ts
const conversationId = view.kind === 'chat' ? view.conversationId : null;
```

Failure modes this produces:

1. If the user submitted the lead brief from `/dashboard` (view = `empty`/`channel`), `conversationId` is `null` → `pilot-chat` creates a **new conversation** for the brief; the composer then `setView({ kind:'chat', conversationId: newConvId })` jumps the user into it.
2. The execution plan returned by `orchestrate`/`run-agent` (which the lead brief triggered) lands in *that* conversation, while the original "Find me leads" + Lead Source Selector sit in the original chat — the cards appear "in a different conversation".
3. The Post-Lead Actions card runs after the plan finishes. Clicking "Save only" dispatches text again; if the user has since switched threads (or is in `empty` view from the sidebar), composer again resolves `null` → `pilot-chat` creates *another* new conversation titled "Save these leads to the Signal…".
4. There is no guard: card actions silently fall back to "start a new chat" instead of erroring.

Additional small bug: dashboard helpers already pass `{ text }` objects to `chat:send`, but the composer's `onSend` only handles `typeof detail === 'string'`, so those silently no-op.

## Fix architecture

Single principle: **a card action must dispatch a structured payload that carries the conversation_id of the message that rendered the card**, and the composer/backend must use that id without exception.

### 1. New helper: `dispatchChatAction`

`src/lib/chatActions.ts` (new):

```ts
export type ChatActionSource =
  | 'lead_source_card'
  | 'lead_intake_card'
  | 'post_lead_actions_card'
  | 'lead_sourcing_error_card'
  | 'clarification_card'
  | 'ui_actions_button'
  | 'signal_feed_action'
  | 'scout_results_action'
  | 'no_results_card'
  | 'recommended_move'
  | 'workforce_brief';

export interface ChatActionDetail {
  text: string;
  conversation_id: string | null;   // null only for explicit "new chat" entry points
  action_source?: ChatActionSource;
  metadata?: Record<string, unknown>;
}

export function dispatchChatAction(detail: ChatActionDetail) {
  if (detail.action_source && !detail.conversation_id) {
    console.warn('[chat-action] missing conversation_id', detail);
  }
  window.dispatchEvent(new CustomEvent('chat:send', { detail }));
}

// Back-compat: plain text from empty-state suggestions
export function dispatchFreeformSend(text: string) {
  window.dispatchEvent(new CustomEvent('chat:send', { detail: { text, conversation_id: null } }));
}
```

### 2. Card components receive `conversationId`

Update prop signatures (no logic changes other than threading the id):

- `LeadSourceCard({ payload, conversationId })`
- `LeadIntakeCard({ payload, conversationId })`
- `PostLeadActionsCard({ payload, conversationId })`
- `ClarificationCard({ ..., conversationId })`
- `NoResultsCard({ ..., conversationId })`
- `ScoutResultsView({ ..., conversationId })`
- `LeadSourcingErrorCard` (if present in workbench) → same

Replace every internal `window.dispatchEvent(new CustomEvent('chat:send', { detail: text }))` with:

```ts
dispatchChatAction({
  text,
  conversation_id: conversationId,
  action_source: 'post_lead_actions_card',
  metadata: { action: o.action, lead_candidate_ids: payload.lead_candidate_ids },
});
```

(action_source/metadata vary per card.)

`ChatView.tsx` passes `conversationId={m.conversation_id}` to each card and to the `ui_actions` button group.

SignalFeed / dashboard widgets that already use `chat:send`: switch to `dispatchChatAction({ ..., conversation_id: activeConversationIdFromContext ?? null, action_source: ... })`. For dashboard surfaces where no conversation is active, leave `conversation_id: null` and `action_source: 'recommended_move'` — composer will treat as fresh chat (allowed).

### 3. `ChatComposerPro` accepts structured detail

Rewrite `onSend`:

```ts
const onSend = (e: Event) => {
  const raw = (e as CustomEvent).detail;
  const detail: ChatActionDetail =
    typeof raw === 'string' ? { text: raw, conversation_id: null }
    : (raw && typeof raw === 'object' && typeof raw.text === 'string') ? raw
    : null;
  if (!detail || !detail.text.trim()) return;
  void submit(detail);
};
```

`submit(detail)`:

- Card actions: `if (detail.action_source && !detail.conversation_id) { toast.error('Action lost its conversation context. Please retry.'); return; }`
- Resolve `conversationId = detail.conversation_id ?? (view.kind === 'chat' ? view.conversationId : null)`.
- Pass to `pilotChat({ message: detail.text, workspace_id, conversation_id: conversationId, metadata: detail.metadata })`.
- Only call `setView({ kind:'chat', conversationId: newConvId })` when **both** the prior `conversationId` was `null` **and** `detail.action_source` was absent (real freeform new chat). Never re-route the view for a card action — it already belongs to a conversation.

### 4. `pilotChat` wrapper

`src/lib/pilotChat.ts`: extend `PilotChatInput` with optional `metadata?: Record<string, unknown>` and forward it in the invoke body.

### 5. Backend `supabase/functions/pilot-chat/index.ts`

- Read optional `action_source` and `metadata` from the body.
- If `action_source` is present and `conversation_id` is missing/invalid (or doesn't belong to the caller's workspace), return `400 { error: "Action could not continue because conversation context was missing. Please retry." }` — **never** create a new conversation in this branch.
- For card-action submissions, skip any "generate conversation title" path that renames the thread (so "Save only" cannot rename the chat to "Save these leads to the Signal…"). Conversation title is only generated on the first freeform turn.
- Persist `metadata` (lead_request, post_lead_action, etc.) onto the inserted user message so `orchestrate` / `run-agent` can resolve the same `conversation_id` for plan/result/post-lead cards.

### 6. `orchestrate` + `run-agent` insertion path

Both functions already accept `conversation_id`; audit the call sites that insert execution-plan messages, tool-progress messages, results, error cards, and post-lead-actions cards to make sure they use **the conversation_id from the plan/run metadata**, not a "latest active conversation" lookup. Add a unit-style assertion in the function: refuse to insert if no `conversation_id` is resolvable, instead of falling back.

### 7. "Save only" special-case

In `pilot-chat`, when `action_source === 'post_lead_actions_card'` and `metadata.action === 'save_only'`:

- Do not invoke `orchestrate`.
- Insert a short assistant reply in the same conversation: `"Saved — these leads are in Signal Feed."`
- No new plan, no sourcing, no title change.

### 8. Defensive guards

- Frontend cards: disable action buttons (with tooltip "Missing chat context") when `conversationId` is falsy.
- Backend: log `{ action_source, has_conversation_id, workspace_id }` for every card action to make regressions obvious.

## Files to change

Frontend:
- `src/lib/chatActions.ts` (new)
- `src/lib/pilotChat.ts` (add `metadata`)
- `src/components/chat/workspace/ChatComposerPro.tsx` (onSend + submit)
- `src/components/chat/workspace/ChatView.tsx` (thread `conversationId` into all cards + ui_actions buttons)
- `src/components/chat/workspace/bubbles/LeadSourceCard.tsx`
- `src/components/chat/workspace/bubbles/LeadIntakeCard.tsx`
- `src/components/chat/workspace/bubbles/PostLeadActionsCard.tsx`
- `src/components/chat/workspace/bubbles/ClarificationCard.tsx`
- `src/components/chat/workspace/workbench/NoResultsCard.tsx`
- `src/components/chat/workspace/workbench/ScoutResultsView.tsx`
- `src/components/signals/SignalFeed.tsx`, `src/components/signals/SignalCard.tsx`
- `src/components/dashboard/RecommendedMoves.tsx`, `src/components/dashboard/WorkforceBriefHero.tsx`, `src/pages/Content.tsx`, `src/pages/Agents.tsx` (use `dispatchChatAction` / `dispatchFreeformSend`)

Backend (Edge Functions):
- `supabase/functions/pilot-chat/index.ts` — accept `action_source` + `metadata`, reject missing `conversation_id` for card actions, skip title regen, handle `save_only` inline.
- `supabase/functions/orchestrate/index.ts` and `supabase/functions/run-agent/index.ts` — strict use of plan/run `conversation_id` for every inserted message (plan, progress, results, post-lead card, errors).

## Tests

Add `src/lib/chatActions.test.ts` plus a small Deno test for pilot-chat:

1. `dispatchChatAction` with `action_source` + no `conversation_id` → composer rejects, no `pilotChat` call.
2. Lead Source Selector submit → `pilotChat` called with the same `conversation_id` as the rendering message; view does not change.
3. Lead Intake submit → same conversation; execution plan stored against same `conversation_id`.
4. Post-lead `save_only` → backend returns reply in same conversation, no `orchestrate` call, no title change.
5. Post-lead `rank` / `draft_outreach` → orchestrate invoked with same `conversation_id`.
6. Error card retry → reuses `lead_request` metadata + same `conversation_id`.
7. Backend: card-action POST with missing `conversation_id` → 400, no insert.
8. Freeform empty-state send (no view) → still creates a new conversation as before.

## Browser QA (after build)

Tests A–D from the request: lead brief submit, Save only, Rank by fit, Apify-error retry / change source. Verify in each that:

- No new sidebar entry appears.
- Active conversation stays selected.
- All follow-up cards render under the original chat.

## Out of scope

- Sidebar UX changes, conversation merging, or auto-selection workarounds.
- Changes to the actor registry or Apify config.
- Visual redesign of any card.
