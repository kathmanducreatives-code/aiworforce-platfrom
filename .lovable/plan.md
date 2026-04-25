# ScreeningPilot Command Center — 5 Enhancements

Enhance the existing Command Center without altering current layout, theme, or routes. All work uses framer-motion (already installed at v12).

## 1. Operative Dock (macOS-style bottom dock)

**New files:**
- `src/data/dockAgents.ts` — agent metadata (id, name, role, dept, color, model, currentTask, isRunning)
- `src/components/dock/OperativeDock.tsx` — fixed bottom-center pill, frosted bg, z-50
- `src/components/dock/DockAvatar.tsx` — circular avatar with department-color ring + status dot, framer-motion `useTransform` magnification driven by mouse-x distance (hovered ≈1.6×, neighbors ≈1.3×, spring physics)
- `src/components/dock/AgentHoverCard.tsx` — rich floating card above magnified avatar (avatar 48px, name, role tagline, current task with animated progress bar, "Powered by" model pill, "View output" + "Send command" buttons). Hoverable; only dismisses when cursor leaves dock+card area.
- `src/components/dock/AgentDrawer.tsx` — right-side `Sheet` (shadcn) showing live activity log, current task progress, model badge, "View full output" + "Send command" actions
- `src/components/dock/DeployAgentButton.tsx` — `+` button at far right opening existing deploy flow / drawer

**Mounting:** Add `<OperativeDock />` to `src/components/MainLayout.tsx` so it appears on every authenticated page.

**Model badge colors:** GPT-4o emerald, Claude coral-orange, Gemini blue, Llama purple.

## 2. "Awaiting You" Inbox

**Edits:**
- `src/components/Sidebar.tsx` — rename "Inbox" → "Awaiting You"; badge color → amber.
- `src/pages/AwaitingYou.tsx` — new page (replaces or wraps existing inbox route). Cards with: agent avatar+name (left), one-line completion + ask-for-approval description, "Approve" (green) + "Review first" (ghost) buttons (right), amber left-border accent.
- `src/App.tsx` — point existing inbox route to `AwaitingYou`.

Reuses mock approval items if no backing table exists yet (resilience pattern).

## 3. Command Bar

**Edits:**
- Replace top-bar search with `src/components/dock/CommandBar.tsx` — looks like input, placeholder `"Command your workforce... (⌘K)"`. Click or ⌘K opens existing `CommandPalette` modal.
- Extend `src/components/shared/CommandPalette.tsx`:
  - Add suggested-command chip row at top: "Ask Scout to source 20 SaaS founders in London", "Tell Penn to write outreach for today's leads", "Show me what Aria did today", "Deploy a new agent in Growth", "Summarize today's intel signals".
  - On Enter with free-text query: render an inline reply block inside the palette showing the routed agent's avatar + a generated text response (mock for now — wire to AI gateway later).
  - Close on Escape / outside click (already supported).

## 4. Handoff Connector in Live Feed

**Edits:**
- `src/pages/CommandCenter.tsx` — extend feed item type with `kind: 'activity' | 'handoff'` and inject 2 sample handoff events between existing items.
- `src/components/command-center/HandoffFeedItem.tsx` — new component:
  - Two avatars side-by-side connected by an SVG arrow with animated `stroke-dasharray` (framer-motion or CSS keyframes) for "in transit" effect
  - Two labels below: sender action (left) → receiver task (right)
  - Slightly lighter card bg than regular items
  - "HANDOFF" pill in top-right (muted)

Regular single-agent items remain unchanged.

## 5. Agent Persona Hover Card

Covered by `AgentHoverCard.tsx` in step 1. Key behaviors:
- Renders via React Portal (z-60) to escape dock clipping.
- Smooth upward fade-in (`opacity` + `y: 8 → 0`, spring).
- Stays visible while cursor is over avatar OR card; only hides when cursor leaves both. Tracked with shared `onMouseEnter/Leave` on a wrapper plus a small dismiss timeout.

## Technical Details

- **Stack:** framer-motion 12 (`motion`, `useMotionValue`, `useTransform`, `AnimatePresence`, `spring`).
- **Z-index layering:** dock=50, hover card=60, agent drawer=70 (above dock), modals/CommandPalette=80.
- **Theme tokens:** use existing semantic tokens (`bg-card`, `border-border`, `text-primary`); no hardcoded hex outside the explicit model-badge palette.
- **Agent avatars:** since `/agents/*.png` don't exist, use shadcn `Avatar` with initials fallback colored by department (Talent emerald, Growth blue, Content violet, Intel amber).
- **Mobile:** dock hidden below `md` breakpoint (mobile already has `MobileHeader`). Command bar collapses to a single ⌘K icon button on mobile.
- **No backend / route changes** beyond the inbox alias. No new tables.

## Files Summary

New:
```
src/data/dockAgents.ts
src/components/dock/OperativeDock.tsx
src/components/dock/DockAvatar.tsx
src/components/dock/AgentHoverCard.tsx
src/components/dock/AgentDrawer.tsx
src/components/dock/DeployAgentButton.tsx
src/components/dock/CommandBar.tsx
src/components/command-center/HandoffFeedItem.tsx
src/pages/AwaitingYou.tsx
```

Modified:
```
src/components/MainLayout.tsx        (mount OperativeDock)
src/components/Sidebar.tsx           (rename Inbox → Awaiting You, amber badge)
src/components/shared/CommandPalette.tsx  (chips + inline agent reply)
src/pages/CommandCenter.tsx          (inject handoff items, render HandoffFeedItem)
src/App.tsx                          (route inbox → AwaitingYou)
```

Approve and I'll switch to default mode and ship it.
