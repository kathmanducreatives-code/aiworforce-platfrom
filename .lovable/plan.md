# Premium Slack-style Chat Workspace + Pilot Avatar

Make Agentory's chat workspace feel like a premium AI-employee command center. Chat-first by default, focused composer, real per-agent typing/working states, clean Workbench discipline. Also ship the new Pilot profile picture across the platform.

No backend workflow logic changes. No DB migrations. No auto-send.

## 1. Pilot avatar (cross-platform)

- Save the uploaded image as `src/assets/agents/pilot.png` (via lovable-assets → `pilot.png.asset.json`, or direct asset import if other agent PNGs are local — match the existing pattern in `src/data/agentProfiles.ts`).
- Update `PILOT_PROFILE.image` in `src/data/agentProfiles.ts` from `null` → the imported Pilot image.
- All existing surfaces (`AgentAvatar` chat/workspace variant, WorkforceDock, CommandDock, ActivityTimeline, conversation rows, typing indicator) already resolve via `resolveAgent` / `AGENT_BY_ID`, so they pick up the new Pilot image automatically. Verify no place still renders a "P" initial fallback.

## 2. Default workspace state

In `ChatWorkspaceContext.tsx`:
- Keep `workbenchOpen` default `false` (already true).
- Add `historyOpen` default `true` (currently defaults `false`) — but only on first open of the workspace (not every render).
- Add `composerFocused: boolean` + `setComposerFocused`.
- Auto-collapse: when `composerFocused` becomes `true`, call `closeHistory()`. Do not auto-reopen on blur.
- `Esc` key: if `historyOpen` and composer focused → close history first, then fall through to existing close logic.

In `ChatWorkspace.tsx`:
- On mount of the workspace (mode flips to fullscreen), call `openHistory()` once if no explicit user toggle has happened yet.
- Ensure Workbench remains closed unless a result/panel is explicitly produced (today `openWorkbench` is only called from result/panel events — keep as-is).

## 3. Conversation history drawer

Upgrade `ConversationsSidebar.tsx` and the drawer in `ChatWorkspace.tsx`:

- Header row:
  - `+ New chat` button (primary emerald pill).
  - Search input (filters by `title` client-side).
  - Filters: All / Active / Done (already there — keep).
- Conversation row:
  - Use real `AgentAvatar` (chat/workspace variant) instead of `InitialCircle`.
  - Hover reveals a kebab menu (`⋯`) with: Rename, Delete.
  - "New result" dot: small emerald pulse on rows where `updated_at > lastSeen` and conversation isn't active.
- Replace ad-hoc avatars + add active-row highlight (emerald left border).
- Drawer auto-closes when composer is focused; reopens via top-bar `PanelLeft` button or `Cmd/Ctrl+B`.

New hook `useConversationActions` in `src/hooks/useConversationActions.ts`:
- `createConversation()` → inserts row in `conversations`, opens it, closes Workbench, focuses composer.
- `renameConversation(id, title)` → optimistic update + supabase update.
- `deleteConversation(id)` → supabase delete, navigate to most recent remaining conversation or `{ kind: 'empty' }`.

New components:
- `ConversationRowMenu.tsx` (dropdown with Rename/Delete).
- `RenameConversationDialog.tsx` (inline-or-modal; simple modal w/ shadcn Dialog).
- `DeleteConversationDialog.tsx` (shadcn AlertDialog with "Delete conversation?" copy).
- `ChatHeaderMenu.tsx` — kebab in `ChatView` header to rename/delete current chat.

Keyboard:
- `Cmd/Ctrl+N` → new chat.
- `Cmd/Ctrl+B` → toggle history.
- `Esc` → close history when open.

## 4. Composer focus behavior

In `ChatComposerPro.tsx`:
- `onFocus` → `setComposerFocused(true)` + `closeHistory()`.
- `onBlur` → `setComposerFocused(false)` (do NOT reopen history).
- Preserve typed text (don't unmount).
- Smooth Sheet slide-out (already animated by shadcn Sheet — fine).

## 5. Workbench discipline

Already opens only via `openWorkbench(sel)` from result panel emissions. Confirm:
- `ChatWorkspace` mount does not call `openWorkbench`.
- `setView({ kind: 'chat' ... })` (clicking a conversation row) does NOT auto-open Workbench. Add: when switching conversations, call `closeWorkbench()` unless the target conversation has a pending panel selection.
- "View results" pills on result-producing messages already trigger `openWorkbench` — verify in `PostLeadActionsCard`. Add a small toast: `"Result opened in Workbench"`.

## 6. Agent typing / working indicator

Create `src/components/chat/workspace/AgentTypingIndicator.tsx`:
- Props: `slug`, `verb` (e.g. "sourcing", "ranking", "drafting", "researching", "writing", "thinking"), optional `subtle`.
- Renders: `<AgentAvatar size="sm" status="thinking" />` + `{Name} is {verb}` + 3-dot framer-motion staggered pulse + soft accent glow ring.
- Use agent's `accentHex` for dots/ring.

Replace the existing `TypingDots` block at `ChatView.tsx:232-243` with `AgentTypingIndicator`. Pick verb from a helper `inferVerb(slug, lastWorkflowStep)`:
- pilot → "thinking" / "coordinating"
- scout → "sourcing"
- aria → "ranking"
- hawk → "researching"
- penn → "drafting"
- scribe → "writing"

Plug the indicator into `AgentBubble.tsx` `state === 'thinking'` branch too (replace inline implementation), and into `ConversationView` if it renders a pending state.

For execution-state messaging across multiple agents in one turn (Scout → Aria → Pilot), the typing indicator subscribes to the active plan's current step (already surfaced via plan/task data) and updates the verb + agent slug as steps progress. Read from existing `usePlanDetail` / activity timeline data; do not change backend.

## 7. UI style polish

- Conversation rows: compact (h-9), agent avatar 24px, active row has left-edge emerald accent bar, hover reveals `⋯`.
- Drawer: glass surface `bg-background/80 backdrop-blur-xl`, subtle inner border.
- Active agent glow in WorkforceDock when their plan step is running (uses existing accent).
- Smooth Sheet animation already in place.

## 8. Files touched

```text
new:
  src/components/chat/workspace/AgentTypingIndicator.tsx
  src/components/chat/workspace/ConversationRowMenu.tsx
  src/components/chat/workspace/RenameConversationDialog.tsx
  src/components/chat/workspace/DeleteConversationDialog.tsx
  src/components/chat/workspace/ChatHeaderMenu.tsx
  src/hooks/useConversationActions.ts
  src/assets/agents/pilot.png (+ .asset.json if using CDN)

edited:
  src/data/agentProfiles.ts            (Pilot image)
  src/contexts/ChatWorkspaceContext.tsx (default historyOpen, composerFocused, esc/kbd)
  src/components/chat/workspace/ChatWorkspace.tsx (mount-time open history, kbd shortcuts)
  src/components/chat/workspace/ConversationsSidebar.tsx (new chat btn, search, row menu, AgentAvatar)
  src/components/chat/workspace/ChatComposerPro.tsx (focus/blur wiring)
  src/components/chat/workspace/ChatView.tsx (AgentTypingIndicator, header menu)
  src/components/chat/workspace/ConversationView.tsx (use AgentTypingIndicator)
  src/components/chat/workspace/bubbles/AgentBubble.tsx (use AgentTypingIndicator)
  src/components/chat/workspace/bubbles/PostLeadActionsCard.tsx (toast on View results)
```

## 9. Verification

- `bunx tsc --noEmit`
- Browser QA per spec (Test A–H): open workspace → history open + workbench closed; focus composer → history collapses; new/rename/delete flows; lead workflow shows Scout/Aria typing indicators then Workbench opens; close Workbench → "View results" reopens it.
- Confirm Pilot avatar appears in: WorkforceDock, CommandDock, ConversationsSidebar (any pilot convo), typing indicator, ActivityTimeline.

## Constraints honored
- No backend workflow/route changes, no DB migration, no `145631`, no auto-send/DM/email, drafts stay approval-gated, landing untouched, existing Lead Source Selector / Dynamic Lead Brief / dispatchChatAction / dispatchResultAction / LeadResultsView / locked columns / capped persistence untouched.
