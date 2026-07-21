# Lead Library premium redesign

Transform `/leads` from a plain table page into a premium dark glassmorphic lead operations desk, with Atlas — AI Account Analyst as the featured on-page AI employee. Purely presentational: no changes to `useLeadLibrary`, filter/status logic, routing, Supabase, providers, or types.

## Scope guardrails
- Do not touch: `src/hooks/leadLibrary/*`, `src/lib/leadLibrary/*`, edge functions, migrations, `LeadDetailDrawer` data flow, existing filter/status logic (only its visual chrome).
- Keep every existing action, tab, filter, bulk action, and CSV export wired to their current handlers.

## Design system additions (page-scoped)
Introduce a shared visual language reused across all sections, kept in a small module so it doesn't touch global tokens.

New file `src/components/leads/library/premium/tokens.ts`:
- `glassSurface`, `glassSurfaceRaised`, `glassBorder`, `accentGlow`, `innerHighlight` — Tailwind class strings.
- Shared radius (`rounded-2xl`), shadow (`shadow-[0_20px_60px_-30px_rgba(16,185,129,0.35)]`), edge highlight (`before:` overlay).

New file `src/components/leads/library/premium/GlassPanel.tsx`:
- Reusable panel with translucent charcoal base, top-left edge highlight, subtle emerald inner glow, optional `active` variant.

New file `src/components/leads/library/premium/CommandBackdrop.tsx`:
- Page-level backdrop layer: near-black gradient + faint grid (SVG data URL) + one soft emerald radial glow top-right. Absolute, `pointer-events-none`.

## Atlas AI employee
New file `src/components/leads/library/premium/AtlasPanel.tsx`:
- Compact glass card, ~320px wide on desktop, collapsing to a slim strip on <lg.
- Portrait avatar (generated), name "Atlas", title "AI Account Analyst".
- Support line: "Researches every account and ranks the best opportunities."
- Capability chips: Research · Qualification · Ranking · Signals.
- "Atlas active" pulse dot (pure CSS, no data change).
- Three mini metrics derived from the already-loaded `rows` (leads indexed, drafts ready, contacted) — reads existing data only, no new queries.

Generate portrait asset:
- `src/assets/atlas-portrait.png` — premium editorial avatar of a calm analyst figure, dark teal/emerald ambient lighting, transparent-adjacent dark background so it composites into the glass card.

## Page redesign (`src/pages/LeadLibrary.tsx`)

Layout becomes a 12-col grid on desktop:

```text
┌───────────────────────────────────────────────────────────┐
│ Command backdrop (grid + glow)                            │
│ ┌──────── Header ────────────────────────┐ ┌─ Atlas ────┐ │
│ │ Lead Library                            │ │ portrait  │ │
│ │ description + agent attribution chip    │ │ name+title│ │
│ │ [search] [Add][Import][Export][+List]   │ │ chips     │ │
│ └─────────────────────────────────────────┘ │ mini stats│ │
│                                             └───────────┘ │
│ Premium metric strip (7 glass cards, active = emerald)    │
│ Segmented glass tabs                                      │
│ ┌── Filter panel (titled "Refine lead view") ──────────┐  │
│ └──────────────────────────────────────────────────────┘  │
│ Table container (glass, illuminated rows, premium chips)  │
│ Bottom command bar (refined glass)                        │
└───────────────────────────────────────────────────────────┘
```

- Actions row: primary "Create list" uses luminous emerald gradient with subtle sheen; others become dark-glass outline buttons with emerald icon accents.
- Small "Atlas organized this lead library" attribution chip under the title.
- Featured Atlas panel sits in header right on `lg+`, moves below actions on `md`, collapses to a slim horizontal strip on `sm`.

## Component-level changes

`MetricStrip.tsx` (redesign):
- 7 uniform-height glass metric cards, subtle inner gradient, edge highlight, hover lift.
- Active card: emerald border glow + inner emerald wash + brighter number.
- Large tabular number, small uppercase-tracked label, tiny helper subline.

`FilterBar.tsx` (visual refresh only):
- Wrap in `GlassPanel` with heading "Refine lead view".
- Group: [search] · [dropdowns] · [chips] · right-aligned "Save view".
- Unified 32px control height, focus ring emerald, chip capsules.

`LeadTable.tsx` (styling only, no column/behavior changes):
- Header: uppercase 11px, tracked, translucent divider.
- Row: 48px, hover = subtle emerald-tinted illumination, selected = emerald left border + soft wash.
- Company cell: company name (medium) + domain (muted 11px) + tiny external-link icon.
- Status/readiness/next-step cells: upgraded to premium capsule chips via new `StatusPill` variants (extend existing file, add tones without removing any).
- "Selected Buyer" missing state: dashed emerald outline chip labeled "Buyer needed".
- Optional tiny "Qualified by Atlas" attribution tag in the fit column when `accountStatus === "qualified"`.

`StatusPill.tsx`:
- Add `variant="glass"` returning pill with translucent bg + border glow tuned per tone; keep existing default variant so other consumers stay intact.

`BulkActionBar.tsx` / bottom command bar:
- Floating glass bar, stronger blur, refined chip styling, agent avatar (Atlas mini) on the left, Enter affordance on the right. Same actions, same handlers.

Loading state:
- Replace spinner block with 8 glass skeleton rows (shimmer) and caption "Atlas is reviewing leads…".

Empty states:
- New `AtlasEmptyState` component: soft glass card, small Atlas mark, contextual copy ("Atlas can help you start building your lead library."), keeps existing CTAs implicit (users still use header actions).

## Responsive
- `lg+`: header row (title/actions) + Atlas side card.
- `md`: Atlas panel drops beneath actions, full width, mini metrics inline.
- `sm`: Atlas becomes a single-line strip (avatar + name + pulse); filter chips wrap; table gets horizontal scroll wrapper (already present via overflow — verify).

## Files touched
- Modify: `src/pages/LeadLibrary.tsx`, `src/components/leads/library/MetricStrip.tsx`, `src/components/leads/library/FilterBar.tsx`, `src/components/leads/library/LeadTable.tsx`, `src/components/leads/library/StatusPill.tsx`, `src/components/leads/library/BulkActionBar.tsx`.
- Create: `src/components/leads/library/premium/{tokens.ts,GlassPanel.tsx,CommandBackdrop.tsx,AtlasPanel.tsx,AtlasEmptyState.tsx,PremiumSkeleton.tsx}`.
- Asset: `src/assets/atlas-portrait.png` (generated).

## Verification
- Typecheck passes (auto).
- Manual: `/leads` renders — header + Atlas panel, metric strip active state, tabs, filter panel, table hover/selected, bulk bar, empty + loading states. Existing handlers (add/import/export/create list/save view/select/open lead) still fire.
- Screenshot header, metrics, filter, table, Atlas panel, bottom bar via Playwright and attach to the summary.
