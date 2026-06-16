# Fix chat workspace half-height issue

## Root cause
`ChatWorkspaceContext` defaults `open()` to `'drawer'` mode, which `ChatWorkspace.tsx` renders at `height: 70vh` anchored to the bottom (a bottom-sheet). Fullscreen mode already exists but is only reached via a toggle/keyboard shortcut. The drawer also has a drag-resize handle and rounded top corners that reinforce the "half-open sheet" feel on desktop.

## Strategy
Make the full-height workspace the default on desktop/tablet. Keep mobile full-screen. Retire the desktop bottom-sheet drawer (collapse the two modes into a single full-height workspace; keep `closed` and `fullscreen` only). The result panel and composer already live inside the body — no structural change needed there, only sizing and polish.

## Changes

### `src/contexts/ChatWorkspaceContext.tsx`
- `open()` sets mode to `'fullscreen'` (not `'drawer'`).
- Keyboard shortcut `Cmd/Ctrl+K` toggles `closed` ↔ `fullscreen`.
- Esc closes from any open state.
- Keep the `ChatMode` union for backward compat; treat `'drawer'` as alias of `'fullscreen'`.

### `src/components/chat/workspace/ChatWorkspace.tsx`
- Always render as a full-height surface on desktop:
  - `fixed inset-0 z-40 h-[100dvh] w-screen`
  - Remove `rounded-t-2xl`, `bottom: 0; height: <n>vh`, and the `motion` height animation.
  - Remove drag-resize handle and `onPointer*` logic (no half states to drag between).
- Animation: subtle 200ms fade + 8px translateY-in / scale 0.99→1; exit reverse. No bouncy spring.
- Backdrop: replace dim-only backdrop with a blurred dim layer only behind the workspace edges; since workspace is full-screen, backdrop is no longer needed — remove it.
- Top bar always visible (was fullscreen-only): title left, `Minimize`/`Close` right. Close returns to previous page (calls `close()` which unmounts overlay, leaving the dashboard route intact).
- Body grid: `Sidebar (280px) | Conversation (flex) | Workbench (when open)`; all three are `h-full` and independently scrollable with `min-h-0`.
- Composer container: sticky bottom inside the conversation column, `border-t`, `bg-background/80 backdrop-blur`, with `pb-[env(safe-area-inset-bottom)]`. The message list area uses `flex-1 overflow-y-auto` with `pb-4` (composer is a sibling, not overlay, so no extra bottom padding needed).
- Workbench panel: `h-full`, own `overflow-y-auto`; chat column unaffected vertically when it opens.

### Mobile
- Same full-screen overlay (already covered by `inset-0` + existing `MobileNav`). Sidebar hidden via existing `!isMobile` guard. Workbench remains an absolute full-screen layer on mobile.

### Responsive
- Sidebar fixed `w-[280px]` on `lg+`, hidden on `<md`.
- Workbench width clamped via existing `workbenchWidth`, min 360, max 50vw.

## Composer fix
- Composer becomes a flex child after the scrollable message list inside the conversation column, so it can never cover messages.
- Message list: `flex-1 min-h-0 overflow-y-auto`.

## Result panel compatibility
- Workbench sits as the 3rd flex column, `h-full`. Opening it shrinks chat horizontally only, never vertically. Both scroll independently.

## Animation
- `initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}`.

## Files touched
- `src/contexts/ChatWorkspaceContext.tsx`
- `src/components/chat/workspace/ChatWorkspace.tsx`

## Test plan
1. Click composer on dashboard → workspace fills viewport (no half-height).
2. Open existing conversation → messages fill height, composer pinned bottom.
3. Send "Find me leads" → Lead Source Selector appears in full workspace, same conversation.
4. Submit brief → plan stays in same conversation.
5. Open lead results → side panel opens right, both full-height, both scroll independently.
6. Click close → returns to dashboard with route unchanged.
7. Resize 1920→1024 width → no clipping, composer visible, no half state.
8. Scroll long chat → only message list scrolls; composer & sidebar stay fixed.
