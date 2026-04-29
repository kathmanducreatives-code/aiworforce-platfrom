## Departments Redesign — Team Rooms

Transform "Departments" from sidebar nav links into a true 2-step experience: a **Departments Overview** page (4 living team room cards) → **Department Room** (already exists, will be polished into header / kanban / live activity). All data is real-time via existing Supabase subscriptions; no backend changes.

### Routing & Sidebar

- Add new route `/departments` → renders new `DepartmentsOverview` page.
- In `Sidebar.tsx`, change the **Departments** group so the group label itself is clickable (navigates to `/departments`). Keep the 4 child links (`Talent / Growth / Intelligence / Content`) as quick-jumps directly into a room — exactly as the prompt requests.
- Keep existing `/rooms/:dept` route — that's where rooms live.

### Step 1 — Departments Overview Page

New file: `src/pages/DepartmentsOverview.tsx`

Layout:
```text
┌─────────────────────────────────────────────────┐
│  Departments                                    │
│  Your AI team rooms                             │
│                                                 │
│  [12 active tasks]  [3 agents running]  [2 ⏳]  │
├─────────────────────────────────────────────────┤
│ ┌──────────────┐ ┌──────────────┐               │
│ │  TALENT      │ │  GROWTH      │               │
│ │  ● ● ●       │ │  ● ●         │               │
│ │  Aria is …   │ │  Penn wrote… │               │
│ │  3 active    │ │  1 active    │               │
│ │  ▓▓▓▓▓░░░    │ │  ▓▓░░░░░░    │               │
│ └──────────────┘ └──────────────┘               │
│ ┌──────────────┐ ┌──────────────┐               │
│ │ INTELLIGENCE │ │  CONTENT     │               │
│ └──────────────┘ └──────────────┘               │
└─────────────────────────────────────────────────┘
```

Top **summary row** (3 KPIs):
- Total active tasks across all departments — count of `task_plans` where status ∈ `planning | executing`.
- Total agents currently running — `agents.status === 'running'`.
- Total items awaiting your approval — `approvals.status === 'pending'` (amber).

Pulls data from already-wired hooks: `useAgents`, `useAllPlans`, `useActivityFeed`, `useApprovals` (workspace-scoped, real-time).

**`DepartmentCard` component** (new: `src/components/department/DepartmentCard.tsx`):
- Large rounded-2xl card, `bg-card/70 backdrop-blur-md`, subtle border.
- Department-specific accent (left border + soft inner glow, no harsh fill):
  - Talent → blue-violet (`#8B7BFF`)
  - Growth → emerald green (`#10B981`)
  - Intelligence → teal (`#14B8A6`)
  - Content → purple (`#A855F7`)
- Header row: department icon (subtle, low-opacity) + name + "X agents".
- Agent avatar row (small 24px circles) — running ones get a pulsing accent ring + tiny dot.
- One-line status: latest `activity_feed` event whose `agent_id` belongs to this department's agents — formatted as "Aria is screening 8 candidates" (use event title/body).
- Counts row: `N active` (executing plans) + amber pill `N awaiting` only if > 0.
- Recent output preview: last completed task output (one line, truncated). Falls back to last activity body.
- Bottom: thin progress bar — % of today's plans that are `complete` over total today. Subtle, accent-colored.
- Hover: `translate-y-[-2px]`, border brightens, soft accent shadow. Click → navigate to `/rooms/{dept}`.

**Empty state** for a card with no activity yet: "Quiet for now — give the team a task."

### Step 2 — Department Room Polish

Refactor `src/pages/DepartmentRoom.tsx` to match the prompt's three-section layout exactly. The data plumbing already exists; we restructure visuals and add breadcrumb.

**Section 1 — Room Header**
- Breadcrumb: `Departments > Talent` (with back arrow, links to `/departments`).
- Large department name (28px), agent avatar row beside it — colored ring if running, gray if idle. Click avatar → opens `AgentHoverCard` / agent detail.
- Right side: **Start Task** button → focuses the bottom composer (pre-filled `restrictDepartment={dept}`).
- Below header: live status line — current activity (e.g. "Aria is screening 8 candidates · Penn drafting outreach").

**Section 2 — Work Board (kanban, left)**

Replace the current 4 status-only columns with **department-specific workflows**:
- Talent: `Sourced → Screened → Reviewed → Outreach Ready`
- Growth: `Leads Found → Qualified → Outreach Sent → Replied`
- Intelligence: `Monitoring → Analysing → Report Ready → Delivered`
- Content: `Brief → Drafting → Review → Published`

Mapping rule (simple, deterministic from existing data — no backend change):
- Each column maps to a combination of `task_plans.status` + presence/absence of `approvals` for that plan.
- Column 1 = `planning`. Column 2 = `executing` (no awaiting approval). Column 3 = `awaiting_approval`. Column 4 = `complete`.
- The visible **column labels** change per department; the underlying buckets are the same.

Card UI:
- Title (instruction), agent avatar(s), small progress dots `Step X of Y`.
- Amber dot in corner if it has a pending approval.
- Click → opens existing `PlanDetailView` dialog (already wired) which already supports approve/reject.
- Cards re-bucket automatically as plan status changes (already realtime via `useAllPlans` + `subscribePlans`).

**Section 3 — Live Activity (right panel)**
- Top: agent status cards for this department (name, current_task, running/idle pulse). Already partially via `AgentRoster` — restyle into compact stacked cards.
- Middle: chronological activity stream. Style `event_type === 'handoff'` distinctly — render as a small connector row "Aria → Penn" with an arrow icon and accent line.
- Bottom: `ChatComposer` with `restrictDepartment={dept}` (already in place). `@` shows only this department's agents (already supported).

### Visual System

Reuse existing tokens from `src/index.css` and `tailwind.config.ts` (pitch-black surface, emerald primary, glassmorphism). Per-department accent colors are scoped to that department's surfaces only — they don't override global emerald primary.

Add a small helper `src/lib/departmentTheme.ts`:
```ts
export const DEPT_THEME = {
  talent:       { hex: '#8B7BFF', label: 'Talent',       icon: Users,    workflow: ['Sourced','Screened','Reviewed','Outreach Ready'] },
  growth:       { hex: '#10B981', label: 'Growth',       icon: TrendingUp, workflow: ['Leads Found','Qualified','Outreach Sent','Replied'] },
  intelligence: { hex: '#14B8A6', label: 'Intelligence', icon: Eye,      workflow: ['Monitoring','Analysing','Report Ready','Delivered'] },
  content:      { hex: '#A855F7', label: 'Content',      icon: BookOpen, workflow: ['Brief','Drafting','Review','Published'] },
};
```

### Files to Create / Edit

Create:
- `src/pages/DepartmentsOverview.tsx`
- `src/components/department/DepartmentCard.tsx`
- `src/components/department/DepartmentSummaryBar.tsx`
- `src/lib/departmentTheme.ts`

Edit:
- `src/App.tsx` — add `/departments` route.
- `src/components/Sidebar.tsx` — make "Departments" group label a `NavLink` to `/departments`; keep child quick-links.
- `src/pages/DepartmentRoom.tsx` — add breadcrumb + back arrow, restructure header, swap kanban column labels per-department via `DEPT_THEME[dept].workflow`, polish right-side activity feed (handoff rendering, agent status cards).

### Out of Scope

- No edge function or DB changes.
- No changes to the chat workspace, agent builder, or dock.
- Approve/reject UX reuses existing `PlanDetailView`.