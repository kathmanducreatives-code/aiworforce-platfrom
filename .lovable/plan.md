
# Chat Workspace — Enterprise Redesign

Visual-only overhaul of the chat drawer. No layout restructuring, no backend changes, no route changes. All edits scoped to `src/components/chat/workspace/*`.

## Files to Edit

1. `src/components/chat/workspace/EmptyState.tsx` — full rewrite
2. `src/components/chat/workspace/ConversationsSidebar.tsx` — restyle filters, channels, team
3. `src/components/chat/workspace/ChatComposerPro.tsx` — restyle input, mentions popup, suggestions, send button
4. `src/components/chat/workspace/ChatWorkspace.tsx` — drag handle styling and spring easing
5. `src/components/chat/workspace/MentionPill.tsx` — neutralize colored pill background

No new files. No changes to `ChatWorkspaceContext`, `ConversationView`, `ChannelView`, `DirectAgentView`, bubbles, or orchestration.

---

## 1. New Avatar Convention (Initial Circles)

A single inline helper inside `ConversationsSidebar.tsx` and `ChatComposerPro.tsx` (no shared file added — kept local to scope) that maps agent slug → hex:

```text
scout  #3B82F6
aria   #8B5CF6
penn   #10B981
hawk   #14B8A6
scribe #A855F7
```

Render: 24px (sidebar) / 20px (mention popup) circle, background `${hex}26` (15% alpha), letter in full hex, no ring, no border, no shadow. Used everywhere a portrait used to render. The imported `image` field on `AgentProfile` is simply not read — no data changes.

## 2. EmptyState (full rewrite)

Replaces the centered avatar arc + sparkle header + 4 colored cards.

Layout: left-aligned, padded `px-6 pt-8`, max-width `640px`.

- Top: `<span class="h-1.5 w-1.5 rounded-full bg-[#10B981]" />` + `READY` in `text-[11px] uppercase tracking-wider text-[#7D8590]`.
- Heading: `What needs to get done?` — `text-[28px] font-medium text-[#F0F6FC] leading-tight mt-3`.
- Suggestions list (4 rows). Plain text only:

```text
Find 10 React engineers in London                       Scout
Draft outreach for today's leads                        Penn
What changed at our top 3 competitors today?            Hawk
Write a LinkedIn post about our Q4 wins                 Scribe
```

Each row: full-width button, `flex justify-between items-center`, `py-3`, `border-b border-white/[0.06]`, `hover:bg-white/[0.04]`, transition 150ms. Left text 14px `#F0F6FC`. Right agent name 12px `#7D8590`. No icons, no `@`, no colored text.

Click → calls a new optional `onPickPrompt` consumer. Since `EmptyState` is rendered without props from `ChatWorkspace.tsx`, click behavior: copy text into composer via a tiny shared event. Simplest path: dispatch a `CustomEvent('chat:prefill', { detail })` on `window`; `ChatComposerPro` listens once and sets value + focuses. (No context changes.)

Entrance animation (Framer Motion already in scope):
- ready dot: opacity 0→1, 200ms
- heading: opacity + translateY(8px → 0), 300ms, 100ms delay
- rows: stagger 60ms each, opacity + translateY(4px → 0), 200ms

## 3. ConversationsSidebar

Filters (All / Active / Done):
- Remove the `bg-foreground/5` track and the `bg-card` active pill.
- Render as inline plain-text buttons separated by a 12px gap.
- Inactive: `text-[#7D8590] hover:text-[#F0F6FC]`. Active: `text-[#F0F6FC]`. No background, no border.

Channels:
- Keep `#` prefix (plain text, no icon color).
- Inactive row: `text-[#7D8590] hover:text-[#F0F6FC]`, no background.
- Active row: `text-[#F0F6FC]` + 2px solid white left border (`border-l-2 border-white pl-2`). Width transitions in over 200ms via `transition-[border-width]`.

Your team:
- Replace `<img>` portraits with the initial-letter circle (24px, color map above).
- Drop ring, drop ring-active highlight. Active state: increase letter weight to 600 and switch background alpha from 15%→25%.
- Running indicator: keep small green dot but as a 6px circle bottom-right, no ring around it.

PlanItem rows:
- Keep dot indicator but switch dot color to neutral `bg-white/30` (drop dept color), running dot stays emerald.
- Remove `bg-primary/10` active background; active row uses `text-[#F0F6FC]` + a `border-l-2 border-white pl-2`. Inactive `text-[#7D8590] hover:text-[#F0F6FC]`.

Section labels (`Conversations`, `Channels`, `Your team`): keep, but use `text-[#484F58]` and `text-[10px] tracking-widest`.

Sidebar background stays `bg-background/40`; remove the `border-r border-border/60` in favor of `border-r border-white/[0.06]`.

## 4. ChatComposerPro

Input shell:
- New classes: `flex items-end gap-2 rounded-xl bg-[#131920] border border-white/[0.06] px-3 py-2.5 transition-[border-color] duration-150 focus-within:border-white/[0.12]`.
- Drop the green focus ring + glow (`shadow-[…primary…]`).

Context pill (left, when channel/agent selected):
- Replace primary-colored pill with: `inline-flex items-center gap-1 h-6 px-2 rounded-md border border-white/[0.08] text-[12px] text-[#7D8590]`. Format: `# talent` or `@ Scout` (with single space after symbol). Keep the `X` clear button, neutral icon color.

Textarea:
- Placeholder: `Message your workforce...`
- Placeholder color: `placeholder:text-[#484F58]`.
- Body text: `text-[14px] text-[#F0F6FC]`.

Send button:
- Hidden by default. When `value.trim()` becomes truthy, render a 28px circle `bg-[#10B981]` with white `ArrowUp` icon.
- Animate via Framer Motion: `initial={{ x: 8, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 8, opacity: 0 }}` over 200ms ease-out, wrapped in `<AnimatePresence>`. Use a real `<motion.button>` (Framer Motion already in this codebase).
- Submitting state: keep spinner; same green background.

Quick suggestions:
- Replace pill chips with a single inline row of plain text separated by a middle dot `·`, styled `text-[12px] text-[#484F58]`. Each clickable to set value. No borders, no background, no hover background — only `hover:text-[#7D8590]`.
- Show only when input is empty and focused, same conditions as today.

@ Mention dropdown (`Popup` + `PopupRow`):
- Container: `rounded-lg bg-[#131920] border border-white/[0.08] shadow-[0_8px_24px_rgba(0,0,0,0.4)]`. Drop `bg-popover/95 backdrop-blur-xl`.
- Header strip removed (no "MENTION AN AGENT" label) — Raycast-style: list only.
- Row: 20px initial circle (no portrait), agent name `text-[13px] text-[#F0F6FC]`, role `text-[12px] text-[#7D8590]` truncated, right-aligned green dot only when running.
- Active row: `bg-white/[0.04]`. Hover: `bg-white/[0.04]`.
- Channel popup and command popup follow the same chrome (no header strip, same container, same row hover).

Bottom-right portrait stack:
- Already not rendered in this composer, but verify and remove any residual avatar render. The `OperativeDock` (bottom-right of the workspace shell) is NOT inside the chat workspace — leave untouched per spec ("inside the chat input area" only).

## 5. ChatWorkspace (drawer chrome)

- Drag handle: change to `h-[3px] w-8 rounded-full bg-white/15`, container `pt-2 pb-1`. Double-click to fullscreen retained.
- Drawer entrance transition: replace spring with `transition: { duration: 0.4, ease: [0.32, 0.72, 0, 1] }`. Default open height stays 70vh.
- Drop the emerald top-edge glow (`drawer-edge-glow`) and `border-emerald-500/20`; replace border with `border-white/[0.06]`. (Per spec, green is reserved for ready dot, active states, and send button.)
- Backdrop: keep `bg-black/60 backdrop-blur-sm`.

## 6. MentionPill

Neutralize. The user-bubble text rendering for `@Name` should become a plain-weight token, not a green pill:

```tsx
className="inline-flex items-center px-1 rounded-sm text-[#F0F6FC] bg-white/[0.06]"
```

No primary color, no border.

## Wiring Notes

- `EmptyState` → composer prefill: dispatch `window.dispatchEvent(new CustomEvent('chat:prefill', { detail: text }))`. In `ChatComposerPro`, add a `useEffect` listener that sets `value` and focuses the textarea. No context surface changes.
- Tailwind: hex literals are used inline for the spec colors; existing semantic tokens (`bg-background`, `text-foreground`, `border-border`) stay untouched elsewhere. Per memory note, semantic tokens are preferred — the hex values requested map approximately to existing tokens (`#0D1117`≈`card`, `#131920`≈`surface-elevated`, `#7D8590`≈`text-secondary`, `#F0F6FC`≈`text-primary`, `#10B981`≈`primary`). Where a token already matches, the token will be used; only colors without an exact token (`#484F58`, `#A855F7`, etc.) are inlined.

## Out of Scope

- No edits to `OperativeDock`, `MainLayout`, `Sidebar`, or any page.
- No edits to bubbles other than `MentionPill`.
- No changes to `submitInstruction`, hooks, or Supabase wiring.
- No new dependencies.

## QA Checklist

- Chat opens via `⌘K`, drawer rises with new easing curve.
- Empty state is left-aligned, no portraits, no sparkle, four plain rows.
- Sidebar shows initial-letter circles for all 5 agents; no images.
- Send button hidden until typing; slides in from right.
- `@` popup shows initial circles + role line + optional green status dot.
- No green glows or rings anywhere except the ready dot, active sidebar/channel states, and the send button.
