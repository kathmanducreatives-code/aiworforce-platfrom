
## 📋 Plan: Operative Dock & Live AI Workforce Layer (Re-implementation)

The previous implementation was lost when the landing page was reverted. The current dashboard route `/dashboard` renders **`src/pages/Dashboard.tsx`** (not `CommandCenter.tsx`), so the handoff feed work targets that file. Everything else matches the original plan. `framer-motion` v12 is installed.

### Existing state preserved
- `MainLayout.tsx`, `Sidebar.tsx`, existing `CommandPalette.tsx` (live Supabase search), `Dashboard.tsx` layout — all metric/department/activity cards untouched
- Verdant dark theme, semantic tokens, all routes

---

### Change 1 — Operative Dock (macOS-style)

**New `src/data/dockAgents.ts`** — exports 5 agents (Aria/Talent, Scout/Talent, Penn/Growth, Hawk/Intel, Scribe/Content) with: id, name, role tagline, department, model (`gpt-4o | claude | gemini | llama`), currentTask, progress 0-100, status (`active | idle`), recentActivity[].

**New `src/components/dock/OperativeDock.tsx`**
- Fixed `bottom-4 left-1/2 -translate-x-1/2 z-[60]` floating pill
- `backdrop-blur-2xl bg-[#13151C]/70 border border-white/[0.07] rounded-2xl px-3 py-2 shadow-2xl`
- 5 agent buttons + a `+` deploy button at the right
- Each avatar: 48px circle with **department-colored ring-2** (Talent emerald, Growth blue, Content violet, Intel amber). Initials fallback (no `/agents/*.png` on disk).
- Pulsing status dot bottom-right (emerald active / zinc idle)
- **Magnification**: track mouse X via `onMouseMove`; `useTransform` on each item's distance from cursor → scale (1 → 1.6 hovered, ~1.3 neighbors), spring `{ stiffness: 300, damping: 20 }`
- Click → opens `AgentDrawer`

**New `src/components/dock/AgentHoverCard.tsx`** (Change 5)
- Portaled to `document.body` via `createPortal`, positioned with `getBoundingClientRect`
- 48px avatar + name, role tagline, current task, animated progress bar (framer width animation)
- "Powered by" pill with model-specific colors (GPT-4o emerald, Claude coral, Gemini blue, Llama violet)
- Two action buttons: "View output", "Send command"
- Hover-bridge: stays open when cursor moves avatar↔card; closes on `onMouseLeave` of wrapping group with 150ms timeout

**New `src/components/dock/AgentDrawer.tsx`**
- Right-side `Sheet` (`w-[420px]`) with avatar header, status pill, current task + progress bar, last 5 activity log entries, "Powered by" badge, and "View full output" / "Send command" buttons (the latter dispatches `command-bar:prefill` event)

**Mount**: `<OperativeDock />` added to `src/components/MainLayout.tsx` after `<main>`.

---

### Change 2 — "Awaiting You" Inbox

**`src/components/Sidebar.tsx`**: add nav item `{ label: 'Awaiting You', path: '/awaiting-you', icon: Inbox, badge: '4', badgeColor: 'amber' }`. Extend badge classnames to support amber variant: `bg-amber-500/10 text-amber-400 border border-amber-500/20`.

**New `src/pages/AwaitingYou.tsx`**
- Header "Awaiting Your Approval" + subtext
- 4 mock approval cards (Aria/Penn/Scout/Hawk), each: `border-l-2 border-amber-500/60` glass surface, agent avatar + name, one-line context, **Approve** (emerald) + **Review first** (ghost outline) buttons
- Approve → toast + framer exit animation removing the card

**`src/App.tsx`**: add `<Route path="/awaiting-you" element={<ProtectedRoute><MainLayout><AwaitingYou /></MainLayout></ProtectedRoute>} />`.

---

### Change 3 — Command Bar

**New `src/components/dock/CommandBar.tsx`**
- Mounted in `MainLayout.tsx` as a top bar (right of sidebar): styled input reading `"Command your workforce... (⌘K)"` in monospace
- Click or ⌘K → opens existing `CommandPalette` in enhanced mode

**Edit `src/components/shared/CommandPalette.tsx`**: add `enhanced?: boolean` prop. When true and no live results yet, render:
1. Suggested command chips (5 prompts: "Ask Scout to source 20 SaaS founders…", "Tell Penn to write outreach…", "Show me what Aria did today", "Deploy a new agent in Growth", "Summarize today's intel signals")
2. On Enter → inline mock response card with relevant agent avatar + reply (keyword routing to Scout/Penn/Aria/Hawk/Scribe; Aria fallback). No real LLM call.
3. Listen for `command-bar:prefill` window event to populate query.

Existing live Supabase search remains intact below.

---

### Change 4 — Handoff Connector in Live Feed

**Edit `src/pages/Dashboard.tsx`**: extend the activity feed mock array with `type: 'regular' | 'handoff'` discriminator. Add 2 handoff items:
- Scout (talent) `sourced 18 leads` → Aria (talent) `now screening them` — 9:15 AM
- Brief/Hawk (intel) `flagged 2 hot signals` → Penn (growth) `drafting outreach` — 8:30 AM

**New `src/components/dashboard/HandoffFeedItem.tsx`**
- Card `bg-[#1a2332]/85 border-white/10`
- Two avatar circles connected by SVG line with **animated dashed arrow**: `<line stroke-dasharray>` + framer-motion animating `stroke-dashoffset` infinite (work-in-transit feel)
- Below: sender action (left) → receiver task (right)
- Top-right `HANDOFF` badge in muted zinc
- Render selector in Dashboard's feed: `item.type === 'handoff' ? <HandoffFeedItem/> : existing card`

---

### Change 5 — Agent Persona Hover Card

Covered in Change 1. Reiterates: portaled, hover-bridged, model-colored "Powered by" pill, animated progress bar, fade-up entrance.

---

### File summary

**New (7)**:
1. `src/data/dockAgents.ts`
2. `src/components/dock/OperativeDock.tsx`
3. `src/components/dock/AgentHoverCard.tsx`
4. `src/components/dock/AgentDrawer.tsx`
5. `src/components/dock/CommandBar.tsx`
6. `src/components/dashboard/HandoffFeedItem.tsx`
7. `src/pages/AwaitingYou.tsx`

**Modified (4)**:
1. `src/components/MainLayout.tsx` — mount `<OperativeDock />` and `<CommandBar />`
2. `src/components/Sidebar.tsx` — add "Awaiting You" item with amber badge variant
3. `src/components/shared/CommandPalette.tsx` — `enhanced` mode (chips + inline reply + prefill listener)
4. `src/pages/Dashboard.tsx` — extend feed with handoff items, render via `HandoffFeedItem`
5. `src/App.tsx` — add `/awaiting-you` route

### Tech & guardrails
- All animations via framer-motion v12 (springs, fade, stroke-dashoffset loop)
- Strict semantic-token / Verdant-palette adherence; department accents match existing dashboard
- No backend / data-model changes — all new content is mock-driven
- Avatar fallbacks render colored initials (no `/agents/*.png` on disk)
- Dock z-index 60: above page content, below Radix dialogs/sheets so the agent drawer + palette open above it
- Browser-safe types throughout (`ReturnType<typeof setTimeout>`)
