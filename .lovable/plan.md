# Dashboard Refinement Plan — Linear/Raycast Density Pass

Goal: tighten, widen, and mature the existing dashboard. No IA changes. Same modules: Company Brain strip, Pilot Briefing, AI Workforce Dock, Department Preview, Workflow Timeline, bottom Command Bar (AgentDock).

## 1. Layout & width

`src/pages/Dashboard.tsx`
- Replace the centered `max-w-[1100px]` + nested `max-w-[920px]` columns with a single workspace container: `max-w-[1440px]`, `px-6 lg:px-8`, `py-6 pb-32`. No inner re-centering.
- Switch the main area to a 12-column grid (`grid grid-cols-12 gap-5`) so modules can span full width and sit on a shared rhythm.
- Reduce ambient glows: drop the second blur, lower opacity of the first (`bg-emerald-500/[0.06]`, `blur-[160px]`), and shrink it so it reads as atmosphere, not decoration.
- Vertical rhythm: `space-y-5` between sections (was `space-y-8`).

Section spans on the grid:
- Company Brain strip: `col-span-12`
- Pilot Briefing: `col-span-12` (component itself reflows internally)
- Workforce Dock: `col-span-12`
- Department Preview: `col-span-12` (internal 3-zone layout — see §3)
- Handoff Strip: `col-span-12`, compact inline row
- Workflow Timeline: `col-span-12`

## 2. Workforce Dock refinement

`src/components/workforce/WorkforceDock.tsx`
- Remove the outer extra glass wrapper added in `Dashboard.tsx` (avoid double surface). Dock becomes the single surface.
- Reduce avatar size from 68px to 52px; reduce gap from `gap-5` to `gap-3`; reduce padding to `px-4 py-3`.
- Replace the circular glossy "toy" buttons with a flatter look: 12px radius squircle (`rounded-2xl`), subtle 1px border, no inner radial highlight, no scale-up on hover (use a 1px ring + faint background tint instead). Selected state = thin accent ring (`ring-1`) in agent hex + small accent underline bar beneath the label.
- Badges: shrink to 16px, neutral slate background with accent text for counts; reserve red only for true errors (`!` stays amber).
- Labels: single line, `text-[11px]` semibold, uppercase tracking `0.08em`, drop the second role line into a tooltip only.
- Remove the `Add Agent` button from the dock (move concept to settings later) — reduces playful feel.
- Container: align-left on desktop (`justify-start`), keep horizontal scroll only on mobile.

`src/pages/Dashboard.tsx` header above dock: replace the centered "AI Workforce Dock / Choose an AI employee" copy with a left-aligned compact header: small uppercase eyebrow `WORKFORCE`, no subtitle, right-aligned `● Live` indicator at `text-[10px]`.

## 3. Department Preview as command panel

`src/components/workforce/DepartmentPreview.tsx`
- Convert to an explicit 3-zone grid: `grid-cols-[280px_1fr_220px]` on `lg`, stack on mobile.
  - Left: identity (icon 48px not 64px, title, subtitle, plus one-line "Currently:" status line pulled from `AgentState.statusText`).
  - Middle: stats laid out as a 4-column inline KPI row (`grid-cols-4 gap-4`), each KPI = uppercase 10.5px label + 20px tabular number; thin divider lines between columns instead of card backgrounds.
  - Right: vertical action stack, primary CTA flatter (solid accent at 90% opacity, no glow), secondary as ghost buttons; max 3 actions.
- Card chrome: `rounded-xl` (was `2xl`), border `white/[0.06]`, background `white/[0.015]`, remove the heavy inset highlight + drop shadow; keep only a soft `shadow-black/40`.
- Remove per-agent ring glow on the icon tile; use a 1px colored border + 1px inner accent line only.

## 4. Pilot Briefing, Handoff Strip, Workflow Timeline

Light refinement only (no structural rewrite):
- `PilotBriefing`: reduce internal padding to `p-5`, tighten heading to `text-[15px]`, body `text-[13px]`, neutralize any gradient backgrounds to the same `white/[0.02]` surface used by Department Preview for visual consistency.
- `WorkforceHandoffStrip`: render inline at full width, left-aligned, smaller chips (`h-7 text-[11px]`), arrows `text-neutral-600`. Remove the wrapping `flex justify-center`.
- `WorkflowTimeline`: widen to full grid width, switch list rows to a 2-column meta layout (`time | actor | event`), monospace timestamps `text-[11px] text-neutral-500`, row height ~32px, hairline dividers `border-white/[0.04]`. Cap height with internal scroll if >8 items.

## 5. Typography & token discipline

`src/index.css` (additive only, no token renames):
- Add utility classes `.eyebrow` (uppercase, `text-[10.5px]`, `tracking-[0.14em]`, `text-neutral-500`) and `.num` (`font-variant-numeric: tabular-nums`).
- Apply consistently to all KPI labels and timestamp/number values across the four components above.
- Heading scale used on the dashboard: section title `text-[13px] font-semibold` (eyebrow style), card title `text-[15px] font-semibold tracking-tight`, KPI value `text-[20px] font-semibold`. No `text-2xl+` on this page.

## 6. Bottom Command Bar (AgentDock)

`src/components/workforce/AgentDock.tsx`
- Shrink avatar to 36px (was 44px), padding to `px-2.5 py-1.5`, gap `gap-1.5`.
- Flatter surface: `bg-neutral-950/70` + `border-white/[0.06]`, remove the inset white highlight.
- Tooltip: tighter (`w-56`, `p-2.5`, `text-[11.5px]`), no accent text — use neutral hierarchy, single accent dot for status.
- Remove hover `scale-110` / `-translate-y-1`; replace with subtle `bg-white/[0.04]` on hover. No motion on the dock itself.
- Drop the "Add agent" plus button here as well (consistency with §2).

## Scope guardrails

- No route changes, no removed sections, no business logic edits.
- No new dependencies.
- Keep semantic tokens; no hardcoded hex outside the existing per-agent `ringHex` accents (already in `departmentConfig.ts`).
- Mobile: every section stacks; dock and handoff strip allow horizontal scroll; no horizontal page scroll.

## Files touched

- `src/pages/Dashboard.tsx` — layout, container width, grid, ambient bg, headers
- `src/components/workforce/WorkforceDock.tsx` — flatter, smaller, left-aligned, no Add
- `src/components/workforce/DepartmentPreview.tsx` — 3-zone command panel, KPI row, lighter chrome
- `src/components/workforce/AgentDock.tsx` — compact Raycast-style command bar
- `src/components/workforce/WorkforceHandoffStrip.tsx` — inline, smaller chips
- `src/components/workforce/WorkflowTimeline.tsx` — full-width log layout, mono timestamps
- `src/components/workforce/PilotBriefing.tsx` — spacing + type only
- `src/index.css` — `.eyebrow`, `.num` utility additions

## Acceptance check

- Main content fills up to 1440px and visibly anchors left/right at ≥1280px viewport.
- No section is centered inside a narrower inner column.
- Dock avatars ≤ 52px; no scale-on-hover; selected state = thin accent ring only.
- Department Preview shows identity | KPI row | actions on one row at `lg`.
- Bottom command bar avatars ≤ 36px.
- No `text-2xl+` headings on dashboard; KPI numbers use tabular nums.
- Typecheck clean.