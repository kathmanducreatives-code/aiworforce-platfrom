
# Agentory Premium Polish — Typography, Spacing & Hierarchy

A visual/design-system pass only. No layout restructure, no backend changes, no migrations, no removal of any existing feature (Workflows, Workbench, dock, sidebar, avatars all stay). Landing page untouched.

## 1. Foundation — design tokens (single source of truth)

Edit `src/index.css` and `tailwind.config.ts` to introduce typography + radius tokens and bump the base size.

```css
:root {
  /* type scale */
  --font-micro: 12px;
  --font-xs:    13px;
  --font-sm:    14.5px;
  --font-base:  15.5px;
  --font-md:    17px;
  --font-lg:    20px;
  --font-xl:    28px;
  --font-page:  36px;

  /* line-height */
  --line-tight:   1.25;
  --line-normal:  1.55;
  --line-relaxed: 1.70;

  /* radii */
  --radius-control: 12px;
  --radius-card:    20px;
  --radius-panel:   24px;
  --radius-dock:    24px;

  /* text contrast (HSL, dark theme) */
  --text-primary:   0 0% 98%;
  --text-secondary: 0 0% 78%;   /* was ~65% — brighter */
  --text-tertiary:  0 0% 60%;
  --text-disabled:  0 0% 40%;
}

html, body { font-size: 15.5px; line-height: var(--line-normal); }
```

Add Tailwind utilities mapped to these tokens (`text-micro`, `text-sm-plus`, `text-base-plus`, `text-md`, `text-lg-plus`, `text-page`, plus `rounded-card`, `rounded-panel`, `rounded-dock`). Keep existing classes working — just add the new ones and migrate hotspots.

Add an `.eyebrow` utility refresh: 13.5px, `tracking-[0.16em]`, `text-secondary/80`.

## 2. Sidebar (`src/components/Sidebar.tsx`)

- Nav label: 13px → **14.5px**, weight 500; active item weight 600 + emerald glow already present.
- Increase row vertical padding by 2px, group gap +4px.
- Inactive icon/text contrast: `text-neutral-400` → `text-neutral-300`.
- PRO badge: subtle emerald gradient border, 11.5px uppercase, slightly more padding.

## 3. Dashboard polish

Files: `src/pages/Dashboard.tsx`, `src/components/workforce/PilotBriefing.tsx`, `src/components/workforce/WorkforceDock.tsx`, `src/components/workforce/DepartmentPreview.tsx`.

- **PilotBriefing**: headline → 20px/600, bullets 15.5px with `line-relaxed`, "Next move" promoted to its own callout chip (emerald border, 14.5px).
- **WorkforceDock**: agent label 10.5px → **12px**, badge text 9.5px → **11px**, base avatar 44→48, max 68→72. Hover tooltip text 11.5→13px.
- **DepartmentPreview**: section title 18→20px, metric numbers ~22→28px, metric labels 11→13px, more breathing room (`gap-5` → `gap-6`).
- Section eyebrow "Workforce" uses new `.eyebrow` token.

## 4. Workflows page (`src/pages/Workflows.tsx`, `src/components/workflows/WorkflowCard.tsx`)

- Add "Workflow Center" eyebrow badge above the page title.
- Page title 28→**36px**, subtitle **15.5px**, search input text **15.5px** with h-11.
- Category chips 13→**14.5px**.
- **WorkflowCard**: padding `p-4` → `p-5`, title 14→**17px/600**, description 12→**14.5px** with `line-clamp-3`, agent avatars 22→**26px**, metadata row 10→**12.5px**, status chip 10→**12px**.
- Recommended cards: subtle animated emerald inner glow (CSS-only, no JS).
- Section heading "Recommended" 13→**18px** with eyebrow above.
- Card radius standardized to `rounded-card` (20px).

## 5. Command dock (`src/components/workforce/InlineCommandBar.tsx` + `WorkforceDock` if relevant)

- Container padding p-4 → p-5, radius → `rounded-dock`.
- Input text 14 → **15.5px**, placeholder same, height bump.
- Chips 11 → **13px**, h-7 → h-8, gap-1.5 → gap-2.
- Submit button 32→36px, icon 16→18px.
- Soft glass: `bg-white/[0.03]` + stronger `backdrop-blur-2xl` + inner highlight ring.

## 6. Workbench polish

Identify primary Workbench files via `rg "Workbench"` and update table + chrome (no logic change):

- Table header: 11px uppercase → **12.5px** with `tracking-[0.12em]`.
- Table body cell: 13 → **14.5px**, row height +6px.
- Status chips: 11 → **12.5px**, +2px padding.
- Tabs: 13 → **15px**, h-9 → h-10.
- Workbench panel title: 16 → **19px**.
- Recommendation banner copy 13 → **15px**, icon size up.

## 7. Cards, chips, hierarchy

- Replace hard `bg-black/60` card surfaces with `bg-white/[0.025]` + `border-white/[0.08]` + subtle inner highlight (`shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]`).
- Recommended/active state: emerald 1px border + soft outer emerald glow.
- Standardize radius via tokens (controls 12, cards 20, panels/dock 24).
- Audit muted text: bump `text-neutral-500` → `text-neutral-400` where used for secondary content.

## 8. Truncation & responsive

- Add `truncate`/`line-clamp-*` only where overflow is a real risk; widen sidebar by 8px if labels clip at 14.5px.
- Visual QA via Playwright headless at 1024, 1280, 1440 widths on `/dashboard`, `/workflows`, `/workbench` (or equivalent). Capture screenshots, verify no horizontal overflow, no clipped CTAs, dock not covering content.

## 9. Extras

- Hover preview on agents already exists in `WorkforceDock` — only resize and tighten copy.
- Recent-runs empty state copy update on Workflows page.
- "LIVE" indicator: 10→**12px**, consistent dot+label component.

## Files expected to change

- `src/index.css`, `tailwind.config.ts` (tokens, utilities)
- `src/components/Sidebar.tsx`
- `src/pages/Dashboard.tsx`
- `src/components/workforce/PilotBriefing.tsx`
- `src/components/workforce/WorkforceDock.tsx`
- `src/components/workforce/DepartmentPreview.tsx`
- `src/components/workforce/InlineCommandBar.tsx`
- `src/pages/Workflows.tsx`
- `src/components/workflows/WorkflowCard.tsx`
- Workbench component(s) — discovered during implementation
- Minor: shared chip/badge styles if centralized

## Out of scope

Landing page, routing, backend functions, DB, RLS, agent ownership logic, Workflows registry, chat orchestration.

## QA

- `tsgo` typecheck + build.
- Playwright screenshots at 1024 / 1280 / 1440 on dashboard, workflows, workbench, dock open.
- Visual diff vs current preview — confirm: bigger but still dense; no clipping; no horizontal scroll; emerald accents intentional.

## Deliverable

A short report listing files changed, token additions, before/after font sizes for each surface, QA screenshots, and any residual gaps (e.g. tables that need a deeper redesign beyond a polish pass).
