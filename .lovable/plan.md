
# Agentory chat ↔ Workbench sync + artifact model

Codex/Claude-style: chat = command surface, Workbench = structured output surface. Every meaningful AI result becomes a linked, addressable artifact. UI changes only — no backend rewrite, no DB migrations, no production deploy, no outbound automation.

## 1. Artifact model (frontend state)

New module `src/lib/workbenchArtifacts.ts`:

```ts
export type WorkbenchArtifactKind =
  | "lead_results" | "competitor_analysis" | "content_draft"
  | "outreach_drafts" | "website_audit" | "qa_report"
  | "coding_prompt" | "csv_export" | "report" | "generic";

export type WorkbenchArtifactStatus =
  "running" | "complete" | "partial" | "failed" | "blocked";

export interface WorkbenchArtifact {
  id: string;                    // stable: ui_panel.artifact_id || msg.id || plan_id
  conversation_id: string;
  source_message_id?: string;
  user_message_id?: string;
  assistant_message_id?: string;
  plan_id?: string;
  run_id?: string;
  kind: WorkbenchArtifactKind;
  title: string;
  subtitle?: string;             // short preview of the user request
  created_at: string;
  status: WorkbenchArtifactStatus;
  panel: unknown;                // existing panel meta (LeadResultsPanelMeta, etc.)
  metadata?: Record<string, unknown>;
}
```

Plus `buildArtifactFromMessage(msg, prevUserMsg)` that:
- reads `metadata.ui_panel` if present
- derives `kind` from `ui_panel.kind` (defaults: lead_results → existing, anything else → generic for now)
- derives `id` from `ui_panel.artifact_id` ?? `plan_id` ?? `msg.id` (backward compat)
- derives `subtitle` from the immediately-preceding user message text (truncated ~120 chars)
- derives `status` from `ui_panel.status` or workflow_status

## 2. ChatWorkspaceContext extension

Extend (do not replace) `src/contexts/ChatWorkspaceContext.tsx`:

New state:
- `artifactsByConversation: Record<string, WorkbenchArtifact[]>`
- `activeArtifactId: string | null`
- `lastArtifactByConversation: Record<string, string>` (persisted in localStorage `agentory:last-artifact`)
- Derived: `activeWorkbenchArtifact`, `activeConversationId` (from `view`)

New actions:
- `registerArtifact(a: WorkbenchArtifact)` — upsert by id; if newer for active conversation, set active + open Workbench; if for another conversation, mark "new result" indicator only.
- `openArtifact(id)` — set active + open Workbench (no rerun, no nav).
- `closeWorkbench()` — preserves `activeArtifactId` so View results can reopen.
- `setChatOnlyMode(bool)` — separate from `workbenchOpen`; suppresses auto-open within the conversation.

Backward compat: `selectedOutput` becomes a derived view of `activeWorkbenchArtifact` so existing `WorkbenchPanel`/`useWorkbenchData` keep working.

## 3. Auto-open + "new result" indicator

Move the auto-open effect from `ChatView.tsx` into a single `useArtifactSync(conversationId, messages)` hook:
- Iterates messages, builds artifacts, calls `registerArtifact`.
- Auto-open only if `conversationId === activeConversationId` AND user has not toggled chat-only mode for this conversation.
- For other conversations, increment a per-conversation `unseenArtifacts` counter shown as a dot in `ConversationsSidebar`.

## 4. "View results" button per assistant message

In `ChatView.tsx`, under each assistant message whose `metadata.ui_panel` exists (or that the artifact builder maps to an artifact), render a compact button:

```
[▸ View results · 5 account opportunities found]
```

Click → `openArtifact(artifact.id)`. Also added to `ExecutionPlanCard` when its plan_id has an artifact. No rerun, no new chat.

## 5. Workbench multi-artifact switcher

Update `WorkbenchHeader.tsx`:
- Title = artifact.title; second line = `From: {subtitle}` (preview of originating user message).
- Status chip (running/partial/complete/failed/blocked) with existing color tokens.
- If `artifactsByConversation[active].length > 1`, show a compact dropdown "Viewing: …" listing all artifacts (title · kind · time · status). Selecting one calls `openArtifact`.
- Close button calls `closeWorkbench()` (state preserved).

## 6. Workbench states

`WorkbenchPanel.tsx` already routes by panel kind; add status-aware shells:
- running → skeleton rows in Table tab + ActivityTimeline live
- partial → existing recommended-action banner + "X of Y found" chip
- failed → `FailureRecoveryCard` with Retry (dispatches in same conversation)
- complete → current behavior
- Keep the 3 tabs (Table · Insights · Activity). Raw stays DEV-only (already done).

## 7. Action dispatch contract

Refactor `src/lib/chatActions.ts` so every workbench action goes through:

```ts
dispatchWorkbenchAction({
  conversationId, artifactId, action, rowIds?, estimatedCredits?, metadata?
})
```

Internally still posts to `pilot-chat`/`run-agent` as today, but always includes `conversation_id` and `artifact_id` in the message metadata so the resulting assistant message carries `ui_panel.artifact_id` (so retries/Find-DM/Rank append a new artifact tied to same conversation, not a new chat). Backend functions are not modified in this pass; the frontend tags outgoing requests and tolerates missing `artifact_id` in responses by falling back to message-id-derived ids.

## 8. Conversation rename & delete

In `ConversationsSidebar.tsx` add a per-row kebab menu:
- Rename → inline editable input, optimistic update of `conversations.title` via existing `useUserConversations` hook (add `renameConversation`, `deleteConversation` mutations using supabase client; RLS already scopes to user).
- Delete → AlertDialog confirmation. On confirm: soft logic — if current schema supports `archived_at`/`deleted_at` use it; otherwise delete row. If the deleted conversation is active, `setView({kind:'empty'})` and `closeWorkbench()`. Artifacts in memory for that conversation are dropped.
- New result dot per row from `unseenArtifacts`.

Will inspect `useUserConversations` and the `conversations` table columns before choosing soft vs hard delete; default to hard delete only if no archived column exists.

## 9. Backward compatibility

- Old assistant messages with `ui_panel.kind = "lead_results"` and no `artifact_id` get a synthetic id from `plan_id || msg.id` — they show "View results" and open exactly the same panel as today.
- `WorkbenchPanel`/`LeadResultsView` props unchanged; they read from the active artifact's `panel`.

## 10. Out of scope (explicit)

- No landing page changes.
- No DB migrations. Migration 145631 not touched.
- No edge function deploys (pilot-chat / run-agent / orchestrate unchanged). Optional follow-up plan can add `artifact_id` server-side later.
- No outbound automation: all drafts remain approval-gated as today.
- No new tabs in Workbench; no Raw/Sources surfacing.

## 11. Tests & QA

Add Vitest unit tests:
- `workbenchArtifacts.test.ts`: builder maps `ui_panel` correctly; backward-compat id derivation; subtitle from preceding user msg.
- `ChatWorkspaceContext.test.tsx`: registerArtifact auto-opens for active conv only; close preserves id; openArtifact switches active; multiple artifacts per conv coexist.

Browser QA flows A–G from the request, performed via the preview after build.

## 12. Files touched (planned)

Created:
- `src/lib/workbenchArtifacts.ts`
- `src/hooks/useArtifactSync.ts`
- `src/components/chat/workspace/ViewResultsButton.tsx`
- `src/components/chat/workspace/workbench/ArtifactSwitcher.tsx`
- `src/components/chat/workspace/ConversationRowMenu.tsx`
- tests under `src/lib/__tests__/` and `src/contexts/__tests__/`

Edited:
- `src/contexts/ChatWorkspaceContext.tsx`
- `src/components/chat/workspace/ChatView.tsx`
- `src/components/chat/workspace/ChatWorkspace.tsx` (chat-only toggle)
- `src/components/chat/workspace/ConversationsSidebar.tsx`
- `src/components/chat/workspace/workbench/WorkbenchHeader.tsx`
- `src/components/chat/workspace/workbench/WorkbenchPanel.tsx` (status-aware shells)
- `src/components/chat/workspace/plan/ExecutionPlanCard.tsx`
- `src/lib/chatActions.ts`
- `src/hooks/useUserConversations.ts` (add rename/delete)

Not touched: landing, supabase/migrations, supabase/functions/*, screening pipeline, auth.
