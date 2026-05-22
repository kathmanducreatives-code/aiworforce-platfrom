# Visual Identity Overhaul — "Deep Space AI OS"

A foundation-level redesign of the product's color system, material language,
and atmosphere. Goal: shift the authenticated app from "premium SaaS dark"
toward an Anthropic / Apple Intelligence / Linear / Cursor register —
pitch-black, cinematic, calm, emerald-accented, glass used as a scalpel not a
sledgehammer.

This pass touches **tokens, atmosphere, glass system, and elevation only**.
It does NOT rewrite individual screens, the dashboard layout, the chat surface,
or landing pages. Those follow in subsequent passes once the foundation lands.

## Design principles (load-bearing)

1. **Pitch-black foundations.** Background `#050505`. Surfaces step up in
   single-digit luminance increments (`#0A0A0A`, `#101010`, `#161616`). No
   pure-white text — off-white `#EDEDED` primary, dimmer secondaries.
2. **Restrained emerald.** Emerald appears as accent, focus, and ambient glow
   only. Never as fill on large surfaces. Three stops: `#059669` (deep),
   `#10B981` (core), `#34D399` (highlight). Glows live at 8–18% alpha at rest,
   25% on focus. Never above 35%.
3. **Matte vs glass contrast.** Layout chrome (sidebar, page surfaces, cards)
   stays **matte and grounded**. Glass is reserved for floating intelligence
   surfaces: command dock, modals, popovers, agent overlays, focus states.
   This contrast is where the luxury lives.
4. **Light, space, typography over borders.** Hierarchy from luminance steps
   and spacing — not from `border-white/10` everywhere. Hairline borders
   reserved for true separation moments.
5. **Quiet motion.** Slow breathing glows (3–6s), 250–350ms ease-out
   transitions, opacity-led. No bounces, no spring overshoots, no particles.

## What changes in this pass

### 1. Token system rewrite (`src/index.css` + `tailwind.config.ts`)

Replace the current dark theme block (and the additive Pass 1 tokens) with a
single coherent **Deep Space** palette. Light theme stays untouched.

New semantic layers (CSS vars, all HSL where used through Tailwind):

```text
--space-0      #000000   true black (overlays, dim)
--space-1      #050505   app background
--space-2      #0A0A0A   structural panels (sidebar, topbar)
--space-3      #101010   cards, page sections
--space-4      #161616   raised surfaces, inputs
--space-5      #1F1F1F   hover / active row

--ink-primary  #EDEDED   primary text  (~93% luminance, never pure white)
--ink-secondary#9CA3AF   secondary text
--ink-muted    #6B7280   muted / metadata
--ink-faint    #3F3F46   disabled / placeholder

--hairline     rgba(255,255,255,0.06)   default border
--hairline-strong rgba(255,255,255,0.10) emphasized border
--edge-emerald rgba(16,185,129,0.30)    focused/active border

--emerald-deep  #059669
--emerald-core  #10B981
--emerald-glow  #34D399
--emerald-ambient rgba(16,185,129,0.08) -- background washes
--emerald-focus   rgba(16,185,129,0.25) -- focus glow
```

Tailwind mapping (`tailwind.config.ts`):

- `background` → `--space-1`
- `card`, `popover` → `--space-3`
- `muted` → `--space-4`
- `border` → `--hairline`
- `foreground` → `--ink-primary`
- `primary` → `--emerald-core` (foreground stays white)
- Adds `space-{0..5}`, `ink-{primary,secondary,muted,faint}`,
  `hairline`, `hairline-strong`, `edge-emerald`, `emerald-{deep,core,glow}`.
- Removes the ad-hoc legacy color names that conflict (`layer-0/1/2/3`,
  `border-hairline/soft/active`, `surface-elevated`, `surface-hover`,
  `text-tertiary` are renamed/aliased to the new tokens; old names are kept
  as aliases for one pass to avoid breaking screens we haven't redesigned).

Shadows (`tailwind.config.ts`):

```text
shadow-ambient        0 1px 2px rgba(0,0,0,0.4)
shadow-elevated       0 8px 24px -6px rgba(0,0,0,0.6), 0 0 0 1px var(--hairline)
shadow-floating       0 24px 64px -16px rgba(0,0,0,0.7), 0 0 0 1px var(--hairline)
shadow-emerald-soft   0 0 24px rgba(16,185,129,0.08)
shadow-emerald-focus  0 0 32px rgba(16,185,129,0.25)
```

The existing `shadow-emerald-glow`, `shadow-primary` etc. become aliases of
the new tokens so legacy components keep working.

### 2. Glass system — one utility, three intensities

Today there are at least 5 glass utilities (`.glass`, `.glass-strong`,
`.glass-surface`, `.glass-panel`, `.glass-card-landing`, `.glass-card-premium`)
with different blurs and tints. We collapse them to a disciplined set:

```text
.glass-quiet    bg rgba(255,255,255,0.025)  blur(20px)  border hairline
.glass-surface  bg rgba(255,255,255,0.04)   blur(24px)  border hairline + inset highlight
.glass-loud     bg rgba(255,255,255,0.06)   blur(32px)  border hairline-strong + inset highlight + emerald inner glow on focus
```

- `.glass-surface` keeps its current name (Pass 1 contract).
- Legacy class names (`.glass`, `.glass-strong`, `.glass-panel`,
  `.glass-card-premium`) are redefined as aliases pointing at the new three so
  nothing visually breaks.
- `.glass-card-landing` is left untouched — landing is out of scope.
- A new helper `.glass-focus-ring` adds the emerald inner glow on focus-within
  for command/AI surfaces, opacity 0 → 25% over 250ms.

### 3. Atmospheric background (`AuthenticatedBackground.tsx`)

Current background uses bright nebulae (`opacity 0.25/0.20/0.15`), a 140px
emerald grid, and three star layers — it reads "crypto dashboard" at the
brightness levels in use. Tone it down to "deep space observatory":

- Base: solid `--space-1` (`#050505`), not `#020202`.
- Two faint emerald nebulae only (top-center, bottom-right), radius 900px,
  blur 220px, **opacity 0.08–0.12 max**, breathing 12s (slower than current
  8s).
- Drop the third nebula and the inner-cell glow grid (overproduced).
- Keep one grid layer at `rgba(16,185,129,0.04)` lines, 160px cells, drift 90s
  (slower). Drop the intersection-dot layer.
- Starfield: one layer of off-white dots `rgba(255,255,255,0.18)` at 200px
  spacing, one layer of emerald micro-dots `rgba(16,185,129,0.12)` at 280px,
  one slow twinkle layer at `0.10` cycling 6s. Total brightness budget cut
  ~40%.
- Light theme: background becomes solid `#FAFAFA`, all atmosphere layers off
  (currently they render at `opacity:0.35` which is muddy).

### 4. Typography polish

No new fonts. Tighten the existing scale:

- Body color shifts from `0 0% 93%` → off-white via `--ink-primary` so we
  never hit pure white.
- Add `.text-body` (15px / 1.55 / `--ink-secondary` default for prose),
  `.text-meta` (12px / `--ink-muted` / +0.02em tracking), to discourage
  ad-hoc `text-sm text-white/70` usage in later passes.
- `.text-mono-label` stays.

### 5. Focus & motion primitives

Add four reusable utilities so per-component passes don't reinvent them:

```text
.focus-ring-emerald  outline 1px var(--emerald-core), offset 2px, glow 25%
.breathe-slow        opacity 0.7 → 1.0 over 4s ease-in-out infinite
.breathe-emerald     box-shadow var(--shadow-emerald-soft) → -focus, 6s
.transition-cinematic transition all 250ms cubic-bezier(0.16,1,0.3,1)
```

## What does NOT change

- No component files are edited. No screen redesigns. Sidebar, dashboard,
  cards, dock, chat surface keep their current markup — they'll just inherit
  the new tokens and feel calmer immediately.
- Landing pages (`/`, marketing routes, anything under
  `src/components/landing/`) — completely untouched.
- Light theme palette — untouched.
- No new npm dependencies.
- No git operations.

## Technical details

- `src/index.css`: edits the `:root` and `[data-theme="dark"]` blocks (new
  CSS vars), rewrites `.glass*` utilities, adds typography + motion helpers.
  Keeps all existing keyframes and animation classes.
- `tailwind.config.ts`: extends `colors`, `boxShadow`, leaves `keyframes` /
  `animation` / `fontFamily` alone. Old color keys aliased, not removed.
- `src/components/AuthenticatedBackground.tsx`: parameter tweaks only —
  fewer layers, lower opacities, slower animations.
- `tsc --noEmit` clean at end.

## Verification

After the pass: open `/dashboard`, expect background noticeably darker and
quieter, sidebar matte, glass dock floats with subtle emerald rim, text feels
softer (not bright white), no visible layout shifts, no broken components.
Hover/focus states on the dock pick up the new ambient emerald glow.

## Files touched

- `src/index.css`
- `tailwind.config.ts`
- `src/components/AuthenticatedBackground.tsx`

## Out of scope (next passes)

- Pass A: Sidebar visual refresh on top of new tokens.
- Pass B: Card / page-surface refresh (KPIs, tables, lists).
- Pass C: Command dock glass refinement + focus glow wiring.
- Pass D: Modals, dialogs, popovers.
- Pass E: Landing page (separate decision — explicitly excluded today).
