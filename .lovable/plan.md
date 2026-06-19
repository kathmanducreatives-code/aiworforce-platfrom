## Problem

Clicking the "Close" button in the workbench triggers `closeWorkbench()`, which instantly sets `workbenchOpen = false`. In `ChatWorkspace.tsx`, this causes an immediate conditional render switch from `ResizableWorkspaceSplit` to a single `ChatPane` — the workbench vanishes instantly and the chat snaps to full width with zero animation.

## Solution

Use a CSS `transition` on `grid-template-columns` (supported in all modern browsers: Chrome 107+, Firefox 66+, Safari 16+) to smoothly collapse the workbench column and expand the chat column. Add a transient `workbenchClosing` state so the split layout stays mounted during the 300ms exit animation.

### Technical Details

#### 1. `src/contexts/ChatWorkspaceContext.tsx`
- Add `workbenchClosing: boolean` to the context state.
- Update `closeWorkbench()`:
  1. Set `workbenchClosing = true`.
  2. After 300ms, set `workbenchOpen = false` and `workbenchClosing = false`.
- Ensure `workbenchClosing` is exported in the context value.

#### 2. `src/components/chat/workspace/ChatWorkspace.tsx`
- On desktop wide (`viewportW >= 1000`), **always** render `ResizableWorkspaceSplit` — do not conditionally skip it when the workbench is closed.
- Pass `workbenchOpen` and `workbenchClosing` down to `ResizableWorkspaceSplit`.
- When the workbench is closed, pass `workbench={null}` to the split so the right column renders empty.
- Keep mobile/tabbed behavior unchanged.

#### 3. `src/components/chat/workspace/ResizableWorkspaceSplit.tsx`
- Accept two new props: `workbenchOpen?: boolean` and `workbenchClosing?: boolean`.
- Compute `isCollapsed = !workbenchOpen && !workbenchClosing`.
- When `isCollapsed`:
  - `gridTemplateColumns: 1fr 0px 0px` (chat fills 100%, divider and workbench at 0).
- When open or closing:
  - Use normal `chatPx 6px 1fr` layout.
- Add inline style `transition: grid-template-columns 300ms cubic-bezier(0.32, 0.72, 0, 1)` on the container.
- When collapsed, hide the divider handle (`opacity: 0`, `pointer-events: none`).
- When collapsed, ensure the workbench cell renders empty (no background, no content).
- Preserve existing drag-resize logic and `localStorage` ratio persistence.

### Visual Result

User clicks "Close" in the workbench.
- The workbench column smoothly shrinks to zero width over 300ms.
- The divider fades away simultaneously.
- The chat column expands to fill the freed space.
- After the transition completes, the workbench fully unmounts internally.
- Easing uses the project's standard `[0.32, 0.72, 0, 1]` curve.

### Files Changed

- `src/contexts/ChatWorkspaceContext.tsx`
- `src/components/chat/workspace/ChatWorkspace.tsx`
- `src/components/chat/workspace/ResizableWorkspaceSplit.tsx`

### What Is Preserved

- Desktop drag-to-resize behavior and saved split ratio in `localStorage`.
- Mobile fullscreen workbench overlay.
- Desktop narrow (1000px breakpoint) tabbed Chat / Workbench switch.
- All existing workbench content, tabs, and data views.