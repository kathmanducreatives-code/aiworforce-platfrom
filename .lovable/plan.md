# Pass 2.5 — Consolidate to a single persistent Command Dock

Goal: kill the Pass 2 hero on the dashboard, and merge the existing footer
chat bar (`GlobalChatBar`) + agent dock (`OperativeDock`) into one floating
**Command Dock** mounted globally in `MainLayout`. Backend, routing and chat
logic are untouched — this is a UI consolidation.

## Current state (verified)

- `src/pages/Dashboard.tsx` line 212 renders `<HeroCommandSurface />` (Pass 2).
- `src/components/dashboard/HeroCommandSurface.tsx` — the hero (kept on disk,
  unmounted; behaviors migrate into the dock).
- `src/components/MainLayout.tsx` mounts BOTH:
  - `<GlobalChatBar />` — bottom-center "Message your workforce…" composer
    (renders `ChatComposerPro openOnFocus`). This is the legacy footer input.
  - `<OperativeDock />` — bottom-right floating row of 5 agent avatars +
    "deploy" button. Desktop only.
- `ChatComposerPro` is also used inside `ChatWorkspace` drawer — must keep
  working there unchanged.
- Backend path: `chatRespond` + `useChatWorkspace` context (unchanged).

So today the user sees two surfaces at the bottom (composer + dock) AND a
hero in the middle of the dashboard. Three things doing related jobs.

## Target

One floating glass dock, centered at bottom of every authenticated page,
with three states (resting / focused / expanded). Cinematic dim + emerald
glow from Pass 2 live here now. Agent avatars live here now.

## JOB 1 — Remove hero from Dashboard

- `src/pages/Dashboard.tsx`: drop the `HeroCommandSurface` import and the
  `<HeroCommandSurface />` render at line 212. Leave the gap empty (Pass 3
  fills it with Morning Brief).
- Keep `HeroCommandSurface.tsx` on disk, unused. Don't delete.

## JOB 2 — New `CommandDock` component

New file: `src/components/dock/CommandDock.tsx`.

Replaces both `GlobalChatBar` and `OperativeDock` visually. Reuses the
exact same `chatRespond` + `useChatWorkspace` plumbing the hero used, so
submission / persistence / @mentions / agent routing are unchanged.

### Layout & positioning

- `position: fixed; bottom: 24px; left: 0; right: 0;` flex-center.
- Inner container: `w-full max-w-4xl mx-4` (≈896px max, viewport-32px on
  narrow screens).
- `z-40` — above page content, below modals (`CommandPalette` is `z-50`).
- Hidden when `ChatWorkspace` drawer is open (mirrors `GlobalChatBar`
  behavior — checks `mode !== 'closed'`).

### Surface

- `.glass-surface` (Pass 1 token), `rounded-2xl` (16px), padding `p-5`
  (resting) → `p-5 pb-4` (expanded). No new ad-hoc styling.
- Ambient emerald glow (the Pass 2 layered radial blur) sits behind the
  card, opacity animates with state (10% resting → 25% focused/expanded).

### Resting state (~120px)

```text
[ chip · chip · chip · chip ]                          (text-mono-label)
[ rotating placeholder textarea …………  ◯◯◯◯◯  +  Enter↵  ⌃ ]
```

- 4 suggestion chips (same 4 from Pass 2: "Brief me on today", "Show
  pending approvals", "What's @Penn working on?", "Run morning standup").
- Rotating placeholder (same 5 strings, 4s interval, 300ms cross-fade).
- Right cluster: 5 agent avatars (24px) with emerald status ring +
  breathe, `+` add-agent button, `Enter ↵` hint, chevron-up to expand.

### Focused state

- Textarea grows with content, max 4 lines then scrolls.
- Chips fade out (200ms, framer `AnimatePresence`).
- Ambient glow → 25% opacity.
- Full-viewport dim overlay: `fixed inset-0 bg-black z-30
  pointer-events-none`, animates 0 → 0.6 (desktop) / 0 → 0.4 (mobile)
  over 250ms ease-out. Dock itself sits at `z-40` so it stays lit.

### Expanded state

- Trigger: click chevron-up, or `Cmd/Ctrl + \`.
- Container animates from `~120px` → `60vh`, 350ms ease-out (framer
  `layout` + height tween — matches Pass 2 easings).
- Top section becomes a scrollable conversation pane fed by
  `useChatWorkspace` view (mirrors what `ChatWorkspace` shows). Reuses
  the existing message-list components from the workspace if a clean
  import is available; otherwise a thin list bound to the same context.
- Chevron-down + `Escape` collapse back to resting. Dim stays on while
  expanded.

### Mobile (<768px)

- Resting height ~64px, no chip row, no Enter hint.
- Avatars: 3 visible + "+2" pill.
- Tap composer → expand to **full-screen** sheet (covers viewport,
  safe-area aware), same conversation pane behavior. Close via chevron
  or Escape / back-swipe affordance.

### Persistence across navigation

- Component lives in `MainLayout`, so it never unmounts during route
  changes. Textarea value, focus state, and expansion state survive
  navigation because the component itself doesn't remount.
- Conversation context is already global (`ChatWorkspaceProvider` wraps
  `MainLayout`), so expanded-state history persists naturally.
- Suggestion chips are static for now (page-context awareness deferred).

## JOB 3 — Remove the legacy surfaces

In `src/components/MainLayout.tsx`:

- Drop `<GlobalChatBar />` import + render.
- Drop `<OperativeDock />` import + render.
- Add `<CommandDock />` in their place.

Files NOT deleted (kept on disk, just unmounted):
- `src/components/chat/GlobalChatBar.tsx`
- `src/components/dock/OperativeDock.tsx`
- `src/components/dashboard/HeroCommandSurface.tsx`

`ChatComposerPro` stays as-is — still used by `ChatWorkspace`.

## Technical details

- Framer Motion for: dim fade, chip fade, expand height tween, glow
  opacity. Easings match Pass 2 (`easeOut`, 250ms dim, 350ms expand,
  200ms chip, 300ms placeholder cross-fade).
- Keyboard: `Enter` submit, `Shift+Enter` newline, `Cmd/Ctrl+\` toggle
  expand, `Escape` collapse.
- Reuses `chatRespond`, `useChatWorkspace`, `AGENT_PROFILES`,
  `CHANNEL_DEFAULT_AGENT` — exact same plumbing as `HeroCommandSurface`.
- Tokens only: `.glass-surface`, `.text-mono-label`, `border-soft`,
  `border-active`, `layer-1/2`. No new colors, no new blur values.
- `tsc --noEmit` clean at the end.

## Out of scope (deferred)

- Morning Brief content for the freed dashboard space (Pass 3).
- Page-contextual suggestion chips (later pass).
- Real agent status wiring (Pass 4 — stays static "ready").
- Removing dead files (`HeroCommandSurface`, `GlobalChatBar`,
  `OperativeDock`) — leave on disk for now.

## Files touched

- `src/components/dock/CommandDock.tsx` — new.
- `src/components/MainLayout.tsx` — swap mounted surfaces.
- `src/pages/Dashboard.tsx` — remove hero import + render.

## Open question for you before I build

Expand animation: I'm planning **350ms ease-out, height tween from
~120px → 60vh, container stays centered horizontally**. On mobile it
goes **full-screen sheet** (100vw × 100vh, slide-up 300ms). OK to
proceed with those, or do you want different timing / a different
mobile pattern (e.g. bottom-sheet that only covers 85vh)?
