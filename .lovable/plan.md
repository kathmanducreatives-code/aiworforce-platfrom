# Agentory — AI Workforce OS Redesign

A focused frontend redesign that turns the existing app shell into a **live AI workforce command center**. No routing, auth, data-model or edge-function changes. Reuses current pages, hooks, and Lovable Cloud wiring.

## Scope

In scope (UI/UX only):
- New shared design tokens + reusable glass components
- New Dashboard layout (Pilot Briefing + Agent Work Canvas + Decision Queue + Workflow Timeline)
- New floating **Agent Dock** with circular DPs, status rings, badges, hover cards
- New floating glass **Command Bar** (Raycast-style) wired to existing `chat:prefill` event
- New **Agent Profile Drawer** (right-side sheet)
- Polish pass on existing 10-step `OnboardingCompanyBrain` wizard (visual only) + add Mission / Signal Pack / Approval-Mode / First-Output screens as new wizard steps reusing existing state
- Sidebar restyle (same nav items, no route changes)

Out of scope:
- Backend / schema / edge function changes
- Routing changes, auth changes, new pages
- Landing page (per repeated user constraint)
- Auto-send / auto-DM / auto-post (approval-mode toggles default ON, copy-only)
- Replacing existing hooks (`useSignalFeed`, `useApprovals`, `useCompanyBrain`, …) — they continue to feed real data into the new components

## Design system

Add to `src/index.css` (extends existing `.glass-quiet/surface/loud`):
- `.agentory-bg` — near-black with low-opacity grid + 3 radial gradients (emerald, teal, deep-purple)
- `.glass-shine` — diagonal reflection gradient on hover
- `.glass-edge-top` — `::before` inner top-edge highlight
- `.ring-status-{emerald|teal|amber|violet|cyan|blue|purple|gray|red}` — status ring colors
- `.btn-emerald` / `.btn-glass` — primary/secondary button utilities
- `.pill-status` — glassy capsule with dot
- Motion: `dock-lift`, `pulse-soft`, `shimmer-agent` keyframes

Colors mapped to agent/role per spec (emerald primary, amber approvals, purple drafting, blue research, gray idle, red blocked).

## New reusable components

Under `src/components/workforce/`:

```text
AgentAvatar.tsx         circular DP w/ optional glow
AgentStatusRing.tsx     SVG ring around avatar, color by status
AgentDock.tsx           floating bottom dock (desktop) + hover cards
AgentHoverCard.tsx      name/role/status/output/next-action popover
AgentWorkCard.tsx       work module (replaces KPI box)
AgentProfileDrawer.tsx  right-side Sheet w/ mission, activity, actions
PilotBriefing.tsx       hero "manager update" card
DecisionQueue.tsx       Needs-Your-Approval panel
ApprovalItem.tsx        per-row card (Approve/Edit/Reject)
WorkflowTimeline.tsx    Linear-style activity log
CommandBar.tsx          floating glass capsule + suggested chips
StatusPill.tsx          glassy capsule
CompanyBrainStrip.tsx   compact top setup strip (replaces big BrainReadinessCard on dashboard)
agents.ts               canonical agent registry (id, name, role, color, dpInitials)
```

A single `agents.ts` defines Pilot, Scout, Aria, Penn, Hawk, Scribe — every other component reads from it.

## Data wiring (no backend changes)

`Dashboard.tsx` already loads `signals`, `drafts`, `approvals`, `reviewsBySignal`, `brain`. We compute per-agent derived state in a new `useWorkforceState(workspaceId)` hook that returns:

```ts
{
  pilot:  { status, todayOutput, nextAction, badgeCount }
  scout:  { ... signals.length, hot signals }
  aria:   { ... blocked if brain incomplete }
  penn:   { ... drafts.length }
  hawk:   { ... competitor signals }
  scribe: { ... content drafts }
  timeline: TimelineItem[]   // built from signals + drafts + approvals timestamps
  decisions: DecisionItem[]  // from approvals
}
```

No new tables. Pure derivation from existing hooks. Empty/loading states return safe defaults so nothing breaks pre-Brain.

`CommandBar` fires `window.dispatchEvent(new CustomEvent('chat:prefill', { detail: { text } }))` (already used elsewhere) and optionally `navigate(route)` — **no auto-send**.

## New Dashboard layout

`src/pages/Dashboard.tsx` rewritten to:

```text
┌───────────────────────────────────────────────────────────┐
│ CompanyBrainStrip (compact, only if !brain.completed)     │
├──────────────────────────────────┬────────────────────────┤
│ PilotBriefing (hero)             │ DecisionQueue          │
│                                  │ (Needs Your Approval)  │
├──────────────────────────────────┤                        │
│ Agent Work Canvas                │                        │
│  ┌────┐ ┌────┐ ┌────┐            │                        │
│  │Scout│Penn │Aria │ …           │                        │
│  └────┘ └────┘ └────┘            │                        │
├──────────────────────────────────┴────────────────────────┤
│ WorkflowTimeline (today)                                  │
└───────────────────────────────────────────────────────────┘
       AgentDock (fixed bottom-center)     CommandBar (fixed bottom, glass)
```

`MetricsGrid`, `WorkforceBriefHero`, `WorkforceActivityPanel`, `NeedsAttentionPanel`, `RecommendedMoves` are removed from the dashboard (files kept for now, unreferenced).

Existing `CommandDock` in `MainLayout` is replaced by the new `AgentDock` + `CommandBar`. The legacy `CommandDock` and `CommandBar` files in `src/components/dock/` stay for now (not imported) to avoid touching unrelated chat workspace plumbing.

## Sidebar

Same nav items and routes. Restyle only: glass surface, emerald active indicator (left 2px bar + soft glow), tighter spacing, no heavy borders. Sections per spec: Dashboard / Signals / Conversations / Awaiting You / Leads / Competitors / Content / Agents / Company Brain / Integrations / Email Sequences.

## Onboarding (additive polish)

Keep current 10-step wizard. Visual pass: apply new glass system, add status-dot agent list to the "Analyzing" step using `AgentAvatar` + `AgentStatusRing`. Add three new optional steps **after** Brain Review (gated behind a feature flag prop, default ON):

- `MissionSelector` — 6 mission cards, default "Find hot leads"
- `SignalPackSelector` — 6 packs w/ owner agent + expected output
- `ApprovalModeSelector` — Copilot (default) / Autopilot, copy-only toggles
- `FirstOutputPreview` — reads `signals` + `drafts` already produced to show "Scout found X · Aria marked Y · Penn drafted Z"

All state stored locally; no schema changes. "Go to dashboard" simply `navigate('/dashboard')`.

## Responsive

- Desktop (≥1280): full 3-pane + bottom dock + command bar
- Tablet (768–1279): DecisionQueue collapses below PilotBriefing; dock stays
- Mobile (<768): dock becomes bottom nav row; cards stack; drawer is full-screen `Sheet`; command bar shrinks to a single pill that opens a full-screen composer

## Files

Created:
- `src/index.css` additions (one append block, ~120 lines)
- `src/components/workforce/*` (14 files listed above)
- `src/components/workforce/agents.ts`
- `src/hooks/useWorkforceState.ts`
- `src/components/onboarding/steps/MissionSelector.tsx`
- `src/components/onboarding/steps/SignalPackSelector.tsx`
- `src/components/onboarding/steps/ApprovalModeSelector.tsx`
- `src/components/onboarding/steps/FirstOutputPreview.tsx`

Edited:
- `src/pages/Dashboard.tsx` — full rewrite using new components
- `src/components/Sidebar.tsx` — restyle, same nav contract
- `src/components/MainLayout.tsx` — mount `AgentDock` + `CommandBar` instead of `CommandDock`/`CommandBar`
- `src/pages/OnboardingCompanyBrain.tsx` — wire 4 new steps + glass polish

Untouched: edge functions, migrations, `client.ts`, landing, auth, routing, all other pages.

## Verification

- `lovable-exec test` for any new unit logic (`useWorkforceState` derivations)
- Visual QA via `browser--view_preview` on `/dashboard`, `/onboarding/company-brain`, mobile width 390
- Confirm: no auto-send, approval toggles default ON, brain-incomplete CTA visible, dock hover cards render, command bar prefills chat without sending, typecheck/build pass

## Safety

- Approval mode default = Copilot
- All "Launch" / "Run" actions = `chat:prefill` + `navigate`, never POST
- Aria stays Blocked while `brain.onboarding_completed === false` (prevents implicit scoring)
- No new RLS / no schema changes / no new edge functions

## Out-of-scope reminders

No landing page edits. No new product phase. No backend workflow changes. No auto-DM/post/comment. No route changes.