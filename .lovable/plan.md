## Goal

Shrink the per-step "step box" inside the Execution Plan card. Right now each step renders as a padded card (`p-3.5` + Output/Done-when block + tool badge row + View output button) — with 50 steps this becomes an enormous scroll. Make each step a compact single-line row across the system, while keeping all functionality (click to open output, agent badge, status, approvals, errors).

## Scope

Change only `src/components/chat/workspace/plan/ExecutionTaskRow.tsx` (used everywhere execution plans render — Chat, PlanDetailView, TaskPlanPage). No logic, routing, or data changes. Container in `ExecutionPlanCard.tsx` gets slightly tighter row spacing.

## New compact row design

Single row, ~32px tall:

```
02  ●  [Hawk]  Scrape company site           firecrawl · researched   →
```

- Left: 2-digit index (mono, muted) + `StatusIcon` + `AgentBadge` (small)
- Middle: title truncated to one line (`truncate`), with title tooltip for overflow
- Right: compact reaction chip (e.g. "25 researched" / "Draft ready") + optional tool badge (only when failed or connector missing) + chevron
- Whole row is clickable → opens Workbench (unchanged behavior)
- Approval badge, when required, replaces the reaction chip on the right
- Failed rows show a thin one-line rose error underneath (kept, but single-line truncated)

Removed from the default row (moved into expand-on-click details, opened via a small caret):
- "Output:" / "Done when:" block
- Actor key + reason line
- Output preview `<details>` (Workbench already shows this)

Expandable details:
- Small caret button on the far right (or click on the title area with a modifier — simplest: caret toggles a local `expanded` state). When expanded, show the previously-hidden expected/success/actor/reason lines beneath the row in muted text.
- Default state = collapsed for every step.

## Visual specs

- Row: `flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.04]`
- Title: `text-[13px] text-[#F0F6FC] truncate`
- Index/status/badge: `shrink-0`
- Reaction chip: keep existing `ReactionChip` but always small
- ExecutionPlanCard list spacing: `space-y-2` → `space-y-1`

## Out of scope

- Workbench, agent rail, activity feed, plan card header — untouched
- No changes to `ExecutionPlanCard.tsx` beyond `space-y-2` → `space-y-1`
- No changes to data model, hooks, or edge functions
