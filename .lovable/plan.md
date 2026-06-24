
# Premium Workflow Center Redesign

Visual-only upgrade to `/workflows`. No changes to registry, routing, run flow, readiness logic, edge functions, or DB. No migrations.

## Scope (UI only)

Files to edit:
- `src/pages/Workflows.tsx` — restructure layout
- `src/components/workflows/WorkflowCard.tsx` — premium card with thumbnail
- `src/components/workflows/AgentAvatar.tsx` — reused (no logic change)

Files to create:
- `src/components/workflows/WorkflowThumbnail.tsx` — symbolic SVG visual per workflow
- `src/components/workflows/FeaturedWorkflowCard.tsx` — larger "Start here" tile
- `src/components/workflows/StatStrip.tsx` — hero metric strip
- `src/components/workflows/CategoryRail.tsx` — polished left nav with icons
- `src/components/workflows/FilterChips.tsx` — Recommended/Ready/Setup/Coming soon/Recent chips
- `src/lib/workflows/visualMeta.ts` — per-workflow icon + accent + thumbnail variant + agent accent map

No new dependencies. Uses existing lucide-react + framer-motion + tailwind tokens (emerald accents, glass surfaces).

## Page Structure

```text
┌─────────────────────────────────────────────────────────────┐
│ HERO                                                        │
│  WORKFLOW CENTER (eyebrow)        [Ask Pilot about page]    │
│  Workflows                                                  │
│  Run repeatable AI employee playbooks…                      │
│  ┌──────┬──────┬──────┬──────┐                              │
│  │ Recm │Ready │Setup │ Runs │  ← StatStrip (glass)         │
│  └──────┴──────┴──────┴──────┘                              │
├─────────────────────────────────────────────────────────────┤
│ [🔍 Search workflows… (large)]   [Agent ▾]   [Sort ▾]       │
│ [All] [Recommended] [Ready] [Setup] [Coming soon] [Recent]  │
├──────────────┬──────────────────────────────────────────────┤
│ CATEGORY     │  Start here  (cat='all', !query, !filter)    │
│  RAIL        │  ┌────────────┬────────────┬────────────┐    │
│ All        n │  │ Featured 1 │ Featured 2 │ Featured 3 │    │
│ Growth     n │  └────────────┴────────────┴────────────┘    │
│ Research   n │                                              │
│ Outreach   n │  Recommended for your company                │
│ Content    n │  Based on your Company Brain…                │
│ Competitor n │  [card] [card] [card] [card]                 │
│ Operations n │                                              │
│              │  Growth · 4                                  │
│ Recent runs  │  [card] [card] [card]                        │
│ ─────────    │  Research · 3                                │
│ • run 1      │  …                                           │
│ • run 2      │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

## Components

### WorkflowThumbnail (symbolic visual)
Pure SVG, no images. Takes `variant` keyed by workflow id with sensible fallback by `outputType`. Variants:

- `radar` — concentric pulse rings + dots (hiring signals)
- `target` — crosshair + matched nodes (ICP match)
- `org` — tree of contact nodes (decision-makers)
- `stack` — layered cards (enrich companies)
- `lens` — magnifier over a card (research company)
- `browser` — window mock with highlighted bars (audit)
- `message` — composer card with line ruler (outreach draft)
- `wave` — phone waveform (cold call openers)
- `feed` — content tile w/ paragraphs (LinkedIn post)
- `briefing` — report sheet with timeline (weekly update)
- `versus` — two stacked rows (competitor)
- `gear` — operations default

Each variant renders with the workflow's agent accent (emerald/violet/amber/blue/rose/green), uses subtle radial glow background, soft inner border, and a faint Agentory grid underlay. ~110px tall, full-width of card. Hover: thumbnail brightens slightly (CSS only), no movement.

### WorkflowCard (rebuilt)
Layout:
```
┌──────────────────────────┐
│ [thumbnail w/ glow]      │  ← WorkflowThumbnail
├──────────────────────────┤
│ [Recommended] [Ready]    │  ← top badges row
│ Title                    │
│ Short description (2L)   │
│ "Selected during onb."   │  ← optional reason (subtle emerald)
├──────────────────────────┤
│ [avatars]  Lead table · 5│
│ Run workflow         →   │  ← hover-reveal underline + chev
└──────────────────────────┘
```
- Glass surface: `bg-white/[0.025] backdrop-blur-xl`, border `border-white/[0.08]`, hover `border-emerald-500/35 + soft glow + lift (translate-y-[-2px])`.
- Setup needed: amber wrench chip + bottom "Configure provider →" line (not alarming).
- Coming soon: muted, no hover lift, "Notify me when ready" hint (static, no action change).
- Heights normalize with `min-h` per row.

### FeaturedWorkflowCard ("Start here")
Larger horizontal card (col-span flexible), bigger thumbnail (~160px), title at 20px, short why-recommended reason, agent row + CTA. Uses top 2–3 from `recommendWorkflows()` (existing logic).

### StatStrip
Four glass tiles:
- Recommended (count of `recommended.length`)
- Ready (`WORKFLOWS.filter(status==='ready').length`)
- Setup needed (count)
- Recent runs (recent.length)

Pure derived counts — no fetches, no new state.

### CategoryRail
- Icon per category (Sparkles=Growth, Search=Research, Send=Outreach, FileText=Content, Swords=Competitor, Settings=Operations)
- Selected: emerald glass background, left emerald bar, semibold
- Hover: soft white/3 background
- Count chip right-aligned, tabular-nums

### FilterChips
Toolbar chips that filter `filtered` array client-side:
- All / Recommended / Ready / Setup needed / Coming soon / Recently used
- Only adds local `chip` state in `Workflows.tsx`; merges into existing filter pipeline.
- Sort dropdown: Recommended (default) / Most used (uses lastRunByWorkflow count) / Newest (registry order) / Ready first.

## Typography
- Page title: `text-[34px] font-semibold tracking-tight` (was `text-page`)
- Eyebrow: unchanged
- Section headers: `text-[20px] font-semibold`
- Card title: `text-[17px]` → `text-[18px] font-semibold`
- Card desc: `text-[14.5px] text-neutral-300 leading-relaxed`
- Badges: `text-[11.5px]` consistent casing
- More vertical breathing room: gaps `gap-6` between sections, `gap-5` between cards.

## Motion
- Section fade-in via existing `animate-fade-in`.
- Card hover: 150ms transform/opacity/border. No bounce.
- Thumbnail glow tween on hover only via Tailwind `group-hover:opacity-*`.
- Filter chip transitions: 120ms color/border.

## Empty / unavailable states
- No filter match: keep current copy, upgrade to glass dashed panel with icon + "Clear filters" button (local state reset).
- Setup needed card: persistent amber line + "Open setup →" (links to `/integrations` if already used elsewhere; otherwise opens existing config panel — no new route).
- Coming soon: muted gray pill + "We'll light this up soon" caption.
- No recent runs: same copy in sidebar, slightly larger, with subtle Sparkles icon.

## Constraints honored
- Registry, capabilities, readiness, run dispatch, `pilotChat`, navigation untouched.
- No new backend calls, no edge fn, no DB, no migration, no landing page.
- No auto-send / auto-outreach.
- Pure presentational + minor local state (chip filter, sort).

## QA
- Typecheck.
- Existing tests pass (none target this page directly).
- Visual check at 1280 and 1440.
- Verify Run flow still dispatches via `WorkflowConfigPanel`.

## Out of scope
- Hover-preview output drawer (deferred).
- Standalone workflow detail route.
- Any persistence of chip/sort selection.
