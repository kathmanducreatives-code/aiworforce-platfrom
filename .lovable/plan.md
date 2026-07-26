# Sidebar refinement plan

Scope: visual + information architecture only. No routes, backend, permissions, or page logic change. Edits limited to `src/components/Sidebar.tsx` (and, if needed, minor token tweaks in the same file).

## 1. Navigation structure

Rebuild `navGroups` in `src/components/Sidebar.tsx` to this exact order and grouping:

- **COMMAND**
  1. Dashboard → `/dashboard` (icon: LayoutDashboard)
  2. Pilot → `/dashboard` (icon: MessageSquare) — visible label renamed from "Conversations"; route + behavior preserved
  3. Awaiting You → `/awaiting-you` (icon: Inbox, badge)
  4. Workflows → `/workflows` (icon: Workflow)
- **GROWTH**
  5. Signals → `/signals` (Radar)
  6. Leads → `/leads` (Users)
  7. Content → `/content` (BookOpen)
  8. Competitors → `/competitors` (Eye)
  9. Email Sequences → `/email-sequences` (Mail) — moved out of Settings
- **AI WORKFORCE**
  10. Agents → `/agents` (Sparkles)
  11. Company Brain → `/company-brain` (Brain)
- **SYSTEM**
  12. Integrations → `/settings/integrations` (Plug)
  13. Settings — **omitted**: no top-level `/settings` route exists in `src/App.tsx`; per spec, don't invent it.

Update `TOUR_TAG_BY_LABEL` so the `sidebar-conversations` tag now keys off `Pilot`.

## 2. Single active state (fix duplicate highlight)

Dashboard and Pilot both point to `/dashboard`, so the current `NavLink` `isActive` lights both. Replace the `NavLink`-driven active with a manual, single-winner match:

- Read `pathname` via `useLocation()`.
- Compute `activeKey` once per render as the first item (in declared order) whose `path` matches — Dashboard wins for `/dashboard`; Pilot is never auto-active (it's a chat surface, not a distinct route).
- Render each row as `<Link>` (or keep `NavLink` but ignore its isActive) and apply active styles only when `item.key === activeKey`.
- Set `aria-current="page"` only on the active row → guarantees exactly one.

## 3. Active/inactive/hover styling

Strip the current heavy emerald border + glow. New tokens (inline Tailwind, no new CSS files):

- Active: `bg-white/[0.04]` tinted with the row's department accent at ~8% (`bg-emerald-500/[0.08]` etc.), left accent bar `w-[2.5px] h-5 rounded-r bg-<accent>-400`, label `text-white font-semibold`, icon `text-<accent>-300`. No outer border, no box-shadow glow.
- Inactive: icon `text-neutral-500`, label `text-neutral-300 font-medium`, bg transparent, no border.
- Hover: `hover:bg-white/[0.035] hover:text-white`, `transition-colors duration-150`.
- Focus-visible: `focus-visible:ring-1 ring-emerald-400/40` (keyboard visibility retained).

## 4. Department accent map

Attach an `accent` per item, used only for the active row's left bar + icon and the Awaiting You badge:

- Command (Dashboard, Pilot, Awaiting You, Workflows) → emerald
- Signals → teal
- Leads → amber (Atlas)
- Content → violet (Mira)
- Competitors → blue
- Email Sequences → emerald
- Agents, Company Brain → emerald
- Integrations → neutral

Icons remain neutral when inactive; accent is applied only on the active row.

## 5. Layout + density

- Sidebar width: `w-[256px]` expanded, `w-[68px]` collapsed.
- Row height: `h-11` (44px), `px-3.5`, `gap-3`, icon `h-[19px] w-[19px]`, label `text-[15px]`.
- Group heading: `text-[10.5px] uppercase tracking-[0.14em] text-neutral-500 px-3.5 mb-1.5`, no dividers.
- Between rows: `space-y-0.5`; between groups: `space-y-6` (~24px).
- Nav container: `py-3`, remove the current `space-y-6` inflation; drop the `overflow-y-auto` unless viewport is truly short (keep `overflow-y-auto` but on a min-height check — leave as `overflow-y-auto` since it only scrolls when needed).

## 6. Account header (ProfileMenu)

Keep `ProfileMenu` at top, reduce container padding to `px-2 py-2` and rely on ProfileMenu's own layout. No structural change to `ProfileMenu` itself.

## 7. Awaiting You badge

Compact right-aligned pill: `text-[11px] font-mono px-1.5 h-[18px] rounded bg-amber-500/10 text-amber-300 border border-amber-500/25`. Never brighter than active row (already true — active uses white label).

## 8. Credits card

Keep `CreditPill` pinned bottom. Wrap in a single clickable surface: subtle emerald tint `bg-emerald-500/[0.05] hover:bg-emerald-500/[0.08] border border-emerald-500/15 rounded-lg px-3 py-2`, shows icon + credit count + plan status. Click routes to `/settings/billing` (existing route). Collapsed state → icon-only 40×40 tile with count as small superscript pill.

## 9. Collapsed state

- Icons only, centered in 44×44 hit area.
- Preserve left accent bar on the active icon.
- `title` attribute on each button → native tooltip.
- Awaiting You badge remains as a small dot+count overlay top-right of the Inbox icon.
- Credits collapses to icon + tiny count.
- Focus order unchanged (still buttons/links).

## 10. Responsive

- Desktop (>=1024px): fixed sidebar as today.
- Small laptop (<=1366px height): reduce group gap to `space-y-5`. Still no internal scroll at 13" (13 rows × 44 + 4 headers × ~24 + header + footer ≈ 720px, fits in 800px viewport).
- Tablet / mobile: existing mobile shell (`MainLayout`) already handles drawer — no change here.

## 11. Accessibility

- Exactly one `aria-current="page"` (guaranteed by single `activeKey`).
- Icon-only collapsed buttons carry `aria-label={item.label}`.
- Group wrappers use `<nav aria-label="Command">` etc. via `role="group"` + `aria-label`.
- Badge count includes SR text: `<span className="sr-only">pending</span>`.
- Contrast: neutral-300 on `#050505` ≥ 4.5:1.

## 12. Validation

- Manual: only one row highlighted on `/dashboard`, `/signals`, `/leads`, `/content`, `/competitors`, `/email-sequences`, `/settings/integrations`, `/workflows`, `/awaiting-you`, `/company-brain`, `/agents`.
- `tsgo` clean.
- Playwright screenshots at 1440×900, 1280×800, 1280×720 (short), plus collapsed variants — saved under `/tmp/browser/sidebar/`.

## Files touched

- `src/components/Sidebar.tsx` — rewrite `navGroups`, active-state logic, styling, credits wrapper.

No other files, no migrations, no edge functions.
