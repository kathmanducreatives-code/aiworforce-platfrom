# Plan — AI Workforce Dock on Dashboard

## Scope
Replace only the "Agent work canvas" section in `src/pages/Dashboard.tsx`. Keep Company Brain strip, Pilot Briefing, Workflow Timeline, Decision Queue, Inline Command Bar, Sidebar, and the bottom floating Agent Dock unchanged.

## Files

**New**
- `src/components/workforce/WorkforceDock.tsx` — horizontal premium glass capsule with circular agent avatars (Pilot, Scout, Aria, Penn, Hawk, Scribe, +). Status ring colors per spec, override Aria → violet and Penn → cyan visually for this dock. Hover lift/scale, tooltip card (name, role, status, output count, next action), notification badges from `useWorkforceState` (Aria shows `!` when blocked). Selected agent gets stronger glow + active ring. Click selects agent + navigates via action button below.
- `src/components/workforce/DepartmentPreview.tsx` — dynamic panel reacting to selected agent. Title, subtitle, 3–5 stat lines, and 2–3 action buttons (each routes via `react-router-dom`'s `useNavigate`, never auto-sends). Uses `useWorkforceState` totals for live numbers.
- `src/components/workforce/WorkforceHandoffStrip.tsx` — thin chip row: Scout → Aria → Penn → Pilot → Scribe with arrow separators and subtle glow on currently active step.
- `src/components/workforce/departmentConfig.ts` — per-agent config: department label, subtitle, route, ringColor, iconKey, statBuilder(totals, brainComplete), actionBuilder(navigate). Centralizes routing so dock and preview stay in sync.

**Edited**
- `src/pages/Dashboard.tsx` — remove the "Agent work canvas" block (heading + `AGENT_ORDER.map(...AgentWorkCard...)`). Insert:
  1. Section header "AI Workforce Dock" + sublabel.
  2. `<WorkforceDock selectedId={...} onSelect={...} agents={agents} />`
  3. `<DepartmentPreview agentId={selectedId} totals={totals} brainComplete={brainComplete} />`
  4. `<WorkforceHandoffStrip activeId={selectedId} />`
  
  Add `useState<AgentId>('pilot')` for selected agent. Keep `AgentProfileDrawer` available but selection no longer opens the drawer (dock click selects; drawer remains used by the bottom `AgentDock`).

## Behavior
- Selection state lives in `Dashboard.tsx` (no global state needed).
- Plus button: opens a simple "Add agent / workflow (coming soon)" disabled tooltip — no new route.
- All action buttons use `navigate(route)` to existing pages: Pilot → `/awaiting-you`, Scout → `/signals`, Aria → `/leads` (or `/onboarding/company-brain` when brain incomplete), Penn → `/awaiting-you` + `/email-sequences`, Hawk → `/competitors`, Scribe → `/content`.
- Badges/stats pulled from `useWorkforceState().totals` and per-agent `badgeCount`. Aria badge renders `!` when `agents.aria.status === 'blocked'`.
- No backend, schema, hook logic, or routing config changes. No removal of the bottom `AgentDock` (it stays as the global floating dock).

## Visual
- Glass capsule: `bg-black/40 border border-white/[0.08] backdrop-blur-2xl`, inner top highlight, soft shadow. Circular avatars 56–64px with glossy radial highlight and colored status ring (existing `accentClasses` in `agents.ts`). Aria override uses violet, Penn override uses cyan to match spec.
- Hover: `-translate-y-1 scale-110`, tooltip card with name/role/status/output/next action.
- Active: ring opacity boosted, soft outer glow, agent label brightens.
- Department Preview: glass card, large agent monogram on left, stats list center, action buttons right (premium outlined emerald primary, ghost secondary).
- Handoff strip: small mono-uppercase chips with `→` separators, active chip emerald.

## Non-goals
- No changes to Pilot Briefing, Decision Queue, Timeline, Command Bar, Sidebar, bottom Agent Dock.
- No new routes, no auto-send/auto-post, no schema or Supabase changes.
- No landing-page edits.

## Verification
- `bunx tsc --noEmit`
- Visual check at desktop and ~768px (dock scrolls horizontally on small screens).
