## Goal
Transform the Workforce dock on `/dashboard` into a smooth, Apple-style magnifying dock with fluid hover physics — while keeping all current behavior (selection, badges, tooltip, department ring color).

## Scope
Only `src/components/workforce/WorkforceDock.tsx` (and a tiny CSS-only polish on its container). No logic, route, or data changes. Selection state, badge logic, and tooltip content stay identical.

## Design Direction
Apple macOS dock magnification:
- Cursor-proximity scaling: avatars near the pointer grow (up to ~1.55×), neighbors scale proportionally on a smooth bell curve, distant ones stay at base size.
- Subtle vertical lift on the hovered item (translateY -6px) so it appears to "pop" out of the rail.
- Spring physics (stiffness 280, damping 22, mass 0.5) — feels fluid, not stiff.
- Labels under each avatar fade/translate in only when that avatar is in the magnification zone (Apple-like reveal).
- The selected agent keeps its emerald ring and underline; the active glow intensifies when also hovered.
- Dock surface: deeper glass (`bg-white/[0.02]` + `backdrop-blur-2xl`), softer inner border, ambient bottom shadow `0 24px 60px -20px rgba(0,0,0,0.8)` so it floats.
- Rounded `rounded-2xl`, increased internal padding, items aligned to `items-end` so they grow upward (true dock behavior).
- Badges follow the avatar scale (transform-origin top-right) so they don't detach.

## Technical
- Use `framer-motion`'s `useMotionValue` + `useTransform` + `useSpring` driven by `onMouseMove` on the dock rail, exactly like `OperativeDock.tsx` already does in this codebase (proven pattern).
- Each item measures its center via `ref.current.getBoundingClientRect()` inside the `useTransform` to compute distance from cursor → maps to size via `[-140, 0, 140] → [BASE, MAX, BASE]`.
- `BASE = 44`, `MAX = 68`. Lift uses the same distance mapped to `[0, -6, 0]`.
- On `mouseLeave`, set mouseX to `Infinity` so all items spring back to base.
- Wrap the avatar (`AgentAvatar slug=...`) inside a `motion.div` with animated `width/height`; AgentAvatar already accepts a `size` prop but width/height on the wrapper is enough — keep AgentAvatar untouched.
- Keep keyboard focus ring and `aria-pressed` semantics intact.
- Mobile (touch / no hover): magnification disabled — items render at a fixed comfortable size (`size-12`), since `onMouseMove` won't fire. No regression.

## Out of scope
- `OperativeDock`, `AgentDock`, header, other layout sections.
- Any change to selection behavior, routing, or data flow.
- Visual changes to avatar artwork or badge content.

## Acceptance
- Hovering across the dock produces a smooth Apple-like wave of magnification.
- Selected agent still shows emerald ring + underline.
- Badges scale with their avatar and stay anchored.
- No layout shift in the rest of the page (dock height reserves max size).
- Touch devices show a clean, static dock with no broken hover state.
