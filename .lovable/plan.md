## Goal
Upgrade the orchestrator task screen (center conversation + right Workbench) into a premium, Slack-style command center. UI/UX only — no backend, edge functions, registries, or schema changes.

## Scope
- `src/components/chat/workspace/ConversationView.tsx`
- `src/components/chat/workspace/bubbles/` (`UserBubble`, `SystemMessage`, `AgentBubble`, `HandoffRow`)
- `src/lib/chatMessageStream.ts` (add semantic section markers — no data fetch changes)
- `src/components/chat/workspace/workbench/` (`WorkbenchPanel`, `WorkbenchHeader`, `AgentOutputViewer`, `OutputActionBar`, new `FailureRecoveryCard`, new `SummaryView`)

No edits to: `useWorkbenchData`, `usePlanDetail`, `toolRegistry`, `actorRegistry`, supabase functions, normalize logic.

---

## 1. Conversation Thread — structured workflow timeline

Add section grouping to `buildPlanMessages` so messages carry a `section` tag: `request | interpretation | clarification | workflow | execution | status | next_step`. `ConversationView` groups consecutive messages of the same section under a small left-rail label + thin vertical accent line (emerald for active, muted otherwise).

New visual primitives:
- `SectionDivider` — uppercase label ("Workflow created", "Execution", "Recommended next step") with a hairline rule and timestamp.
- `WorkflowSummaryCard` (system variant) — when plan is created, render a compact card showing step count, agents involved (badges), and ETA tone, replacing the plain "Plan created · N steps" line.
- `StatusPulseRow` — shows current step name + animated emerald dot while running.
- `NextStepHint` — at thread tail, shows Pilot's recommended next action with one inline button that prefills the composer.

Spacing: tighten vertical rhythm (space-y-3 → grouped sections with internal space-y-2, between-section space-y-5), add max-w-3xl content column centered to kill empty black space, soft inner gradient on the scroll container.

## 2. Workbench Header upgrade

Rework `WorkbenchHeader` to show a richer meta row:
`Task title` (h2) → badges row: `AgentBadge · ToolBadge · WorkflowTypeBadge · StatusBadge · updatedAt`.
- Workflow type derived from `toolCall.tool_name` / `output.actor_output_type` (people_search, jobs_search, scrape, draft, rank) — pure presentational mapping.
- Status badge color-coded (existing tone map extended for `failed` to use the recovery palette).
- Show secondary line: "Last updated 4:26 PM · Run abc12345".

## 3. Workbench Tabs

Replace current 1–3 tab logic with a fixed 4-tab set: `Summary | Results | Activity | Raw`.
- `Summary` (new `SummaryView`) — plain-English narration built from task/toolCall fields (what was requested, what ran, outcome, counts, next suggested action). No backend calls; pure derivation.
- `Results` — existing `AgentOutputViewer` (success path only; failure routed to recovery card — see §4).
- `Activity` — existing list, restyled with timeline dots.
- `Raw` — existing `RawJsonView` forced open, plus raw error code chip when failed.

Default tab: `Summary` on success, `Summary` on failure (with prominent recovery card embedded), `Results` if user explicitly opened from a results step.

## 4. Failure state — designed recovery card

New `FailureRecoveryCard` shown in Summary tab when `toolCall.status === 'failed'` or `'unavailable'`:
- Friendly title mapped from error code (e.g. `apify_unauthorized` → "Apify connection needs attention").
- Body explanation.
- Metadata grid: Tool, Step, Error type.
- Recovery actions (buttons emit `chat:prefill` events, matching existing `OutputActionBar` pattern — no new wiring):
  - Retry run → `@Pilot retry the last step`
  - Reconnect Apify → opens `/settings/integrations` route if present, else prefill
  - Switch sourcing method → `@Pilot use an alternative sourcing method`
  - Ask Pilot for alternative → `@Pilot suggest an alternative approach`
- Raw code (`apify_unauthorized`) shown as small mono chip; full payload remains in Raw tab.

Error-code → friendly-copy map kept in a small local `errorCopy.ts` lookup (presentation only).

## 5. State-aware `OutputActionBar`

Extend existing component to branch on `toolCall.status`:
- Failed/unavailable: Retry · Reconnect tool · Ask Pilot alternative.
- Succeeded: existing actions + new "Export results" (prefill `@Scribe export these results as CSV`).
- Pending/running: hide bar (replace with subtle "Working…" shimmer line).

All actions continue to use the `chat:prefill` event — no orchestration code touched.

## 6. Visual hierarchy polish

- Center column: `max-w-3xl mx-auto`, subtle radial emerald glow at top, faint grid background continues edge-to-edge behind the column.
- Workbench: card-in-card layout with `rounded-xl` inner panels, hairline emerald top-border on the active tab, sticky header with backdrop blur on scroll.
- Consistent type scale: 11/12/13/14 already in use — keep; add `text-[10px] uppercase tracking-widest` rail for section labels.
- Keep tokens semantic (`text-foreground`, `bg-background`, emerald accents per Verdant theme memory) — no hardcoded greys beyond the existing GitHub-dark palette already used in this surface.

---

## Technical notes

New files:
- `src/components/chat/workspace/bubbles/SectionDivider.tsx`
- `src/components/chat/workspace/bubbles/WorkflowSummaryCard.tsx`
- `src/components/chat/workspace/bubbles/NextStepHint.tsx`
- `src/components/chat/workspace/workbench/SummaryView.tsx`
- `src/components/chat/workspace/workbench/FailureRecoveryCard.tsx`
- `src/components/chat/workspace/workbench/errorCopy.ts`

Edited files:
- `ConversationView.tsx` — grouping + max-width column + section dividers
- `chatMessageStream.ts` — attach `section` field to ChatMessage union (additive, optional)
- `AgentBubble.tsx`, `SystemMessage.tsx` — lighter chrome, denser spacing
- `WorkbenchHeader.tsx` — richer meta row, workflow-type badge
- `WorkbenchPanel.tsx` — 4-tab fixed layout, default-tab logic
- `AgentOutputViewer.tsx` — delegate failure to `FailureRecoveryCard` in Summary path
- `OutputActionBar.tsx` — state-aware action set

No edits to data hooks, orchestration lib, registries, edge functions, or DB.

## Limitations
- Recovery buttons trigger via composer prefill (existing pattern); no new retry RPC.
- "Reconnect Apify" deep-link only navigates if a settings route exists; otherwise falls back to prefill.
- Workflow-type badge is derived heuristically from tool name / output shape.
- Summary copy is template-based (not AI-generated) to keep this UI-only.

## Deliverables on completion
Files changed list, components changed list, conversation UI diff summary, workbench UI diff summary, error-state UX summary, and noted limitations.