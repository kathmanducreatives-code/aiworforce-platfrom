# Agentory Premium UI Upgrade — Chat + Workbench

Scope: pure UI/UX. No backend, no migrations, no sourcing/action logic changes. All current functionality (LeadSourceSelector, dispatchChatAction, dispatchResultAction, ui_panel, locked columns, credit estimates, draft-only outreach, conversation continuity) is preserved.

## Goals
Make Agentory feel like a premium AI employee management workspace: Slack-style chat, Lovable/Claude split artifact, Linear/Raycast dark polish, Clay/Attio table, careful glassmorphism.

## 1. Chat surface (Slack/Telegram-inspired)

Files: `src/components/chat/workspace/ChatView.tsx`, message bubble components under `src/components/chat/workspace/bubbles/`.

- Group consecutive messages by author; show avatar + agent name (Pilot, Scout, Aria, Hawk, Penn, Scribe) only on first message of a group.
- Assistant bubble: `bg-white/[0.03] border border-white/[0.06] backdrop-blur-xl rounded-2xl`, comfortable padding, no harsh outlines.
- User bubble: right-aligned, max-width ~70%, `bg-emerald-500/10 border-emerald-500/20 text-[#E6F4EC]`, smaller.
- Subtle timestamps on hover only.
- Tighten vertical rhythm; remove oversized cards.

## 2. Replace large post-result action card with compact pills

File: `src/components/chat/workspace/bubbles/LeadSourceCard.tsx` (and any "post-result" stacked card renderer in the bubbles folder).

Replace stacked Save/Rank/Enrich/Draft/Enrich+Draft/Review cards with a single compact line:

```
Scout found 5 account opportunities. Opened in the lead table. Nothing was sent.
[View results] [Find decision-makers ~5c] [Rank ~1c] [Export] [Done]
```

- Pills: `h-7 px-3 rounded-full text-[12px] bg-white/[0.04] border border-white/[0.08] hover:bg-emerald-500/10 hover:border-emerald-500/30`.
- Wrap with `flex flex-wrap gap-1.5`.
- Primary pill (View results) gets emerald accent.
- All pills call existing `dispatchChatAction` / `dispatchResultAction` — no new handlers.
- The full action surface (recommended banner, locked columns, bulk toolbar, credit confirmation) stays in Workbench.

## 3. Workbench header redesign

File: `src/components/chat/workspace/workbench/WorkbenchHeader.tsx`.

New layout:

```
WORKBENCH                                            [Refresh] [Close]
5 account opportunities found
Scout found companies showing intent. Unlock decision-makers, enrichment, and outreach when ready.

[Apify] [Jobs Search] [Complete] [5 results] [Updated 2m ago]
Request: Find 5 companies hiring GTM roles in B2B SaaS in USA   (truncated, small, muted)
```

- Eyebrow label "WORKBENCH" in `text-[10px] tracking-[0.18em] text-emerald-300/70`.
- Title h2 `text-[15px] font-medium text-[#F0F6FC]`.
- Subtitle `text-[12px] text-[#7D8590]`.
- Chips: `h-5 px-2 rounded-md bg-white/[0.04] border border-white/[0.06] text-[11px]`.
- Raw user request becomes a single truncated muted line, not the title.

## 4. Workbench shell glassmorphism

File: `src/components/chat/workspace/workbench/WorkbenchPanel.tsx`, `ResizableWorkspaceSplit.tsx`.

- Panel: `bg-[#0a0d12]` base with overlay `bg-gradient-to-b from-white/[0.02] to-transparent`, hairline `border-l border-white/[0.06]`, soft outer shadow `shadow-[0_20px_80px_rgba(0,0,0,0.35)]`.
- Sticky header zone with `backdrop-blur-xl bg-[#0a0d12]/80`.
- Tab strip: keep 3 tabs (Opportunities/Table, Insights, Activity). Default = Table. No Raw/Sources tabs in production (dev-only `<details>` raw payload stays).
- Active tab underline animates via simple `transition-all`.

## 5. Lead table (Clay/Attio-style)

File: `src/components/chat/workspace/workbench/LeadResultsView.tsx`.

Columns: Company · Signal · Recommended Persona · Decision Maker 🔒 · Contact Info 🔒 · Company Enrichment 🔒 · Personalized Message 🔒 · Fit · Status.

- Row height ~44px, alternating subtle `bg-white/[0.015]`, hover `bg-white/[0.03]`, selected `bg-emerald-500/[0.06] border-l-2 border-emerald-400`.
- Company cell: name bold, secondary line for location/website. Missing website → amber chip "No website".
- Signal cell: signal title + small muted source.
- Recommended Persona: real value when present, else muted "Suggested after ranking".
- Locked cells: glass surface, lock icon, short action text + credit badge:
  - `Find decision-maker · ~1c` / `Needs decision-maker`
  - `Research company · ~1c` / `Needs domain`
  - `Generate draft · ~2c` / `Needs contact`
- Header row sticky inside the table scroll container; horizontal scroll only inside the table — no page-level overflow.

## 6. Recommended action banner

Slim banner above the table inside `LeadResultsView`:

```
Recommended next: Find decision-makers
These companies show intent, but no contacts are attached yet.            [Run · ~5c]
```

- `h-auto py-2.5 px-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04]`.
- One primary action only. Reason text muted. Credit estimate visible.

## 7. Empty/fallback states

Designed copy blocks (small glass card with icon) for: no contacts, no websites, no drafts, actor unavailable. Use the exact copy in the brief.

## 8. Layout / resize correctness

File: `ResizableWorkspaceSplit.tsx` (already supports 40/60, localStorage key `agentory:workspace-split-ratio`, smooth close animation).

Verify/adjust:
- Default ratio 0.4, double-click resets, persists, restores.
- Drag is smooth, no text selection, no flicker (already implemented; keep).
- `LeadSourceCard` reflows to 1 column when chat pane is narrow (use existing `ChatPaneWidthContext`).
- Composer stays fixed at bottom of chat pane.
- Table horizontal scroll is contained; no page-level horizontal scroll.

## 9. View results / Workbench continuity

- When a result message exists, ensure each such message renders a `View results` pill that calls existing open-workbench dispatcher with that message's `taskId`/`toolCallId`/`planId` (already wired in `selectedOutput`); just make the pill the canonical entry point.
- Closing Workbench keeps `selectedOutput` cached so re-clicking `View results` reopens the exact same artifact without rerun.
- If multiple result messages exist, each has its own pill bound to its own IDs.

## 10. Micro-interactions

- Tab change: 150ms underline slide.
- Result-complete subtle emerald pulse on the Workbench eyebrow for 1.2s.
- Pill hover lift (bg + border).
- Row hover, selected row accent.
- Skeleton rows while loading (use `src/components/ui/skeleton.tsx`).
- Toast on completion via existing `use-toast`.

## Files to edit

- `src/components/chat/workspace/ChatView.tsx` — message grouping, spacing.
- `src/components/chat/workspace/bubbles/LeadSourceCard.tsx` — compact pills, reflow.
- `src/components/chat/workspace/bubbles/` post-result card component(s) — strip large stacked cards, replace with pill row.
- `src/components/chat/workspace/workbench/WorkbenchHeader.tsx` — new header.
- `src/components/chat/workspace/workbench/WorkbenchPanel.tsx` — glass shell, sticky header backdrop.
- `src/components/chat/workspace/workbench/LeadResultsView.tsx` — Clay-style table, locked cells, recommended banner, empty states.
- `src/components/chat/workspace/workbench/InsightsView.tsx` / `ActivityTimeline.tsx` — glass tone consistency.
- `src/components/chat/workspace/ResizableWorkspaceSplit.tsx` — verify defaults only.

## Out of scope (explicitly not touched)

- Landing page.
- Backend sourcing/Apify/n8n logic.
- DB schema; no migrations applied (including 145631).
- Outreach send path — stays draft-only, approval-gated.
- `dispatchChatAction` / `dispatchResultAction` internals.

## QA checklist (run after build)

Test A Lead result, Test B Resize, Test C Close+View results, Test D Workbench visual, Test E Actions — per the brief. Verify: no Raw/Sources tab, Table is default, compact pills replace large card, 40/60 default + persistence, lead selector reflow at narrow width, no page-level horizontal scroll, conversation_id preserved on all actions, no auto-send.

## Final report

Will list: files changed, chat upgrades, Workbench upgrades, glass tokens used, large-card replacement, pill behavior, resize/View results behavior, build result, QA result, remaining gaps.
