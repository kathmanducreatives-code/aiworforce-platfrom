# Pass 2 — Hero Command Surface

Turn the chat input from a footer utility into the visual center of the dashboard, using only Pass 1 tokens (`.glass-surface`, `.text-mono-label`, `text-display-*`, depth-layer colors, `shadow-emerald-glow`).

## Audit (Job 1)

- `src/components/MainLayout.tsx` mounts `<GlobalChatBar />` (footer, every page) and `<OperativeDock />` (the 5 agent avatars, bottom-right, every page).
- `GlobalChatBar` renders `ChatComposerPro` inside a pinned bottom container with a gradient fade.
- `src/pages/Dashboard.tsx` does **not** render any chat composer itself today — the "Message your workforce…" bar the user sees is `GlobalChatBar`, and the 5 avatars are `OperativeDock`, both global.
- `ChatComposerPro` is also used inside `ChatWorkspace` (the drawer). That instance must keep working unchanged.

Conflict to flag (not fixing this pass): after this pass, the dashboard will show **two** composers — the new in-flow hero and the legacy bottom `GlobalChatBar`. Per the brief, legacy stays until a later pass.

## What gets built (Job 2 + 3)

New component: `src/components/dashboard/HeroCommandSurface.tsx`.

Rendered from `Dashboard.tsx`, slotted between the welcome header and the KPI metrics row (≈ 1/3 down the page, in the natural flow — not fixed positioning).

### Composition

```text
┌──────────────────────────────────────────────────────────┐
│  [chip] [chip] [chip] [chip]      (fade out on focus)    │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  rotating placeholder / user text                  │  │
│  │                                                    │  │
│  │                          [A][S][P][H][Sc] [+]  ↵   │  │
│  └────────────────────────────────────────────────────┘  │
│   glass-surface, radius 16, ambient emerald glow         │
└──────────────────────────────────────────────────────────┘
```

- Outer wrapper: `max-w-3xl mx-auto`, vertical padding so it breathes.
- Inner surface: `.glass-surface rounded-2xl p-5 sm:p-6`, min input zone 72px, total ~150px with chips.
- Ambient glow: an absolutely-positioned sibling using `shadow-emerald-glow` at low opacity by default, animated up to ~28% on focus via framer-motion.

### Rotating placeholder

`useEffect` + `setInterval(4000ms)` cycling 5 strings, framer-motion `AnimatePresence` cross-fade (300ms). Pauses while value is non-empty or input is focused; resumes 2s after blur with empty value.

Strings: as specified in the brief.

### Suggestion chips

4 hardcoded chips above the input. Pill buttons, `.glass-surface` lighter variant (just `.glass-surface` with reduced padding), `text-mono-label`, hover `scale-1.02` + soft glow (framer-motion `whileHover`). Click sets composer value and focuses input. Chips fade out (`AnimatePresence`, 200ms) when input is focused; horizontal scroll on mobile (`overflow-x-auto`, `flex-nowrap`).

### Agent presence row (inside input, right-aligned)

5 agents from `AGENT_PROFILES` (or `dockAgents`). 24px circular initial badges reusing the existing `InitialCircle` style from `ChatComposerPro`. Static "ready" ring: 1.5px emerald at 60% opacity, `animate-pulse`-style 3s breathe (custom keyframe in component or reuse existing). Wrapped in shadcn `Tooltip` → "{Name} — ready". Trailing 28px `+` button, lower contrast.

Mobile (<768px): first 3 avatars + `+2` chip.

### Submit affordance

- No send button on desktop. Right edge of input shows `Enter ↵` in `text-mono-label`, fades in when `value.trim().length > 0`.
- Enter submits, Shift+Enter newline (same as today).
- Mobile (<768px): small emerald arrow icon (24px) replaces the Enter hint, tappable.

### Focus dim (the centerpiece)

- A single `motion.div` rendered at the dashboard root, `fixed inset-0 bg-black pointer-events-none z-[15]`, animating opacity `0 → 0.6` (desktop) / `0 → 0.4` (mobile) over 250ms ease-out when the hero input is focused.
- Hero surface sits at `z-20` so it stays above the dim.
- The page grid background sits below the overlay, so it dims with everything else — no separate logic needed.
- `GlobalChatBar` is `z-20` today and would compete; we'll lift the hero overlay to `z-30` and the hero surface to `z-40` so the legacy bar dims correctly without code changes to it.
- Focus state is tracked in `HeroCommandSurface` local state; the overlay is rendered as a portal-less sibling at the top of the component tree (returned alongside the surface inside a fragment).

### Wiring to backend

Reuse `chatRespond` and `useChatWorkspace` exactly like `ChatComposerPro` does — copy the submit logic verbatim so chat persistence keeps working. No backend changes.

## Files modified

- `src/components/dashboard/HeroCommandSurface.tsx` — new component (≈ 300 lines).
- `src/pages/Dashboard.tsx` — import + render `<HeroCommandSurface />` between the welcome header and the KPI row.

## Files inspected, not changed

- `src/components/MainLayout.tsx`, `src/components/chat/GlobalChatBar.tsx`, `src/components/chat/workspace/ChatComposerPro.tsx`, `src/components/dock/OperativeDock.tsx`.

## Out of scope (per brief)

- Removing `GlobalChatBar` or `OperativeDock` — Pass 5+.
- Wiring real agent status, real suggestion generation, morning brief — Pass 3/4.
- Any change to landing pages, ChatWorkspace drawer, or sidebar.

## Verification

- `npx tsc --noEmit` — zero new errors.
- Manual: focus dims rest of page, blur restores, placeholder rotates, chips populate input, Enter submits and persists to conversations table (existing path through `chatRespond`).

## One open question

The brief says "leave `GlobalChatBar` if mounted." Confirmed it is mounted globally on every page including `/dashboard`. That means the dashboard will visibly have **two** composers after this pass (new hero in-flow, legacy bar at the bottom). Acceptable per the brief, or do you want me to conditionally hide `GlobalChatBar` only on `/dashboard` for this pass? Default: leave it visible.
