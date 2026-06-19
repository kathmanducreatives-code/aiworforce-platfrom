# Fix the chat ↔ Workbench split, resize, and Workbench defaults

Goal: a polished AI command workspace. Chat = command thread, Workbench = structured output. Real draggable 40/60 split, premium look, table-first defaults, no cut-off cards, no page-level horizontal scroll.

Scope: layout/presentation only. No backend, no migrations, no auto-send. `dispatchChatAction`, `dispatchResultAction`, `useLeadResults`, locked-column logic, account/contact logic, and conversation continuity stay untouched.

## Root cause of the broken resize

`ResizableWorkspaceSplit` sizes the chat pane with both `width: chatPx` and `flexBasis: chatPx` on a child that also keeps `min-w-0`, while the workbench child has `flex: '1 1 0%'`. Combined with the divider being a flex sibling and the chat pane having no enforced `flex-shrink: 0`, flex resolution overrides the pixel width on certain layouts, so the panes "stick". Pointer-move math also writes `ratio` based on `containerRef.current.clientWidth` while React batches updates against a stale `chatPx`, so dragging feels laggy and clamps incorrectly near the edges. Fix: switch the split to a CSS Grid with `grid-template-columns: <chatPx>px 6px 1fr`, lock both panes with `min-w-0 overflow-hidden`, and drive the drag directly off a `ref`-tracked container width.

## Files changed

1. `src/components/chat/workspace/ResizableWorkspaceSplit.tsx` — rewrite to grid-based split.
2. `src/components/chat/workspace/ChatWorkspace.tsx` — narrow-viewport guard (stack/tab fallback), pass `hasWorkbench` correctly, ensure body uses the new split.
3. `src/components/chat/workspace/workbench/WorkbenchPanel.tsx` — default tab logic, header polish, sticky tabs, scroll containment, "no debug-first" rules.
4. `src/components/chat/workspace/workbench/WorkbenchHeader.tsx` — concise title (e.g. "5 account opportunities found"), original prompt as secondary text, single-row chips, aligned actions.
5. `src/components/chat/workspace/workbench/LeadResultsView.tsx` — `min-w-0`, sticky internal toolbar, table scrolls inside its own container only.
6. `src/components/chat/workspace/workbench/leadTable/LeadTable.tsx` — wrap in `overflow-x-auto`, table `min-w-[860px]`, aligned headers/cells.
7. `src/components/chat/workspace/bubbles/LeadSourceCard.tsx` — drop `max-w-[560px]/[600px]` so the card fills chat pane; already width-aware via `useChatPaneWidth`. Confirm `break-words` everywhere.
8. `src/components/chat/workspace/ChatView.tsx` (and message bubble) — ensure user/assistant bubbles use `max-w-[min(680px,100%)]` not a fixed narrow column, so messages don't become vertical text when chat is narrow.
9. `src/components/chat/workspace/ChatComposerPro.tsx` wrapper in `ChatWorkspace.tsx` — composer container already `w-full` of chat pane; verify no inner `max-w` cap.

No new files. No context API changes.

## Layout architecture

```text
ChatWorkspace (fixed inset-0, flex-col)
├── TopBar
├── Body (flex-1, min-h-0)
│    └── if showSplit (desktop && workbenchOpen && container ≥ 1000px):
│         ResizableWorkspaceSplit (CSS Grid)
│         ├── ChatPane    (min-w-0, overflow-hidden)
│         ├── Divider     (6px hit, 1px line, grab pill)
│         └── WorkbenchPane (min-w-0, overflow-hidden)
│       else if workbenchOpen && container < 1000px:
│         Tabbed view  [ Chat | Workbench ]  (single visible pane)
│       else:
│         ChatPane fills width
├── Mobile Workbench overlay (unchanged)
└── History Sheet (unchanged, drawer only)
```

## Real resize behavior

- Grid template: `gridTemplateColumns: ${chatPx}px 6px 1fr` while split is active.
- State: `chatPx` derived from `ratio * containerW`, clamped each render.
- Constraints (px first, then %):
  - chat min `380px`, workbench min `620px`
  - chat max `60%`, workbench max `75%` (→ chat ≥ `25%`)
- Drag (pointer events on divider):
  - `onPointerDown`: `setPointerCapture`, snapshot `startX` + `startChatPx`, set `dragging=true`.
  - `onPointerMove`: `nextChatPx = clamp(startChatPx + (e.clientX - startX), mins, container)`, then write `ratio = nextChatPx / containerW`. Uses `requestAnimationFrame` to coalesce.
  - `onPointerUp`/`Cancel`: persist ratio, release capture, `dragging=false`.
- Body class `workspace-split-resizing` during drag → global `cursor: col-resize`, `user-select: none`.
- Double-click divider → reset to `0.4`, persist.
- `ResizeObserver` on container re-clamps on viewport change without writing to storage.
- Persist key: `agentory:workspace-split-ratio` (write only on pointerup + dbl-click).
- Restore on mount; clamp invalid values to `0.4`.
- If `containerW < 1000` (mins won't fit): render tabbed fallback instead of breaking — no horizontal page scroll.

## Workbench default tab fix

Replace current default logic in `WorkbenchPanel.tsx`:

- New priority: `leads` (if `leadsPanel`) → `results` (if `hasResults`) → `rankings` → `drafts` → `sources` → `summary` → `activity`.
- `raw` is never auto-selected; it stays last in tabs.
- Reset effect mirrors the same priority when `selectedOutput` changes.

## Workbench visual hierarchy

- Header (`WorkbenchHeader.tsx`):
  - Eyebrow: `WORKBENCH` (10px, tracked).
  - Title: derived concise label (e.g. `${lead_count} account opportunities found`) when `leadsPanel`, else current logic with `truncate` and `title=` tooltip.
  - Subtitle: original user prompt, `text-[11px] text-[#7D8590] truncate`.
  - Chips in one row, refresh + close right-aligned, `border-b border-white/[0.06]`, `sticky top-0`.
- Tabs row: `sticky top-[header-h] z-10 bg-[#0a0d12]`, compact.
- Body: `flex-1 min-h-0 overflow-auto`. Tables wrap with their own `overflow-x-auto` so the page never scrolls horizontally.
- Recommendation banner: compact, single line at wide widths, wraps at narrow.
- Locked column cells keep their existing premium styling (subtle blur, lock icon, credit badge).

## Chat pane / Lead Source Selector reflow

- `LeadSourceCard` already reads `useChatPaneWidth()`. Remove `max-w-[560px]` / `max-w-[600px]` caps so the card fills the pane; keep `min-w-0` and `break-words`.
- Source grid: 1 col when `paneW < 520`, 2 cols otherwise (already in place).
- Card descriptions: `leading-snug break-words`, no `whitespace-nowrap`.
- Message list bubbles: cap with `max-w-[min(680px,100%)]` (not a fixed narrow px) so user messages never become a vertical column.
- Composer container stays `w-full` of chat pane (already true via `ChatWorkspace.tsx`).

## Responsive rules

- Desktop (container ≥ 1000px): draggable split, default 40/60.
- Tablet (768–999px container): tabbed `Chat | Workbench` (no divider), preserves all logic.
- Mobile (`useIsMobile`): unchanged full-screen workbench overlay.

## Visual polish (no new tokens)

- Divider: 6px hit area, 1px centered line `bg-white/[0.06]`, hover `bg-emerald-400/30`, active `bg-emerald-400/50`; centered 28×8 grab pill with `GripVertical`.
- Borders: reuse `border-white/[0.06]`.
- No new colors. No hardcoded hex outside existing `#0a0d12` / `#0F6FC` family already in these files.

## QA checklist (manual, after build)

A. Workbench opens at 40/60.  
B. Drag divider both directions → panels actually resize, mins enforced, no horizontal page scroll.  
C. Double-click divider → reset to 40/60.  
D. Refresh → saved ratio restored.  
E. Close & reopen Workbench → saved ratio restored.  
F. Resize browser smaller/larger → clamp re-applies; below 1000px container → tabbed fallback.  
G. Chat pane < 520px → Lead Source Selector collapses to 1 column, no clipping.  
H. User messages wrap naturally, never become vertical text.  
I. Composer stays pinned, full chat-pane width.  
J. Workbench tables scroll inside their pane only.  
K. After lead sourcing → default tab is `Leads` (or `Results`), never `Summary`/`Raw`.  
L. History Sheet still opens/closes without affecting the split.

## Out of scope

Landing, backend, edge functions, migrations, `dispatchChatAction`, `dispatchResultAction`, `useLeadResults`, locked-column credit logic, conversation continuity, auto-send/outreach.
