# Signals Redesign + Department Workspace Shell

Visual/layout only. No changes to backend, sourcing, scoring, edge functions, API payloads, DB schemas, credits, or workflow behavior. Files owned by the qualified-lead branch are left alone unless a shared visual wrapper strictly needs them.

## Goal

Rebuild `/signals` in the shape of the Content page: compact header, one metric strip, four tabs, one featured brief, a clean feed, and a permanent Scout copilot rail on the right. Extract the pattern into a reusable `DepartmentWorkspaceShell` and prep other department pages to adopt it.

## Layout target

```text
+----------------------------------------------------+---------------+
| eyebrow · title · description        agent + CTAs  |               |
| -------------------------------------------------- |   Scout       |
| metric strip (single row: 81 · 12 · 6 · 4)         |   Copilot     |
| tabs: For You | Hiring | Market Events | Competitors|  (persistent)|
| filters row (collapsed by default)                 |   Insight     |
| TODAY'S SIGNAL BRIEF (single card, one CTA)        |   Modes       |
| Recommended signals feed (compact cards)           |   Prompts     |
|                                                    |   Ask input   |
+----------------------------------------------------+---------------+
        ~70% main workspace                             ~30% rail
```

## Deliverables

### 1. New reusable shell — `src/components/layout/DepartmentWorkspaceShell.tsx`
Props: `eyebrow`, `title`, `description`, `agent` (id/name/role/status/image/accentHex from `agentRegistry`), `metrics` (label/value list), `primaryAction`, `secondaryAction`, `tabs`, `activeTab`, `onTabChange`, `filtersSlot`, `children`, `rail` (ReactNode), `mobileRailLabel`.
- Two-column CSS grid: `minmax(0,1fr) 380px` desktop, `1fr 340px` at 1280px, single column with drawer at ≤1024px.
- Neutral base (black/charcoal), agent accent used only for active tab underline, primary action, agent status dot, insight tint, selected borders. ~85–90% neutral.
- Uses `resolveAgent` from `@/lib/agentResolver` — no second name/color source.

### 2. New Signals page composed from the shell
Rewrite `src/pages/Signals.tsx` to render `DepartmentWorkspaceShell` + new subcomponents (below). Keep existing hooks: `useSignalFeed`, `useSignalReviews`, `useIntegrationReadiness`, `deriveRadarBrief`. No changes to `runRadarScan` call signature or payloads.

New Signals-scoped components (all in `src/components/signals/workspace/`):
- `SignalsHeader.tsx` — eyebrow "SIGNAL INTELLIGENCE", title "Signals", description, Scout chip "Scout · On duty", primary "Run radar scan", secondary "Edit radar". No Load more.
- `SignalsMetricStrip.tsx` — single horizontal strip: tracked / new / verified / need review. Derived from existing signals + reviews arrays.
- `SignalsTabs.tsx` — four primary tabs: For You, Hiring, Market Events, Competitors. Others (Funding, LinkedIn posts, Comments, Workflow trends, Decision-makers, Saved, Reviewed, Ignored) become a `More` dropdown + search inside `SignalsFilters.tsx` (collapsible).
- `TodaysSignalBrief.tsx` — one card. Populated from `deriveRadarBrief`. Empty state: "No verified signals yet" + single "Run radar scan" button. Only place the scan CTA appears alongside the header CTA — no third instance in-viewport.
- `SignalsFeed.tsx` (thin) — renders existing `SignalCardRouter` cards filtered by active tab/filters. Compact variant: type, company, headline, why-it-matters, verification, Scout rec, action row; heavy metadata behind expander.
- `ScoutCopilot.tsx` — mirrors `MiraCopilot` structure. Header with Scout image (uses existing scout asset via `resolveAgent('scout').avatarSrc`), "AI Signal Scout", On duty. Insight card. Modes: Brief / Watch / Analyze / Ask. Prompts as specified. Bottom input dispatches via `sendAgentCommand` (no new backend). Absorbs the old `ScoutPromptBox` UX.

Existing `src/components/signals/SignalFeed.tsx` (894-line monolith) stays on disk but is no longer rendered by `/signals`. Leaving it in place avoids collisions with the qualified-lead branch; a follow-up can delete it once merged.

### 3. Global composer behavior on department pages
Edit `src/components/dock/CommandDock.tsx` (or its wrapper) to accept a `variant="department"` mode set by `DepartmentWorkspaceShell` via context. In that mode: render collapsed pill with "Open workforce chat" label; never overlay content; expand only on click. Default behavior unchanged elsewhere.

### 4. Department theming
Extend `src/lib/departmentTheme.ts` / `agentRegistry` mapping so the shell reads `{ accentHex, agent }` per department. No hardcoded second registry. Signals → Scout (emerald/teal), Content → Mira (unchanged), Leads → Atlas, Awaiting You → Pilot, etc.

### 5. Prep other pages (non-breaking)
Only Signals is migrated in this PR. Add short TODO comments at the top of `Leads.tsx`, `Competitors.tsx`, `AwaitingYou.tsx`, `DepartmentsOverview.tsx` pointing to `DepartmentWorkspaceShell`. No functional change.

### 6. Responsive
- 1440 / 1280: two-column, sticky rail.
- 1024: rail narrows to 320px, no clipping.
- 768/mobile: rail becomes a Sheet drawer opened by a floating Scout button; main content is primary.

### 7. Accessibility
Semantic `<nav>` for tabs with `aria-selected`, focus rings on all controls, agent status uses text + dot (not color alone), respects `prefers-reduced-motion` on tab underline animation.

## Files to add
- `src/components/layout/DepartmentWorkspaceShell.tsx`
- `src/components/signals/workspace/SignalsHeader.tsx`
- `src/components/signals/workspace/SignalsMetricStrip.tsx`
- `src/components/signals/workspace/SignalsTabs.tsx`
- `src/components/signals/workspace/SignalsFilters.tsx`
- `src/components/signals/workspace/TodaysSignalBrief.tsx`
- `src/components/signals/workspace/SignalsFeed.tsx`
- `src/components/signals/workspace/ScoutCopilot.tsx`

## Files to edit
- `src/pages/Signals.tsx` — swap to shell + new components.
- `src/components/dock/CommandDock.tsx` — add department variant (collapsed by default on department routes).
- `src/lib/departmentTheme.ts` — ensure Scout/Signals mapping exposed to shell (no color hardcoding elsewhere).
- Small TODO breadcrumbs in `Leads.tsx`, `Competitors.tsx`, `AwaitingYou.tsx` (comment-only).

## Explicitly untouched
- All Supabase edge functions and `supabase/**`.
- `useSignalFeed`, `radarBrief.ts`, `signalFeedModel.ts`, `signalsFeed.ts` logic.
- Any file listed under the qualified-lead workflow branch (`leadDecisionState.ts`, `LeadTable.tsx`, `LeadDetailDrawer.tsx`, etc.).
- Content page behavior — used only as visual reference.

## Validation
- `tsgo` clean, project build clean.
- Playwright screenshots at 1440 / 1280 / 1024 saved under `/tmp/browser/signals-redesign/`.
- Visual check: one dominant Run radar scan CTA in viewport, Scout rail persistent, large Ask Scout card gone, tabs reduced to 4, composer no longer overlays.
