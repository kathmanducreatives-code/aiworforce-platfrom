
## AI Workforce Chat — Frontend Build Plan

A Slack × Claude × command-center chat experience that opens from the existing bottom command bar as a spring-animated drawer, expandable to full screen. Pure frontend; wires to the existing `orchestrate` edge function, `run-agent` is invoked only via the orchestrator (single-agent plans for direct mentions, since `run-agent` itself only accepts `task_id`), and `activity_feed` / `task_plans` / `tasks` / `approvals` realtime tables.

────────────────────────────────────────
### Architecture

```text
MainLayout
 └─ <ChatWorkspaceProvider>           ← context: open/closed, mode (drawer|full),
     │                                  height, activeView, activeConversationId
     ├─ GlobalChatBar (existing, refactored)
     │     • Click anywhere on bar → open drawer
     │     • Composer remains the input (re-used inside drawer)
     └─ <ChatWorkspace />              ← new: drawer + full-screen container
           ├─ DragHandle  (resize / dblclick → fullscreen / Esc → collapse)
           ├─ ConversationsSidebar     (220 / 260px)
           │     • Filter chips: All | Active | Done
           │     • Conversation list (task_plans)
           │     • CHANNELS section (4 dept rooms)
           │     • YOUR TEAM agent dock (5 avatars w/ pulse)
           └─ ThreadPane                ← switches by activeView
                 ├─ ConversationView    (single plan)
                 ├─ ChannelView         (dept-filtered activity feed)
                 ├─ DirectAgentView     (per-agent history)
                 └─ EmptyState
                 └─ Composer (sticky bottom inside drawer)
```

`ChatWorkspaceProvider` is mounted in `MainLayout` so the drawer state is global. `GlobalChatBar` becomes a thin wrapper that, when collapsed, shows just the composer + a clickable surface that opens the drawer; when expanded, the composer is rendered inside `ChatWorkspace` instead.

────────────────────────────────────────
### New files

```
src/contexts/ChatWorkspaceContext.tsx     – open/mode/view/height + helpers
src/components/chat/workspace/
  ChatWorkspace.tsx                       – drawer + fullscreen shell, drag handle
  ConversationsSidebar.tsx
  ConversationListItem.tsx
  ChannelList.tsx
  TeamDock.tsx                            – 5 avatars, running pulse
  ThreadPane.tsx                          – router for the 3 views
  ConversationView.tsx                    – plan-scoped thread
  ChannelView.tsx                         – dept-scoped activity feed
  DirectAgentView.tsx                     – per-agent history
  EmptyState.tsx
  ChatComposerPro.tsx                     – upgraded composer: @ # / pickers, glow
  MentionPill.tsx
  bubbles/
    UserBubble.tsx
    AgentBubble.tsx                       – wraps the 4 states
    ThinkingBubble.tsx
    WorkingBubble.tsx                     – animated progress in agent color
    HandoffRow.tsx                        – particle-trail handoff animation
    DoneBubble.tsx                        – wraps OutputRenderer + footer (tokens/time/feedback)
    ApprovalCard.tsx                      – amber card with Approve/Reject
    SystemMessage.tsx
  output/
    OutputRenderer.tsx                    – auto-detects shape from JSON
    CandidateListCard.tsx
    EmailListCard.tsx
    SignalListCard.tsx
    IntelReportCard.tsx
    ContentBlock.tsx                      – text + Copy
  effects/
    AmbientShimmer.tsx                    – running-agent gradient drift
    ParticleTrail.tsx                     – handoff dots along arc
src/hooks/
  useChatWorkspace.ts                     – context hook
  usePlanThread.ts                        – plan + tasks + activity + approvals → unified message stream
  useChannelThread.ts                     – activity_feed filtered by department
  useDirectAgentThread.ts                 – task_plans where target_agent_slug = agent
  useRelativeTime.ts
src/lib/
  chatMessageStream.ts                    – pure fn: merges tasks/activity/approvals
                                            into ordered ChatMessage[] (user/system/agent/handoff/approval)
  outputShape.ts                          – detect candidate/email/signal/intel/content/json
  agentDeptIndex.ts                       – maps agent_id → dept (built from useAgents)
  chatSounds.ts                           – optional WebAudio chimes (default off)
```

### Edited files

- `src/components/MainLayout.tsx` — wrap children in `<ChatWorkspaceProvider>`, mount `<ChatWorkspace />` once.
- `src/components/chat/GlobalChatBar.tsx` — strip the inline expanded panel; clicking the bar / focusing composer calls `openWorkspace()`. The legacy `expanded` panel and `historyOpen` are removed; the composer behaves identically when the workspace is closed.
- `src/components/chat/ChatComposer.tsx` — keep as the legacy composer; new `ChatComposerPro` lives next to it and is what the workspace uses (so we don't break other consumers like Department rooms).

────────────────────────────────────────
### Behaviour details

#### Drawer / fullscreen shell
- `framer-motion` `<motion.div>` with `animate={{ height }}` and a spring `{ stiffness: 260, damping: 30 }`.
- States: `closed` (composer-only bar visible), `drawer` (default 70vh, resizable 30–95vh), `fullscreen` (covers viewport, sidebar widens to 260px).
- Drag handle: `onPointerDown` captures pointer, `onPointerMove` updates a `height` state (clamped). Double-click → fullscreen. Escape (when focused inside workspace) → collapse to closed.
- Background: `bg-background/85 backdrop-blur-2xl` with `border-t border-primary/30 shadow-[0_-1px_0_0_hsl(var(--primary)/0.4),0_-30px_80px_-20px_hsl(var(--primary)/0.15)]` — semantic tokens only (verdant theme).
- Keyboard: `Cmd/Ctrl+K` toggles drawer; `Cmd+ArrowUp`/`Cmd+ArrowDown` toggle fullscreen.

#### Conversations sidebar
- Filter chips drive a memoized filter over `useAllPlans`:
  - `All`: every plan
  - `Active`: `status in ('planning','executing','awaiting_approval')`
  - `Done`: `status in ('complete','failed')`
- Conversation item: dot color = primary agent's department color (resolved via first task's `agent_id` → `useAgents`); first line of `user_instruction` (truncated 1 line); relative time from `created_at`; small pulsing green dot when status is active.
- CHANNELS: hardcoded 4 (talent / growth / intelligence / content), clicking sets `activeView = { kind: 'channel', dept }`.
- TEAM dock: 5 avatars from `AGENT_PROFILES`, overlay green pulse if a matching `agents` row has `status === 'running'`. Click → `activeView = { kind: 'agent', slug }`.

#### Thread message stream (`chatMessageStream.ts`)
Pure builder that takes `(plan, tasks, activity, approvals)` and yields ordered `ChatMessage`s:
1. `user` — from `plan.user_instruction` at `plan.created_at`.
2. `system` — `plan_created` event ("── Plan created: N steps ──").
3. For each task in `step_index` order:
   - if task.status `running` and no `done` event yet → `agent.thinking` or `agent.working` (working when latest activity for this task is `agent_started`).
   - if a `handoff` event references `from_agent_id → to_agent_id` between two tasks → insert `handoff` row.
   - if `awaiting_approval` event → `approval` card (resolved from `approvals` row by `task_id`).
   - if task.status `complete` → `agent.done` with `task.output` rendered by `OutputRenderer`.
4. `system` — `plan_complete` final marker.

Result is consumed by `ConversationView` and rendered with virtualization-friendly map (no list virtualization needed at this scale; cap last 200 rows).

#### Bubbles
- All colors derive from `AGENT_PROFILES[agent].department` via `deptText/deptDot/deptRing` (existing). No hardcoded hex.
- `WorkingBubble`: thin progress bar = `motion` width animating `0 → 90%` over 12s with `easeOut`, jumps to 100% on completion event. The model badge uses existing `ModelBadge` component if present, otherwise `modelBadge` map from `dockAgents.ts`.
- `HandoffRow`: two avatars + animated SVG arc, with `<ParticleTrail/>` (4 dots over 0.8s, then unmounts).
- `DoneBubble` footer: token count from `task.output.usage?.total_tokens` if present; elapsed = `finished_at - started_at`; thumbs up/down (local-only, no backend); "Use this" copies output JSON to clipboard or, for content output, copies the text.

#### Output renderer detection (`outputShape.ts`)
```ts
detect(output): 'candidates' | 'emails' | 'signals' | 'intel' | 'content' | 'raw'
```
- `candidates`: array of objects with `name` & (`title`|`role`) & optional `score`.
- `emails`: array with `subject` and (`body`|`html`).
- `signals`: array with `severity` and (`title`|`message`).
- `intel`: object with `summary` or `sections`.
- `content`: string OR object with single `text`/`markdown` field.
- Fallback: pretty-printed JSON in a collapsible block.

Each card uses semantic tokens (`bg-card`, `border-border`, `text-foreground`, `text-muted-foreground`, agent dept ring for accents).

#### Approval cards
Render in-thread when `event_type = 'awaiting_approval'`. Approve/Reject call existing `decideApproval(approvalId, action)`. After resolution, the same card morphs to a resolved state ("Approved at 14:02 — Penn resumed") via `framer-motion` layout animation; the rest of the thread continues to grow as the orchestrator emits more events.

#### Composer (`ChatComposerPro`)
- Same auto-resize textarea, but with three popover triggers:
  - `@` → agent picker (current 5, with status from `useAgents`, dept dot, one-line role).
  - `#` → channel picker (4 depts). Selecting a channel sets the workspace's "default channel" so subsequent sends without `@` go to the orchestrator restricted to that dept (we pass through as part of the `user_instruction` prefix only — no backend change; the orchestrator already supports `target_agent_slug` for direct mentions).
  - `/` → command menu: `/plan` (jumps to current active plan view), `/agents` (opens agent dock view), `/history` (filter sidebar to Done), `/brain` (navigates to existing Company Brain route via `useNavigate`), `/clear` (resets to empty state — does not delete data).
- Suggested prompts: 3 chips when input is empty + focused, rotated by hour-of-day and presence of pending approvals (pure client logic).
- Send routing:
  - First `@AgentName` matches a known agent → `submitInstruction(workspace, text, { agentSlug: agent.id })`. The orchestrator already produces a single-agent plan when a target slug is provided.
  - Otherwise → `submitInstruction(workspace, text)`.
  - In a Channel view with no `@`, prepend a hint to `user_instruction` (e.g. `"[#talent] " + text`) so the orchestrator biases toward that dept's agents. (No edge function changes.)
- Input border: focus state uses `focus-within:border-primary/70 focus-within:shadow-[0_0_0_4px_hsl(var(--primary)/0.12)]` (already present, enhanced).

#### Channel view
- Header: `# {dept}`, description, dept agent avatars, and a status line computed from `useAgents` (e.g. "2 agents idle · Scout is running").
- Pinned `ACTIVE PLAN` card if any plan in `planning|executing|awaiting_approval` involves a dept agent — clickable, opens that conversation.
- Body: `useChannelThread(dept)` returns `activity_feed` events where `agent_id ∈ deptAgentIds`, oldest 50 first, paginates on scroll-up via `before_created_at` cursor.
- Each event renders as a compact agent message ("Scout · 14:02 — Sourced 18 leads in ICP"). Clicking opens the source plan in `ConversationView`.
- Composer in channel: `restrictDepartment={dept}` so the @ picker only shows that dept's agents.

#### Direct agent view
- Header: large dept-colored avatar, name, dept, model badge, status dot, skills chips (placeholder list from agent profile / `agent_capabilities` if rows exist for that agent), "View profile" link to existing agent panel route.
- Body: `useDirectAgentThread(agentId)` returns the union of `task_plans` whose first task has this `agent_id` (1 round-trip query per session, then realtime). Each plan rendered as a collapsible thread group.
- Empty state: 3 example task chips per agent (static per-agent presets in `src/data/agentTaskPresets.ts`).
- Composer: `@AgentName` is auto-prefixed and locked.

#### Visual & UX details
- `AmbientShimmer`: an absolutely-positioned `motion.div` inside any bubble whose source agent is currently running; uses `bg-gradient-to-r from-transparent via-{deptRgba}/15 to-transparent` with `animate={{ x: ['-100%', '100%'] }}` over 6s loop. Auto-unmounts on completion.
- `ParticleTrail`: SVG with 4 `<motion.circle>` traveling along a pre-computed quadratic Bézier between two avatar refs, staggered 80ms.
- Timestamps: `useRelativeTime(date)` re-renders every 30s; full timestamp in a Radix `Tooltip`.
- Unread floater: `IntersectionObserver` on the bottom sentinel; when off-screen and new messages arrive, show a `motion.button` "N new messages ↓".
- Empty state: SVG arc of 5 agent images, headline + subtext + 4 dept cards (Aria/Scout · Penn · Hawk · Scribe) each calling the composer with a preset string.
- Loading: Tailwind `animate-pulse` skeletons in sidebar (8 rows) and thread (4 bubble skeletons), plus a 4s slow wave variant via `animation-delay`.

#### Sounds (optional)
- `chatSounds.ts` lazily loads three short oscillator-generated tones via WebAudio (no asset files). A small speaker toggle lives at the right of the composer; persisted in `localStorage('chat.sounds')`. Default `false`.

────────────────────────────────────────
### Backend wiring (read-only — no edge function or DB changes)

| Action | Existing API used |
|---|---|
| Send (no @) | `submitInstruction(workspaceId, text)` |
| Send (@Agent) | `submitInstruction(workspaceId, text, { agentSlug })` |
| Approve / Reject | `decideApproval(id, action)` |
| Conversations list | `useAllPlans(workspaceId)` |
| Plan thread | `usePlanDetail(planId)` (existing) → fed into `chatMessageStream` |
| Channel feed | new `useChannelThread`: `fetchActivityFeed` + `subscribeActivityFeed`, filtered by dept agent ids |
| Direct agent | new `useDirectAgentThread`: query `task_plans` joined to first task's `agent_id` |
| Live updates | existing realtime subscribers in `lib/orchestration.ts` |

`run-agent` is **not** called from the client (it only accepts `task_id`); direct @mentions go through `orchestrate` with `target_agent_slug`, which already returns a single-agent plan.

────────────────────────────────────────
### Theme & a11y

- Strict semantic tokens: `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `text-primary`, `bg-primary`, plus the per-dept Tailwind classes already defined in `agentProfiles.ts` / `dockAgents.ts`.
- All animations respect `prefers-reduced-motion` (skip shimmer + particle trail).
- Drawer is a `role="dialog"` with `aria-modal="false"` (non-blocking), focus-trapped only in fullscreen mode.
- Mobile (`useIsMobile`): drawer becomes a full-screen sheet, sidebar collapses into a top tab switcher (Conversations / Channels / Team), no drag handle, swipe-down to close.

────────────────────────────────────────
### Out of scope (explicitly)

- No edge function code, no DB migrations, no RLS changes.
- No persistence of thumbs-up/down (UI-only).
- No new tables for "channels" — channels are a pure client view over `activity_feed`.
- The existing Department room pages, dock, and agent builder modal are untouched.
