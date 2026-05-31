# Execution Plan Cards

Render a compact Execution Plan card inline under the assistant announce message in `ChatView` whenever pilot-chat returned a delegation. Reuse existing plan loading (`usePlanDetail`) and realtime (`subscribePlan`) — extend only for `tool_calls`. Tie messages to plans via a new `messages.metadata` JSONB column populated by `pilot-chat`. No app redesign, no removal of existing modules.

## Files changed

### Backend
1. **Migration** — add `messages.metadata jsonb not null default '{}'::jsonb`. No RLS change (existing policies cover it).
2. **EDIT** `supabase/functions/pilot-chat/index.ts` — on the delegation branch, persist `metadata: { type: "execution_plan", plan_id, plan_title, task_count, agents, connector_limitations }` with the assistant announce message. Return it in the response too.

### Frontend
3. **EDIT** `src/lib/orchestration.ts` — add `DBToolCall` type, `fetchToolCallsForPlan(planId)`, and extend `subscribePlan` to also watch `tool_calls` rows where `plan_id = eq.<planId>` (callback registered before `.subscribe()`, existing cleanup preserved).
4. **EDIT** `src/hooks/usePlanDetail.ts` — also fetch + expose `toolCalls`. (Single hook reused by both the existing ConversationView and the new card; realtime already debounces via re-fetch on every change.)
5. **EDIT** `src/lib/pilotChat.ts` — extend `ChatMessageRow` with optional `metadata: Record<string, unknown> | null`; extend `PilotChatResult` plan variant with `plan_title?`, `agents?`, `connector_limitations?`.
6. **EDIT** `src/hooks/useChatConversation.ts` — include `metadata` in the message select and the realtime payload mapping (read-only; existing subscription pattern preserved).
7. **NEW** `src/components/chat/workspace/plan/ExecutionPlanCard.tsx` — top-level card. Reads `usePlanDetail(planId)`. Shows header, task list, activity mini-feed, connector limitations. Mobile-stacked.
8. **NEW** `src/components/chat/workspace/plan/ExecutionTaskRow.tsx` — one row per task: step #, agent badge, title, status, description, expected_output (from `task.payload.expected_output`), success_criteria (from `task.payload.success_criteria`), tool_needed badge, approval badge, latest tool_call status, output preview, error.
9. **NEW** `src/components/chat/workspace/plan/AgentBadge.tsx` — slug → name, color, initial circle. Reuses `AGENT_BY_ID` + `AGENT_HEX` already in `ChatView`.
10. **NEW** `src/components/chat/workspace/plan/ToolStatusBadge.tsx` — given `tool_needed` + latest `tool_call`, render: configured/missing for `research_web|scrape_url|send_email|summarize_text|extract_structured`; live status (queued/running/succeeded/failed/unavailable/awaiting approval); provider; short error; citations count from `output_json.citations`.
11. **NEW** `src/components/chat/workspace/plan/ApprovalBadge.tsx` — read-only pending/approved/rejected pill. v1: no Approve/Reject actions wired; clicking "Review" calls `setView({kind:'conversation', planId})` to open the existing `ConversationView` where `ApprovalCard` already handles approve/reject.
12. **NEW** `src/components/chat/workspace/plan/ActivityMiniFeed.tsx` — latest 3–5 plan activity events (`plan_created`, `task_started`, `task_completed`, `tool_used`, `tool_failed`, `approval_created`, `ai_provider_call`).
13. **EDIT** `src/components/chat/workspace/ChatView.tsx` — after the existing assistant bubble, if `m.metadata?.type === "execution_plan"` and `metadata.plan_id`, render `<ExecutionPlanCard planId={...} compact />`.

## Tool-needed source of truth

`tasks.payload` is a JSONB written by orchestrate with fields like `tool_needed`, `expected_output`, `success_criteria`, `requires_approval`. The card reads them defensively (`task.payload?.tool_needed`, etc.) — no schema change. Connector configuration availability is exposed via `connector_limitations` returned by `pilot-chat` (already populated from orchestrate). The frontend treats this as the source of truth (no client-side env check).

## Tool calls join

`fetchToolCallsForPlan(planId)` selects `tool_calls where plan_id = ? order by created_at asc`. The card groups them by `task_id`. Each task row picks the latest by `created_at` to render `ToolStatusBadge`.

## Realtime safety

`subscribePlan` already follows the rules: single channel, all `.on('postgres_changes', ...)` calls before `.subscribe()`, cleanup via `supabase.removeChannel`. The edit adds one more `.on(...)` for `tool_calls` in the same chained call (still before `subscribe`). No new channels are opened by `ExecutionPlanCard`; it just consumes `usePlanDetail`. StrictMode double-mount safety is already handled by the existing `uniqueTopic()` helper.

If a card is missing `planId`, it renders nothing (no channel, no fetch).

## Approval actions

Read-only in v1: badges show pending/approved/rejected; an inline "Review" button opens the existing plan ConversationView (which already wires `ApprovalCard`). Documented as TODO for inline approve in v2 — keeps `approve-and-continue` flow untouched.

## Visual

- Dark Deep Space card: `rounded-xl border border-white/[0.06] bg-white/[0.03]` to match existing structured bubble.
- Agent dot/name with existing `AGENT_HEX` palette (Scout blue, Aria purple, Penn emerald, Hawk teal, Scribe violet).
- Mobile: task rows stack vertically, badges wrap.
- Failed/unavailable: amber/red icon + short text, not modal/scary.

## Verification (manual in preview)

1. "Find 10 React engineers in London" → assistant bubble + Execution Plan card with Scout/Aria/Scribe/Penn rows, `research_web` flagged "Perplexity required" (no Perplexity key in env).
2. "Draft outreach…" → Penn row shows "Approval required" badge.
3. Send `approve-and-continue` from existing flow → realtime updates card statuses live.
4. Empty plan_id (pure reply) → no card rendered.
5. Mobile viewport → card stacks, no horizontal scroll.

## Final report (after build)

- Files changed list
- Migration applied (`messages.metadata`)
- pilot-chat metadata payload sample
- Realtime channel topology (one channel per visible plan, already-existing pattern)
- Components added
- Approval action status (read-only v1, opens ConversationView for action)
- Test results from the 5 scenarios
