## Premium Chat Polish Plan

Scope: visual + UX upgrade of the main chat surface only. No backend, DB, orchestration, or auto-send changes.

### 1. Shared typography + token additions
- `src/index.css`: add chat-scoped tokens — `--chat-body: 15.5px`, `--chat-meta: 13px`, `--chat-name: 15px`, `--chat-plan-title: 17.5px`, plus a `.chat-message-bubble` / `.user-message-bubble` max-width helper and a softer `--chat-glass` background.
- `tailwind.config.ts`: expose `text-chat`, `text-chat-meta`, `text-chat-name`, `rounded-bubble` utilities so components stop using `text-[10px]/[11px]` in non-metadata spots.

### 2. ChatBubble (`src/components/chat/ChatBubble.tsx`)
- Bump body to 15.5px, name to 15px semibold, role label to 13px.
- Apply `max-w-[min(860px,86%)]` for agents and `max-w-[min(720px,70%)]` for user; right-align user with a brighter emerald glass tint and stronger border.
- Increase padding (`px-4 py-3`), `line-height: 1.58`, softer inner highlight ring on hover.
- Keep accent border-left; tune per-agent accents (Pilot emerald, Scout cyan, Aria violet, Hawk amber, Penn lime, Scribe rose) via `agentResolver` accents (no logic change, just palette tuning).

### 3. AgentBubble (`src/components/chat/workspace/bubbles/AgentBubble.tsx`)
- Same type scale upgrades; agent name 15px, dept label 12.5px (still metadata).
- Replace harsh `bg-card/80` with softer glass (`bg-white/[0.03] backdrop-blur-xl`) and subtle inner highlight.
- Thinking/working copy switches to agent-owned phrasing ("Scout is sourcing…", "Aria is ranking…", "Hawk is researching…", "Penn is drafting…", "Scribe is writing…") based on `profile.id`.
- Compact meta row (tokens/time) shrinks to true metadata size (11.5px) — only place tiny text is allowed.

### 4. Handoff divider
- Update `AgentHandoffDivider` (or create if missing under `src/components/chat/workspace/`): centered pill `Pilot → Scout` with mini avatars, 12.5px label, thin gradient hairlines left/right, only rendered when consecutive speaker changes.
- Wire into `ChatView` message map (no state changes — derived from existing message list).

### 5. ExecutionPlanCard + ExecutionTaskRow
- Title 17.5px, instruction 15px, step title 15.5px, agent label 13px.
- Status pill larger and higher contrast; agent sequence chips use bigger avatars (20px) + name.
- Step row: agent owner column on the left, action text 15px, tool chips 12.5px, less vertical dead space, alternating row tint.
- Failure copy mapping: when a task fails with `no_results` / `provider_missing` / `no_qualified`, render the specific Scout messages spec'd in section 8 + compact action pills (Broaden / Try another source / Edit criteria / View details / Done). Pills dispatch existing actions only.

### 6. Recent Activity / ActivityMiniFeed
- Filter out provider strings (`lovable-ai:*`, `google/gemini-*`, raw `started`/`finished` without context) behind a `devRaw` flag (default off).
- Render as timeline rows: agent avatar + verb phrase ("Scout ran Apify Jobs", "Aria skipped — no accepted contacts"), 14px text, subtle timestamp right-aligned.
- Keep data source unchanged; transformation is presentational in the component.

### 7. Composer (`InlineCommandBar` / `ChatComposerPro`)
- Input 16px, placeholder 15.5px with rotating hints ("Message your AI workforce…", "Ask Pilot or mention @Scout…", "Run a workflow or ask for company work…").
- Slightly taller (min-h 56px), more horizontal padding, icon size 18px, premium focus ring (emerald glow).
- Visual-only `@Scout/@Aria/@Hawk/@Penn/@Scribe` hint chips above input on focus when empty; no autocomplete logic.

### 8. Empty / waiting state
- Pilot greeting compact; 4 suggestion pills: Find hiring-signal accounts · Research these companies · Draft outreach · Create LinkedIn post.
- Reduce vertical blank space; center block max-width 640px.

### 9. Scroll + split behavior
- `ChatView`: keep existing auto-scroll, but suppress when user scrolled up >120px; show a small "New activity ↓" pill bottom-right.
- Verify 40/60 and 50/50 with Workbench open — adjust bubble max-widths via container queries (`@container`) so they reflow.

### 10. QA (Playwright via shell)
Run scenarios A–E from the brief at 1280px and 1440px, capture screenshots of: empty state, lead source selector, hiring-signal plan, decision-maker failure, failed sourcing, long composer input, and split mode with Workbench open. Verify no clipping, readable type, no horizontal overflow.

### Files expected to change
- `src/index.css`, `tailwind.config.ts`
- `src/components/chat/ChatBubble.tsx`
- `src/components/chat/workspace/ChatView.tsx`
- `src/components/chat/workspace/bubbles/AgentBubble.tsx`
- `src/components/chat/workspace/bubbles/SafetyChip.tsx` (spacing only)
- `src/components/chat/workspace/agents/AgentHandoffDivider.tsx` (new or updated)
- `src/components/chat/workspace/plan/ExecutionPlanCard.tsx`
- `src/components/chat/workspace/plan/ExecutionTaskRow.tsx`
- `src/components/chat/workspace/plan/ActivityMiniFeed.tsx`
- `src/components/workforce/InlineCommandBar.tsx` (composer)
- Lead source / intake cards under `src/components/chat/workspace/` (typography + spacing only)

### Out of scope (explicit)
- Landing page
- DB / migrations / RLS
- Workflow registry, Workbench logic, agent orchestration, agent ownership routing
- Any auto-send / auto-DM / outreach behavior — outreach stays draft + approval gated
