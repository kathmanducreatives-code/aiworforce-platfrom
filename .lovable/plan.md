# Resizable Chat ↔ Workbench Split (Lovable-style)

Goal: replace the current rigid `basis-1/2` split with a polished, draggable 40/60 split that persists, with safe min/max widths and narrow-aware reflow in the chat pane and Workbench.

No backend changes. No landing/page logic changes. No migrations. No auto-send.

## Files to change

1. `src/components/chat/workspace/ChatWorkspace.tsx`
   - Replace the two-div `basis-1/2` split with a new `ResizableWorkspaceSplit` component when `showSplit` is true (desktop + workbench open).
   - Keep mobile full-screen Workbench overlay path unchanged.
   - Keep top bar, history Sheet, composer, ChatErrorBoundary wrapping unchanged.
   - Pass a `paneWidth` (px) down to the chat pane via a small context so the Lead Source Selector can reflow.

2. New: `src/components/chat/workspace/ResizableWorkspaceSplit.tsx`
   - Two children (chat, workbench) + a draggable divider between them.
   - Constraints (px-based, evaluated against current container width):
     - chat min 360px, workbench min 560px
     - chat max 60% of container, workbench max 75% of container
   - Default ratio 0.40 (chat fraction).
   - Pointer-events-based drag (pointerdown/move/up + setPointerCapture), `cursor-col-resize`, `select-none` + `user-select:none` on body during drag, subtle active state on handle.
   - Double-click handle → reset to 0.40.
   - Persist ratio in `localStorage` under `agentory:workspace-split-ratio`, written **on pointerup only** (not on every move).
   - On mount: read saved ratio, clamp against current min/max, fall back to 0.40.
   - Re-clamp on window resize so the panes never violate min/max.
   - Divider visuals: 6px hit area, 1px centered line (`border-white/[0.06]`), 28px tall handle pill with `GripVertical` icon, hover/active glow using `bg-primary/20`.
   - Exposes `onWidthsChange?(chatPx, wbPx)` so the chat pane width can drive narrow reflow.

3. New: `src/components/chat/workspace/ChatPaneWidthContext.tsx`
   - Tiny context exposing the current chat-pane pixel width.
   - Provider wraps the chat column inside `ResizableWorkspaceSplit`.
   - Hook `useChatPaneWidth()` returns a number (default `Infinity` when no split).

4. `src/components/chat/workspace/workbench/LeadResultsView.tsx` (and/or the Lead Source Selector card it renders)
   - Read `useChatPaneWidth()` — only applies when the selector is rendered inside the chat pane (same-chat surface). Workbench-rendered tables are unaffected.
   - Switch the source-cards grid from fixed `sm:grid-cols-2` to width-aware: 1 column when chat pane < 520px, 2 columns otherwise.
   - Add `min-w-0` and `break-words` on card bodies; remove any `whitespace-nowrap` from descriptions.

5. `src/components/chat/workspace/workbench/WorkbenchPanel.tsx`
   - Ensure root is `flex flex-col h-full min-w-0 overflow-hidden`.
   - Sticky `WorkbenchHeader` (`sticky top-0 z-10 bg-[#0a0d12]`).
   - Body wrapper: `flex-1 min-h-0 overflow-auto`. Tables get `overflow-x-auto` inside their own container, never the page.
   - Default tab: confirm it is **not** Raw JSON (already the case after prior change — verify and lock with a small comment/test).

6. `src/contexts/ChatWorkspaceContext.tsx`
   - No API changes required for split, but add two helpers used by the new split:
     - `splitRatio: number` + `setSplitRatio(n: number)` (lightweight, no persistence — persistence lives in the split component itself; context is only used to share the value with anything that needs it later). Optional — can be kept fully local in `ResizableWorkspaceSplit` if no other consumer needs it. Default plan: keep it local, skip context changes.

## Layout architecture

```
ChatWorkspace (fixed inset-0, flex-col)
├── TopBar  (history toggle · title · close)
├── Body  (flex-1, flex, min-h-0)
│    └── ResizableWorkspaceSplit  (when workbenchOpen && !isMobile)
│         ├── ChatPane    (min 360px, flex-col, composer pinned bottom)
│         ├── Divider     (6px, draggable, dbl-click reset)
│         └── WorkbenchPane (min 560px, sticky header, scroll body)
│        (else: ChatPane fills width)
├── Mobile Workbench overlay (unchanged)
└── History Sheet (unchanged)
```

## Resize behavior details

- Ratio stored as chat fraction (0..1). Persisted only on `pointerup` and on double-click reset.
- Drag math: `nextChatPx = clamp(e.clientX - containerLeft, minChat, containerW - minWb)` then clamped again against the % caps (chat ≤ 60%, wb ≤ 75% → chat ≥ 25%).
- During drag: add `data-resizing` on the split root → CSS disables transitions and sets `cursor-col-resize` + `user-select:none` globally via a class on `<body>`.
- Window resize listener re-applies clamp without writing to storage.
- Closing Workbench does not erase saved ratio. Reopening restores it.

## Narrow chat-pane reflow (Lead Source Selector)

- Provider gives current chat pane width in px.
- Source-cards grid: `gridTemplateColumns: paneWidth < 520 ? '1fr' : 'repeat(2, minmax(0,1fr))'`.
- Card root: add `min-w-0`; description gets `break-words leading-snug`; icons + title row uses `flex-wrap` if extremely narrow.
- "Nothing will be sent" banner stays full width above the grid.

## Workbench polish

- Header sticky, single 1px bottom border matching `border-white/[0.06]`.
- Tabs row sticky directly under header (already structured this way — verify alignment after split).
- Lead table container: `overflow-x-auto` with `min-w-[720px]` table so it scrolls inside the pane only.
- Action toolbar lives inside the Workbench scroll container's sticky top section so buttons never escape.

## Responsive rules

- Desktop ≥ 1024px (current `isMobile` threshold is 768): use `ResizableWorkspaceSplit`.
- Mobile (< 768px): unchanged full-screen overlay for Workbench.
- Tablet 768–1023px: still split, but cap default chat fraction at min 360px (clamp will naturally handle it). If container width < `minChat + minWb` (920px), force single-pane Workbench overlay (mobile behavior) — small guard inside `ChatWorkspace`.

## Visual consistency

- Divider uses the same `border-white/[0.06]` token used elsewhere.
- Handle pill: `h-7 w-1.5 rounded-full bg-white/10 group-hover:bg-primary/40 transition-colors`.
- No new colors; reuse existing tokens. No hardcoded hex outside what's already used in this file (`#0a0d12`).

## Tests / QA checklist

Manual browser QA after build:
- A: Workbench open → defaults to 40/60.
- B: Drag divider both directions → smooth, min/max enforced, no horizontal page scroll.
- C: Double-click divider → resets to 40/60.
- D: Refresh → saved ratio restored.
- E: Close & reopen Workbench → saved ratio restored, no layout jump.
- F: Resize browser smaller/larger → panes re-clamp, never below mins.
- G: At chat width < 520px → Lead Source Selector collapses to 1 column, no overflow.
- H: Composer stays pinned, Workbench header stays sticky, tables scroll inside their pane only.
- I: Conversation history Sheet still opens/closes without affecting split.
- J: Raw JSON tab is not the default.

## Out of scope (explicitly not touched)

- Landing page.
- Backend / edge functions / migrations.
- `dispatchChatAction`, `dispatchResultAction`, `useLeadResults`, locked-column logic, credit logic, account/contact logic.
- Conversation continuity (`conversation_id`).
- Auto-send / outreach behavior.
