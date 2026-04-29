# ScreeningPilot Premium Visual Redesign

A pure visual + layout pass — zero changes to routes, hooks, edge functions, queries, or component props. We retune the design tokens once, then restyle four surfaces: Sidebar, Dashboard, Chat Workspace, and Operative Dock.

## 1. Design tokens (`src/index.css` + `tailwind.config.ts`)

Update only the **dark theme** token block (`.dark { ... }` around line 435) to the new palette. Light theme untouched.

```text
--background        → 220 24% 5%      (#080B0F)
--card              → 215 22% 7%      (#0D1117)  ← surface
--popover           → 215 22% 7%
--muted             → 213 19% 10%     (#131920)  ← elevated
--accent            → 215 22% 13%     (#1A2332)  ← hover
--border            → 0 0% 100% / 0.10
--border-subtle*    → 0 0% 100% / 0.06   (new var)
--border-accent*    → 158 64% 42% / 0.30 (new var)
--primary           → 158 84% 39%    (#10B981 emerald)
--foreground        → 213 30% 96%    (#F0F6FC)
--muted-foreground  → 215 9% 53%     (#7D8590)
--text-tertiary*    → 215 11% 32%    (#484F58)  (new var)
```

Add a `.font-label` utility (11px / uppercase / tracking-[0.08em] / text-tertiary) and shadow utilities `.shadow-card`, `.shadow-elevated`, `.shadow-glow-emerald` matching the spec. Wire `border-subtle`, `border-accent`, `text-tertiary` into `tailwind.config.ts` `extend.colors` so existing `bg-card / border-border / text-foreground` keep working but new tokens are available.

This means most components inherit the refresh automatically — we then surgically restyle the four hero surfaces.

## 2. Sidebar (`src/components/Sidebar.tsx`)

- Background = `bg-background` (no panel separation).
- Top: 28px gradient avatar + workspace name (13px / 500) + outline-only PRO pill (text-primary green, no fill).
- Section labels: `font-label` style, `mt-5 mb-1 pl-3`, no bold.
- Nav items: `h-8 px-3 rounded-md`. Inactive `text-muted-foreground hover:bg-white/[0.04]`. Active `bg-[#1A2332] text-foreground border-l-2 border-primary` (compensate padding-left so text doesn't shift).
- 16px icons, color follows text state. Strip every `font-semibold`/`font-bold`.
- "Awaiting You" badge → tiny amber pill (`bg-amber-900/60 text-amber-200 text-[10px] font-semibold px-1.5 py-px`).
- "New Agent" becomes a nav-style row with `Plus` icon, emerald text, hover `bg-emerald-500/[0.08]`.
- Bottom utility group (Help / Sign Out / Collapse) separated by `border-t border-white/[0.06]`, smaller text, `text-muted-foreground`.

## 3. Dashboard (`src/pages/Dashboard.tsx` + dashboard subcomponents under `src/components/dashboard/`)

Remove the Getting Started card permanently after dismissal (persist a `localStorage` flag — already pattern in OnboardingWizard, reuse if possible; otherwise simple `localStorage.setItem('dash.gs.dismissed','1')` check on mount).

Page becomes (no card wrappers around the page header):

```text
[Top bar]   Good morning, Prasidha (22/600)            [☾] [🔔•] [⚙]
            Thursday, April 30 (13 / muted)

[Metrics row — 4 columns, gap-4]
 ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
 │ LABEL  ◐ │ │ LABEL  ◐ │ │ LABEL  ◐ │ │ AI SCREEN│
 │  142     │ │   38     │ │  12      │ │  100%(g) │
 │ ▲ 12% …  │ │ ▼ 4% …   │ │ ▲ 8% …   │ │ ▲ 0% …   │
 └──────────┘ └──────────┘ └──────────┘ └──────────┘

[Activity 60%]                            [Your Team 40%]
 Activity              View all            Your Team
 ─ row (avatar | text + ts | pill) ─       ┌ agent card ┐
 ─ row ───────────────────────────         ┌ agent card ┐
 ─ row ───────────────────────────         ┌ agent card ┐
                                            ┌ agent card ┐
                                            ┌ agent card ┐
```

Metric card: `bg-card border border-white/[0.06] rounded-xl p-5`, no shadow. Top row label (`font-label`) + 28px tinted icon circle. Number `text-3xl font-semibold`. Bottom delta row with green/red arrow + `vs last week` in tertiary. AI Screening number colored `text-primary`.

Activity column: header label + "View all" link (both 13px). Each event rendered as a flex row (no card), separated by `border-b border-white/[0.06] py-3`. Empty state: centered "No activity yet" / subtext / single emerald-bordered button "Give your first command" → dispatches the existing `Cmd+K` event to open the chat workspace.

Your Team column: 5 stacked agent cards (`bg-card border border-white/[0.06] rounded-lg p-3 px-4 flex items-center gap-3`). 36px avatar (initial in agent color), name (14/500) + dept (12/muted), Idle/Running pill (Running = emerald with pulsing dot), tiny model badge on far right. Hover → `border-emerald-500/30 bg-[#131920]`. Reuses existing `useAgents(workspaceId)` data.

## 4. Chat Workspace (`src/components/chat/workspace/*`)

`ChatWorkspace.tsx` container:
- Add a fixed `bg-black/60 backdrop-blur-sm` backdrop layer behind the drawer (drawer mode only).
- Drawer surface: `bg-background rounded-t-2xl border-t border-emerald-500/20` with `box-shadow: inset 0 1px 0 rgba(16,185,129,0.15), 0 -30px 80px -20px rgba(0,0,0,0.6)`.
- Drag handle: 36×4, `bg-white/15 hover:bg-white/30 rounded-sm mx-auto mt-2`.

`ConversationsSidebar.tsx`:
- 200px wide, `bg-card border-r border-white/[0.06]`, no header.
- "CONVERSATIONS" `font-label` (12 16 8 padding).
- Filter tabs replaced with three inline text links separated by `·`. Active = emerald, others = tertiary, no pill.
- Conversation rows: `h-10 px-3` flex (color dot + truncated text + 11px tertiary timestamp on the right). Hover `bg-white/[0.04]`. Active `bg-[#131920]`.
- "CHANNELS" section: `#` glyph in tertiary (or dept color when active) + 13px name. Active row `text-foreground bg-white/[0.04]`.
- "YOUR TEAM" bottom: 5 × 28px avatars in a row, evenly spaced, 2px ring in agent color when running, tooltip with name.

`ConversationView.tsx` / `ChannelView.tsx` thread area:
- Channel header: `px-5 py-4 border-b border-white/[0.06]`, colored `#`, 18/600 name, 13/muted description, agent roster avatars right + "N agents idle" tertiary status.
- Messages padding `p-5`, scrollable.

Bubbles (`bubbles/UserBubble.tsx`, `bubbles/AgentBubble.tsx`):
- **User**: right-aligned, `bg-[#131920] border border-white/[0.08] rounded-[12px_12px_2px_12px] px-4 py-3 max-w-[70%] text-sm`. `@` mentions → existing `MentionPill` restyled to `bg-emerald-500/15 text-primary px-1.5 py-px rounded`.
- **Agent**: left-aligned. 28px agent-color avatar floats left. Agent name above content (12/500 in agent accent color). Content `bg-card border border-white/[0.08] rounded-[2px_12px_12px_12px] px-4 py-3 max-w-[75%]`.
- **Thinking**: three 6px dots in agent color, 4px gap, sequential scale animation (Tailwind keyframes added in step 1).
- **Working**: small card — tiny model badge top right, 13/muted task text, thin progress bar `h-1 bg-white/[0.06]` with agent-color gradient fill + shimmer.
- **HandoffRow** (`bubbles/HandoffRow.tsx`): center, two 24px avatars with thin line + traveling emerald dot animation, "handoff" label below in tertiary 11px.
- **SystemMessage**: center `── text ──`, 11/tertiary, no background.

`ChatComposerPro.tsx` input bar:
- Wrapper `bg-card border-t border-white/[0.08] px-4 py-3`.
- Three suggested-prompt chips above input (only when input empty + view kind = empty/conversation): `bg-white/[0.04] border border-white/[0.08] rounded-full px-3.5 py-1.5 text-[13px] text-muted-foreground hover:text-foreground hover:border-white/[0.16]`.
- Context chip (when present): emerald-tinted pill per spec, with × dismiss on hover.
- Textarea: transparent, no border, tertiary placeholder, 14px, caret emerald (`caret-primary`).
- Right icons: 20px, tertiary → secondary on hover.
- Send button appears with `motion` scale-in only when there's text: 28px emerald circle with white arrow.

## 5. Operative Dock (`src/components/dock/OperativeDock.tsx`)

- Container: `rounded-2xl bg-card/80 backdrop-blur-2xl border border-white/[0.08]` (already close — retune colors only).
- Each `DockItem` avatar: keep magnification, but ring becomes `2px solid <agentColor>`. When agent is running add `box-shadow: 0 0 8px <agentColor>` via inline style. Idle = solid ring, no glow. Status dot kept but smaller (8px) and only shown when running.
- "+" button: 36px dashed-border circle, `text-muted-foreground hover:text-primary hover:border-emerald-500/50`.

## 6. Implementation order & guardrails

1. Tokens + tailwind extension + new `font-label`/shadow/keyframe utilities (single file each).
2. Sidebar restyle (no markup-structure changes beyond wrapper classes + the New Agent row).
3. Dashboard layout: refactor markup into TopBar, MetricsRow, ActivityList, TeamColumn — but every data hook stays exactly as-is.
4. Chat workspace surface + bubbles + composer — restyle existing components, do not rename exports or change props.
5. Operative dock ring/glow tweak.

**Untouched**: `src/contexts/ChatWorkspaceContext.tsx`, `src/lib/chatMessageStream.ts`, `src/hooks/*`, all edge functions, all routing, all Supabase calls.

After implementation we'll spot-check `/dashboard`, open the chat drawer (Cmd+K), open a channel, and trigger the agent dock to verify visuals at the 1067×775 viewport currently in use.
