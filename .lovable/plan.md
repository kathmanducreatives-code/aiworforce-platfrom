# Plan — Lead results in the side panel (Workbench)

## Goal
After a lead-sourcing plan completes, the chat stays as the command surface and the actual leads render in the **existing right-side Workbench panel** (the same surface that already shows ScoutResultsView / AgentOutputViewer). The panel opens automatically, shows a premium lead table with action buttons (Enrich, Draft, Rank, Export CSV, Save to Signal Feed), and every action continues the **same conversation**.

## Existing mechanism we reuse
- Side panel: `ChatWorkspace.tsx` already renders `<WorkbenchPanel />` on the right (desktop) / fullscreen overlay (mobile), controlled by `useChatWorkspace().workbenchOpen` + `openWorkbench({...})`.
- `WorkbenchPanel.tsx` already has tabs (Summary, Results, Rankings, Drafts, Sources, Activity, Raw) driven by `useWorkbenchData(selectedOutput)`.
- `ScoutResultsView.tsx` already renders Apify jobs / people / LinkedIn engagement items.
- Plan/task results already exist in `task_plans` + `tasks` + `tool_calls`; `lead_candidates` (with `account.domain`) is populated post-run.
- Structured card actions go through `src/lib/chatActions.ts → dispatchChatAction` (conversation-id preserving — built in the previous task).

We will **not** introduce a parallel artifact system. We will:
1. Have the backend emit a `ui_panel` hint on the post-lead assistant message.
2. Have the chat frontend call the existing `openWorkbench(...)` automatically when that hint arrives.
3. Add one new tab/view (`LeadResultsView`) to the existing `WorkbenchPanel`, fed by a new `useLeadResults(planId)` hook that loads from `lead_candidates`.
4. Replace the in-chat `PostLeadActionsCard` action toolbar with an action bar **inside** the new side-panel view (keep a compact mirror in chat).

## Backend changes

### `supabase/functions/run-agent/index.ts` (post-lead block, lines ~542–574)
When `leadRows.length > 0`, in addition to the existing `ui_card` we add:

```ts
const uiPanel = {
  kind: "lead_results",
  title: `${leadRows.length} ${sourceLabel} lead${leadRows.length === 1 ? "" : "s"}`,
  subtitle: `Found by Scout · Saved for review · Nothing sent`,
  source_type: planMeta?.source_type ?? "hiring_signal",
  lead_count: leadRows.length,
  enrichable_count: enrichable,
  lead_candidate_ids: leadRows.map(l => l.id),
  plan_id,
  default_view: "table",
  actions: ["enrich","draft_outreach","enrich_and_draft","rank","export_csv","save_to_signal_feed"],
};
```
Persisted on the same assistant message:
```ts
metadata: { ui_card: card, ui_panel: uiPanel, post_lead_actions: true, plan_id }
```
Assistant `content` becomes: *"Scout found N leads. I opened them in the results panel and saved them for later review. Nothing was sent."*

No new tables. We reuse `lead_candidates` + `accounts` + `signals` joined by `plan_id` for the panel.

### `supabase/functions/pilot-chat/index.ts` (lead_result_action routing)
Card actions already arrive with `action_source` + `metadata`. Add handling for `metadata.intent === "lead_result_action"` with:
- `enrich`              → dispatch Hawk/Firecrawl on `lead_candidate_ids` having a `account.domain`; skip rest; emit a status assistant message.
- `draft_outreach`      → dispatch Penn/Claude using Company Brain + ICP + leads (+ enrichment if present); writes `outreach_drafts`, requires approval, no send.
- `enrich_and_draft`    → run enrich then draft, both scoped to same `plan_id` / `conversation_id`.
- `rank`                → dispatch Aria over existing `lead_candidate_ids` only (no Apify call).
- `export_csv`          → server returns a `ui_panel` patch with a signed/data-URL CSV (built from `lead_candidates` join); no agent run.
- `save_to_signal_feed` → already implemented `save_only` path; reuse.

All branches MUST require `conversation_id` and emit their assistant reply on the same conversation, with `metadata.plan_id` preserved so the Workbench `LeadResultsView` can refresh.

## Frontend changes

### New: `src/components/chat/workspace/workbench/LeadResultsView.tsx`
Premium SaaS layout:
- Sticky header: title + subtitle, source-type chip, count badge.
- Filter chips: signal type / has-website / fit≥X.
- Table (default) + card view toggle, columns: Person, Title, Company, Location, Signal, Source, Fit, Status, Website, LinkedIn.
- Row click → right-side detail drawer inside the panel (existing `WorkbenchPanel` width allows this; we render an inline `<aside>` overlay).
- Action toolbar (sticky bottom) with credit estimates from `_shared/creditEstimate.ts`:
  - Enrich (1 cr / website) · Draft (2 cr / lead) · Enrich + draft · Rank (1 cr / 10) · Export CSV · Save to Signal Feed.
- Each action calls `dispatchResultAction(...)` (see below).

### New: `src/hooks/useLeadResults.ts`
```ts
useLeadResults(planId: string | null): {
  loading, error, items: LeadResultItem[], refresh()
}
```
Selects `lead_candidates` joined with `accounts`, `contacts`, `signals` and `lead_enrichments` for the given `plan_id`, normalises to `LeadResultItem` (shape from the user's spec). Subscribes to Realtime on `lead_candidates` filtered by `plan_id` so the panel updates progressively as Enrich/Draft fill columns.

### `src/components/chat/workspace/workbench/WorkbenchPanel.tsx`
- Extend `Tab` union with `'leads'`.
- When the active selection carries a `lead_results` panel hint, default tab = `'leads'` and render `<LeadResultsView planId={...} />`.

### `src/contexts/ChatWorkspaceContext.tsx`
Extend `WorkbenchSelection` with optional `panel?: { kind: 'lead_results'; planId: string; meta: UiPanel }` so `openWorkbench` can carry the lead-results hint. (Backwards compatible — existing tool-call selections still work.)

### `src/components/chat/workspace/ChatView.tsx` (lines ~115–165)
When a rendered assistant message has `meta.ui_panel?.kind === 'lead_results'`:
- On mount/first-seen (guarded by a `Set<messageId>` ref to avoid re-opens after manual close), call `openWorkbench({ planId: meta.ui_panel.plan_id, panel: { kind:'lead_results', planId, meta } })`.
- Keep showing a compact in-chat `PostLeadActionsCard` summary ("Open in results panel" button + Save-only) but move the heavy action buttons into the side panel.

### New: `src/lib/chatActions.ts` — add `dispatchResultAction`
```ts
dispatchResultAction({
  conversationId, planId, leadCandidateIds, savedOutputId,
  action: 'enrich'|'draft_outreach'|'enrich_and_draft'|'rank'|'export_csv'|'save_to_signal_feed',
  estimatedCredits,
})
```
Internally calls `dispatchChatAction` with `action_source: 'lead_results_panel'` and `metadata: { intent: 'lead_result_action', action, lead_candidate_ids, plan_id, saved_output_id, estimated_credits }`. Conversation-id is required — same guard as before.

## React error #310 fix
Likely cause is `WorkbenchPanel.tsx` calling `useMemo`/`useEffect` *after* an early `return` (the loading branch at line ~57 returns before the later `useMemo`/`useEffect` calls at lines 67–96). We will move all hooks above any early return (standard hooks-order fix). We will also wrap `LeadResultsView` and `PostLeadActionsCard` in the existing `ChatErrorBoundary` slots already present.

After the move, run dev (non-minified) and re-verify there is no `#310`.

## CSV export
Server builds the CSV in `pilot-chat` (`export_csv` branch) and returns it in the assistant `metadata.ui_panel_patch = { csv_data_url, filename }`. `LeadResultsView` watches the latest message for that patch and renders a "Download CSV" button + a small inline preview (first 10 rows) — no new bucket required.

## Tests
Unit (Deno) in `supabase/functions/_shared/`:
- `creditEstimate.test.ts` — add cases for `rank`, `export`, `enrich_and_draft`.
- New `leadResultPanel.test.ts` — `buildLeadResultsPanel(leadRows, sourceLabel)` shape.

Frontend (vitest):
- `useLeadResults` — normalises rows correctly; tolerates null account/contact.
- `ChatView` auto-opens workbench exactly once per `ui_panel` message id.
- `dispatchResultAction` refuses without `conversationId`.

Manual QA matrix (Tests A–E from the brief) executed in the preview.

## Files touched
**New**
- `src/components/chat/workspace/workbench/LeadResultsView.tsx`
- `src/components/chat/workspace/workbench/LeadResultsActionBar.tsx`
- `src/hooks/useLeadResults.ts`
- `supabase/functions/_shared/leadResultPanel.ts` (+ test)

**Edited**
- `supabase/functions/run-agent/index.ts` (emit `ui_panel`, better assistant copy)
- `supabase/functions/pilot-chat/index.ts` (handle `lead_result_action` intents, CSV export)
- `src/contexts/ChatWorkspaceContext.tsx` (extend `WorkbenchSelection`)
- `src/components/chat/workspace/workbench/WorkbenchPanel.tsx` (hooks-order fix, `leads` tab)
- `src/components/chat/workspace/ChatView.tsx` (auto-open on `ui_panel`)
- `src/components/chat/workspace/bubbles/PostLeadActionsCard.tsx` (slim chat mirror)
- `src/lib/chatActions.ts` (`dispatchResultAction`)
- `supabase/functions/_shared/creditEstimate.ts` (rank/export/combo estimates)

## Non-goals
- No new database tables, no schema migrations.
- No second/parallel side panel — strictly reuse `WorkbenchPanel`.
- No auto-send of outreach. Drafts remain approval-gated.
- Signal Feed remains the long-term store; it just stops being the only visible result.

Approve to implement.
