## Goal

Add a premium right-side "Workbench" panel to the existing `ChatWorkspace` that lets users drill into the actual outputs of each agent task and tool call (Scout, Aria, Hawk, Penn, Scribe, Apify, Firecrawl, etc.) without redesigning the rest of the app.

No backend/RLS/edge-function changes. Pure frontend, reads existing tables.

## UX

- New panel docked to the right inside `ChatWorkspace`, opened by:
  - clicking a task row in `ExecutionPlanCard`
  - clicking a `ToolStatusBadge` (e.g. "Apify · 10 results")
  - explicit "Open output" / "View results" buttons we add to rows
- Desktop: resizable split (chat left, Workbench right, default ~42% width, min 360px, collapsible via close button).
- Mobile: opens as a full-screen drawer over the chat.
- State lives in `ChatWorkspaceContext` as `selectedOutput { planId, taskId?, agentSlug?, toolCallId? }`.

`ExecutionPlanCard` stays compact — detailed result rendering moves into Workbench.

## Files to add

```
src/components/chat/workspace/workbench/
  WorkbenchPanel.tsx          // dock container, resize, close
  WorkbenchHeader.tsx         // plan title, agent, task, status, tool, source, timestamp
  WorkbenchTabs.tsx           // Summary / Results / Raw / Reasoning / Next Actions (hide empty)
  AgentOutputViewer.tsx       // routes to per-agent view based on agent_slug
  ScoutResultsView.tsx        // Apify/Firecrawl jobs+companies cards
  AriaRankingView.tsx         // ranked leads, score, Hot/Warm/Maybe/Ignore
  HawkResearchView.tsx        // Firecrawl markdown, signals, sources
  PennDraftView.tsx           // outreach drafts + approval status
  ScribeReportView.tsx        // final report with copy
  RawJsonView.tsx             // collapsed JSON tree
  OutputActionBar.tsx         // chat-prefill actions ("Send to Aria", "Enrich top 3"…)
  useWorkbenchData.ts         // hook merging task + tool_calls + approvals + activity for selection
  normalize.ts                // safe shape detection (extends src/lib/outputShape.ts)
```

## Files to edit

- `src/contexts/ChatWorkspaceContext.tsx` — add `selectedOutput`, `setSelectedOutput`, `workbenchOpen`, `openWorkbench`, `closeWorkbench`, `workbenchWidth`, `setWorkbenchWidth`.
- `src/components/chat/workspace/ChatWorkspace.tsx` — render `WorkbenchPanel` next to the chat column when `workbenchOpen`; mobile uses full-screen overlay.
- `src/components/chat/workspace/plan/ExecutionPlanCard.tsx` — task row + tool badge clicks call `openWorkbench({...})` instead of (or in addition to) the existing `setView({kind:'conversation'})` jump.
- `src/components/chat/workspace/plan/ExecutionTaskRow.tsx` — add "View output" affordance, make row clickable.
- `src/components/chat/workspace/plan/ToolStatusBadge.tsx` — make clickable, calls `openWorkbench({ toolCallId, ... })`.

No edits to backend code, edge functions, RLS, or `toolRegistry`.

## Data sources (read-only)

Reuse existing hooks/queries from `src/lib/orchestration.ts`:
- `tasks` → `output`, `payload`, `status`, `agent_id`, `description`
- `tool_calls` → `tool_name`, `provider`, `input_json`, `output_json`, `status`, `error`, `metadata` (where present)
- `approvals` → status / title / description for Penn drafts
- `activity_feed` → timeline entries for the selected task
- `agents` → slug/name for header

`useWorkbenchData(planId, selection)` selects the matching task + latest tool_call + approval + scoped activity from already-loaded `usePlanDetail`.

## Per-agent rendering

Selection routed by `agent_slug` (fallback to tool provider when no agent):
- **scout** → `ScoutResultsView`. Parses `tool_calls.output_json` for Apify jobs (`items[]` with company/title/location/url) and renders cards + table; raw items collapsed.
- **aria** → `AriaRankingView`. Reads structured `tasks.output.rankings` if present, otherwise renders parsed markdown with Hot/Warm/Maybe/Ignore badges.
- **hawk** → `HawkResearchView`. Renders Firecrawl markdown + extracted signals + source URLs.
- **penn** → `PennDraftView`. Subject + body + LinkedIn note + approval pill. Approve/Reject buttons only when a pending `approval` row exists; calls existing `decideApproval()`.
- **scribe** → `ScribeReportView`. Markdown + copy.
- fallback → `RawJsonView`.

Tool-call selection (no agent context) → render by `provider`: `apify` → ScoutResultsView; `firecrawl` → HawkResearchView; others → RawJsonView.

## OutputActionBar

Buttons prefill the chat composer via existing `ChatComposerPro` (text dispatch) — no new backend calls:
- "Send to Aria for ranking"
- "Enrich top 3"
- "Draft outreach with Penn"
- "Save to leads" (disabled placeholder if signal table absent)

## Empty / error states

- No task selected → empty hero "Pick a step or tool to view its output."
- Task running, no output yet → "Output not available yet. The agent may still be working."
- Tool call failed → red card with `error` text + Retry button hidden for v1 (safe: just show message).
- Old/missing metadata → fallback to RawJsonView or empty message; never crash (wrapped in `ChatErrorBoundary`).

## Realtime

No new channels — `usePlanDetail` already subscribes to plans/tasks/tool_calls/approvals/activity. The Workbench re-renders from the same store. Add a manual "Refresh" button in the header as backup.

## Visual style

Reuse existing Verdant tokens (`bg-background`, `border-white/[0.06]`, emerald accents). Glassmorphic header, badge row, tabs styled like existing plan card. No hardcoded hex.

## Verification

1. "Find 10 engineers in London" → click Apify badge → Workbench shows 10 normalized job/company cards + raw JSON tab.
2. "Find companies hiring marketing roles in London and draft outreach" → Scout, Aria, Penn tabs/views all reachable; Penn shows pending approval pill; no auto-send.
3. "Hawk, scrape https://stripe.com/jobs…" → Firecrawl badge opens Hawk view with markdown + sources.
4. Old conversation with missing `output` → Workbench shows "Output not available yet." with no crash.

## Out of scope

No changes to: ChatWorkspace chat logic, ExecutionPlanCard status semantics, orchestrate/run-agent/pilot-chat edge functions, toolRegistry, approvals backend, Daily Brief, Apify/Firecrawl actor config, RLS policies, secrets.
