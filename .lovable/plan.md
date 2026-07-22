# Lead Library — Minimal Premium Workspace Redesign

Frontend-only redesign of `/leads`. No backend, schema, query, filter, scoring, approval, workflow, agent-routing, or import/export logic will change. No deploy. All work stays inside `src/components/leads/library/**`, `src/pages/LeadLibrary.tsx`, and small shared token/util additions.

## Goals

- Whole workspace fits inside one desktop viewport: header + Atlas strip + metric strip + toolbar + table header + ~8 rows + pagination, no page scroll.
- Table never horizontally scrolls at standard desktop/laptop widths.
- Command bar never covers table content.
- Row is scannable in under three seconds; no snake_case surfaced.

## Layout Shell

```text
+----------------------------------------------------------+
| Compact header (title + primary actions)        ~88px    |
+----------------------------------------------------------+
| Atlas strip (compact)  |  Metric strip (7 items)  ~72px  |
+----------------------------------------------------------+
| Toolbar row 1: tabs + Save view                  ~40px   |
| Toolbar row 2: search + 5 filter selects + reset ~44px   |
+----------------------------------------------------------+
| Table header (sticky)                            ~40px   |
| ~8 rows                                     flex: 1      |
| Pagination                                       ~48px   |
+----------------------------------------------------------+
Collapsed "Ask your workforce" FAB, bottom-right, never overlaps table.
```

Shell: `height: calc(100vh - <app header>); overflow: hidden;` with an inner flex column; the table region is `flex: 1; min-height: 0` and owns its own vertical scroll only when >page-size rows exist (pagination is the norm).

## Files To Modify

- `src/pages/LeadLibrary.tsx` — new fixed-height shell, remove hero/AtlasPanel-large, wire new subcomponents.
- `src/components/leads/library/MetricStrip.tsx` — collapse into one shared container, remove per-card glass, add subtle divider + selected underline.
- `src/components/leads/library/FilterBar.tsx` — merge with tabs into single `Toolbar`, tighten heights, specific "Any …" labels, chips row inline.
- `src/components/leads/library/AtlasPanel.tsx` — reduce to compact strip (~360–420×~80px) using canonical Atlas asset from `agentRegistry`.
- `src/components/leads/library/LeadTable.tsx` — new 8-column %-width layout, row upgrades, no horizontal scroll, responsive column hiding.
- `src/components/leads/library/premium/tokens.ts` — consolidate surface/border/text/accent tokens; softer glass, less green.

## Files To Create

- `src/components/leads/library/LibraryHeader.tsx` — eyebrow, title, subtitle, action cluster (Create list primary, Add lead secondary, Import/Export icon buttons).
- `src/components/leads/library/Toolbar.tsx` — tabs + Save view (row 1); search + filters + reset (row 2); active-chip row.
- `src/components/leads/library/AtlasStrip.tsx` — compact assistant card (avatar, name/title, two metrics, on-duty dot).
- `src/components/leads/library/LeadDetailDrawer.tsx` — right-side drawer (`Sheet`, 420–520px) with company summary, signal, fit breakdown, evidence, buyer, opener preview, approval state, activity, next action.
- `src/components/leads/library/LeadRow.tsx` — one row component with the eight refined cells.
- `src/components/leads/library/cells/` — small presentational cells: `LeadCell`, `SignalCell`, `FitCell`, `BuyerCell`, `ReadinessCell`, `OpenerCell`, `NextActionCell`, `UpdatedCell`.
- `src/components/leads/library/Pagination.tsx` — page nav + rows-per-page (10/25/50).
- `src/components/leads/library/WorkforceFab.tsx` — collapsed bottom-right FAB replacing the floating command bar on `/leads`; expands to a small popover with ≤3 suggestions using canonical names (Atlas/Mira/Orion).
- `src/components/leads/library/EmptyState.tsx`, `TableSkeleton.tsx` — compact loading/empty states preserving table dimensions.
- `src/lib/leadLibrary/labels.ts` — map raw values (`job_posting`, `needs_verification`, `weak`, readiness states, engagement) to user-facing labels.
- `src/lib/leadLibrary/relativeTime.ts` — "5m ago / 2h ago / Yesterday / 4d ago / —".

## Table Columns

Kept in main table (8, %-widths sum to 100):

| Column | Width |
|---|---|
| Lead | 17% |
| Signal | 15% |
| Fit | 9% |
| Buyer | 15% |
| Readiness | 13% |
| Opener | 17% |
| Next action | 10% |
| Updated | 8% (numeric, tabular-nums) |

Moved to drawer: full source metadata, evidence list, full opener body, engagement history, raw discovery data, technical/retry statuses, full research notes, secondary badges.

Responsive hide order (progressive): Updated → Opener → Signal → Buyer. Below `md`, table is replaced by compact `LeadCard` list (Lead, Fit, Readiness, Next action); details open in a bottom sheet reusing `LeadDetailDrawer` content.

## How Each Constraint Is Met

- **No horizontal scroll:** switch from fixed pixel widths to `table-fixed` with % widths summing to 100; drop overflow columns into drawer; hide progressively at `lg`/`md`.
- **No page scroll:** shell owns viewport height; table region flexes; overflow lives only inside table body via pagination.
- **Command bar never covers rows:** remove floating `InlineCommandBar` from this page's layout, mount `WorkforceFab` (collapsed) in a bottom-right corner with `pointer-events` scoped to the button; expanded popover opens upward and closes on outside click. Pagination bar reserves height above it.
- **Less green / less glass:** tokens updated to a single restrained teal accent applied only to primary action, selected tab/metric, active row, next-action button, and Atlas on-duty dot.
- **No snake_case:** all cell renderers pass through `labels.ts`.

## Component System (shared tokens)

`tokens.ts` will expose: `surfaceBase`, `surfaceRaised`, `surfaceHover`, `borderSubtle`, `borderActive`, `textPrimary`, `textSecondary`, `textMuted`, `accentTeal`, `statusSuccess`, `statusWarning`, `statusDanger`, plus radii (`rounded-xl` / `rounded-2xl`) and one shared shadow. All new components consume tokens; hardcoded greens/hex are removed from redesigned files.

## Canonical Agents

Atlas asset pulled from `src/config/agentRegistry.ts` via `agentResolver`. Suggested FAB chips credit Atlas (research), Mira (opener), Orion (review). No legacy names (Scout/Aria/Hawk/Penn/Scribe/Nova) appear in copy.

## Out Of Scope

- `useLeadLibrary`, `deriveCanonicalLeadView`, filter predicates, `applyFilters`, list persistence, RLS, edge functions — untouched.
- Other pages and the global `InlineCommandBar` component itself are not modified; only its usage on `/leads` is replaced by `WorkforceFab`.

## Validation

- `tsgo` typecheck on changed files.
- Manual Playwright screenshots at 1440×900, 1280×800, 1024×768, 768×1024, 390×844.
- Confirm: no horizontal table scroll, 8+ rows visible at 1280×800, FAB collapsed and non-overlapping, pagination visible.
- No deploy, no publish, no migrations.

## Deliverables (post-build report)

Files modified/created, columns kept vs. drawered, how scroll and overlap were eliminated, viewport/pagination behavior, screenshots at each width, typecheck + scoped lint + build output, explicit confirmation backend/DB behavior unchanged and nothing was deployed.
