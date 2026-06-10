## Goal

Tighten the existing chat + Workbench into a command-center experience: clearer message structure, an interactive clarification card, a richer Execution Plan card, and a domain-aware Workbench with action affordances and friendlier empty/failure states. UI/UX only — no backend, schema, edge function, registry, or secret changes.

## Files to change

Chat thread:
- `src/components/chat/workspace/ChatView.tsx` — render structured "Pilot Interpretation" pill row from `metadata.tool_input.business_goal`, render the new `ClarificationCard` when `metadata.clarification === true && pending_clarification`, render the new `WorkflowStatusRail` block under in-flight plans.
- `src/components/chat/workspace/bubbles/UserBubble.tsx` — small "Request" label + emerald rail to match the new sectioning.
- `src/components/chat/workspace/bubbles/ClarificationCard.tsx` (new) — "Pilot needs one decision" card with up to 3 option chips: Individual profiles / Companies hiring / Agencies. Each chip dispatches a normal chat message via `sendUserMessage` from `pilotChat.ts` ("individual profiles" / "companies hiring" / "agencies"), so the existing backend resolver picks the matching stored action. Only render chips that have a corresponding `people_action` / `companies_action` / `agency_action` in metadata.
- `src/components/chat/workspace/bubbles/InterpretationPill.tsx` (new) — small "Pilot interpreted as" badge row showing `intent`, `selected_actor_key`, `execution_mode`, and `business_goal` when present in `metadata.tool_input`. Pure presentational, reads existing metadata.
- `src/components/chat/workspace/bubbles/NextActionRow.tsx` (new) — single-line "Recommended next" hint under completed/awaiting plans, derived from plan/task status (e.g. "Open Workbench to review results", "Approve Penn's drafts to send"). UI-only.

Execution Plan Card:
- `src/components/chat/workspace/plan/ExecutionPlanCard.tsx` — surface execution mode and approval badge in the header; add a normalized live-status pill (`planning` | `running` | `awaiting approval` | `complete` | `partial` | `failed`) derived from `plan.status` + per-task statuses; show selected actor label, tool name, and aggregated result count (sum of `output_json.total` across tool calls); keep existing task rows and connector limitations.
- `src/components/chat/workspace/plan/PlanStatusPill.tsx` (new) — small pill component used by both the card and the rail.

Workbench:
- `src/components/chat/workspace/workbench/WorkbenchHeader.tsx` — already shows task title, agent, provider, status, run id, updated; add Actor label (from `output_json.actor_label` / `selected_actor_key`) and an Output Type pill (people_profiles / jobs / website_content / drafts), plus an "Approval required" badge for Penn tasks.
- `src/components/chat/workspace/workbench/WorkbenchPanel.tsx` — replace fixed 4-tab set with a derived tab list. Candidate tabs: Summary, Results, Rankings, Drafts, Sources, Raw. Each tab only renders if the underlying data is present (e.g. Rankings only if `output_json.rankings`/`output_json.ranked` exists; Drafts only for Penn outputs; Sources only if Firecrawl `output_json.sources`/URLs exist; Results only if Apify items/people exist).
- `src/components/chat/workspace/workbench/ScoutResultsView.tsx` — add a per-row action row: "Save Lead", "Enrich", "Draft Outreach". Each button uses the existing chat send path (`useChatWorkspace` + `pilotChat.sendUserMessage`) to fire a templated follow-up message ("Draft outreach for {full_name} at {company}", "Enrich {company} ({url})", "Save {company} as a lead"). No backend changes — relies on existing Pilot orchestration. Hide actions when no useful context is available.
- `src/components/chat/workspace/workbench/HawkResearchView.tsx` — render page summary, extracted facts as bullet list, list of source URLs, and stash raw markdown under a collapsed Raw tab body block.
- `src/components/chat/workspace/workbench/PennDraftView.tsx` — show subject / body / personalization notes more prominently, approval-status chip; keep existing Approve / Edit / Reject controls if `approval` is present.
- `src/components/chat/workspace/workbench/FailureRecoveryCard.tsx` — make this the primary failure surface: "What failed / Why it likely failed / What you can do" with Retry, Check integration, Ask Pilot for alternative buttons. Raw error code stays in Raw tab only.
- `src/components/chat/workspace/workbench/NoResultsCard.tsx` (new) — shown in Results tab when normalized list is empty and no failure. Suggests: Broaden role, Broaden location, Try related titles, Switch to companies hiring (or to people if currently companies). Each suggestion sends a templated chat message to Pilot.

No new pages. No routes added. Existing context (`ChatWorkspaceContext`, `useChatConversation`, `usePlanDetail`, `useWorkbenchData`) is reused unchanged.

## Behavior details

Clarification card:
- Triggered when an assistant message has `metadata.clarification === true` and one of `people_action`, `companies_action`, `agency_action` is present.
- Header: "Pilot needs one decision" with subtitle = the assistant `content` (the clarification question itself).
- Chips: each chip shows label + a one-line preview ("apify_people_search · London · 10 results"). Disabled chips for `agency_action` when `tool_name` is null, with a tooltip "Dedicated agency sourcing isn't configured — Pilot will offer a workaround".
- Click sends the matching natural-language reply through the existing composer pipeline; the existing backend reply resolver runs the stored action.

Workflow status rail:
- Replaces the small "Agents are working" footer in `ConversationView` with a richer rail: current task title, current agent avatar, ticking timer, "Open Workbench" CTA. Reuses `usePlanDetail`. UI-only.

Action buttons in Workbench results:
- All "Save Lead / Enrich / Draft Outreach" buttons emit a chat message via existing `pilotChat.sendUserMessage` — they don't call new endpoints. A short inline confirmation ("Sent to Pilot") appears for 2s after click.

## Visual style

- Keep pitch-black + emerald accent + glassmorphic rounded-xl cards.
- Reuse existing semantic tokens, no new color hex.
- Status pills reuse the tone map already in `ExecutionPlanCard`.
- Tabs reuse the existing underline-active pattern in `WorkbenchPanel`.

## Out of scope

- Backend, schema, edge functions, registry, secrets.
- New pages or new routes.
- New persistence (Save Lead / Enrich / Draft Outreach are chat-driven, not DB writes).
- Redesign of dashboard, sidebar, or other surfaces.

## Verification (build mode)

- Send "We're having issues with development. Maybe we need to hire senior remote engineers." → ChatView shows the new ClarificationCard with two chips (Individual profiles, Agencies). Clicking "Individual profiles" sends "individual profiles" and the next assistant message renders the upgraded ExecutionPlanCard with execution_mode + actor label.
- Open Workbench on a Scout people result → Header shows Actor + Output Type + Approval n/a; Results tab shows per-person action row; tabs Drafts/Sources/Rankings are hidden because no data.
- Force a failure (call a disabled actor) → Results tab shows FailureRecoveryCard with Retry / Check integration / Ask Pilot; Raw tab still shows the error code.
- Apify Jobs with empty results → NoResultsCard with 4 templated chat suggestions; clicking one routes through the composer to Pilot.

## Limitations

- "Save Lead" / "Enrich" / "Draft Outreach" route through the chat (Pilot decides). No DB-side "leads" table writes are added in this pass.
- Agency option remains visual-only because backend has no dedicated agency actor yet — the backend's existing fallback message handles the click.
