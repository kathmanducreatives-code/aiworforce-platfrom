# Premium Workbench + Resizable Layout Redesign

Two-part scope: (1) make the chat ↔ Workbench split truly resizable and stable at every size, (2) collapse the messy Workbench tabs into a clean **Table / Insights / Activity** structure that feels like a premium AI execution surface, not a debug viewer.

No backend logic, no migrations, no auto-send. UI/layout/presentation only.

---

## 1. Resizable chat + Workbench layout

File: `src/components/chat/workspace/ResizableWorkspaceSplit.tsx` (rewrite for correctness + polish).

- CSS Grid: `gridTemplateColumns: ${chatPx}px 6px 1fr`, both columns `minmax(0, …)` via `min-w-0` children.
- Default ratio **0.4** (chat 40 / workbench 60). Persist to `localStorage` key `agentory:workspace-split-ratio` on `pointerup`. Restore on mount.
- Constraints: chat min **380px**, workbench min **620px**, chat max **60%**, workbench max **75%** (i.e. chat min ≥ 25%).
- Drag implementation: `pointerdown` → `setPointerCapture` + rAF-throttled `pointermove` updating ratio; `pointerup`/`pointercancel` releases + saves.
- Double-click divider → reset to 0.4 + persist.
- While dragging: add body class disabling text selection + forcing `col-resize` cursor globally; subtle emerald glow on divider; centered grip handle.
- Container `overflow-hidden`; each pane is `flex flex-col min-w-0 min-h-0 overflow-hidden`.
- Responsive fallback: if container `< 1000px` (min chat + min wb + divider), `ChatWorkspace` swaps the split for a **Chat | Workbench** tabbed view (already present — keep & verify threshold).

## 2. Conversation history

- Already a drawer/overlay (no layout shrink). Verify: closes on Escape, outside click, close button; never creates a new conversation.

## 3. Chat panel polish (at all widths)

Files: `ChatView.tsx`, `bubbles/LeadSourceCard.tsx`, composer.

- Message list `flex-1 overflow-auto` + bottom padding ≥ composer height so messages aren't hidden.
- User bubbles: `max-w-[min(680px,85%)] break-words` — never collapse to vertical single-column text.
- Composer pinned at bottom, width = pane width, no horizontal scroll.
- `LeadSourceCard`: consume `ChatPaneWidthContext`; grid is `grid-cols-2` when pane ≥ 520px, else `grid-cols-1`. Card padding stays comfortable, badges/icons aligned, "Nothing will be sent" caption always visible, no truncation by ellipsis on critical copy.

## 4. Workbench redesign — only 3 tabs

File: `src/components/chat/workspace/workbench/WorkbenchPanel.tsx` (major refactor).

New tab union:
```ts
type Tab = 'table' | 'insights' | 'activity';
```

- **Default tab: `table`**, always. Never default to summary/sources/raw.
- Remove `summary`, `sources`, `rankings`, `drafts`, `leads`, `raw` from the visible tab bar. The underlying views are reused inside the new tabs (no deletion of view files needed):
  - `LeadResultsView` + `AgentOutputViewer` + `AriaRankingView` + `PennDraftView` render inside **Table**, chosen by data shape.
  - `SummaryView` + `HawkResearchView` (collapsed source list) render inside **Insights**.
  - Activity list stays in **Activity**.
- **Raw JSON tab removed from UI.** Keep `RawJsonView` file but gate any usage behind `import.meta.env.DEV` (dev-only debug bar at the very bottom of the panel, collapsed). No actor payloads, dataset IDs, tracking IDs, or Apify response surfaces in production UI.

## 5. Header redesign (`WorkbenchHeader.tsx`)

- Small `WORKBENCH` eyebrow (kept).
- Title rules for lead panels:
  - account-only: `N account opportunities found`
  - contact-ready: `N contact-ready leads found`
  - mixed: `N opportunities · M contacts found`
  - non-lead: concise task title (not raw prompt).
- Subtitle (lead): `Scout found companies showing intent. Unlock decision-makers, enrichment, and outreach when ready.`
- Original prompt rendered as small secondary line `Request: …`, truncated.
- Chip row simplified: Source · Signal · Status · Actor · Count. Drop dataset/run IDs from the visible chip set.
- Sticky header + sticky tab bar; refresh + close on the right.

## 6. Recommended action banner

A single slim banner above the table, only when `panel.recommended_next_action` (or inferred) exists:
```
Recommended next: Find decision-makers
These companies show intent, but no contacts are attached yet.
[ Run · ~5c ]
```
- One primary action only. Compact (one row at wide width, two rows at narrow).
- Paid actions go through existing confirmation flow + `dispatchResultAction`, preserving `conversation_id`.

## 7. Table tab redesign (`LeadResultsView.tsx` + `leadTable/*`)

Columns (lead/account opportunities):
`Company · Signal · Recommended Persona · Decision Maker 🔒 · Contact Info 🔒 · Company Enrichment 🔒 · Personalized Message 🔒 · Fit · Status`

- **Company**: name, domain status (`No website` chip when missing), location.
- **Signal**: meaningful label (e.g. `Hiring signal · Head of GTM Enablement · LinkedIn Jobs`) instead of generic "company".
- **Recommended Persona**: from `panel.recommended_persona.primary` (Founder/CEO/VP Sales/Head of Growth/etc.); fallback `Suggested after ranking`.
- **Locked cells** become click-to-unlock CTAs:
  - Decision Maker → `Find decision-maker · ~1c`
  - Contact Info → `Needs decision-maker` (if none) / `Unlock contact info · ~1c`
  - Company Enrichment → `Research company · ~1c` / `Needs domain`
  - Personalized Message → `Needs contact` / `Generate draft · ~2c`
- **Fit**: existing score chip. **Status**: existing badge.
- Table scrolls horizontally inside its own `overflow-x-auto` wrapper; never causes page horizontal scroll. Sticky first column on narrow widths.

## 8. Actions simplification

- Default global actions (top-right of table): `Find decision-makers · Rank · Export`. `Draft` only when ≥1 row has a contact.
- Bulk toolbar appears only when rows are selected: `Find decision-makers · Research companies · Rank selected · Generate outreach (when contacts) · Export selected · Save selected`.
- Every action: preserves `conversation_id`, uses `dispatchChatAction`/`dispatchResultAction`, confirms credits for paid, never sends/posts/DMs/emails.

## 9. Insights tab (new composition)

Sections, each a small card:
1. **What Scout found** — 1-sentence summary from panel/task.
2. **Why it matters** — heuristic from signal type (jobs → growth/pipeline pressure, etc.).
3. **What's missing** — checks `contact_status`, missing domains, missing personas.
4. **Recommended next** — same source as banner, slightly expanded.
5. **Search strategy** — exact query + broadening terms from task payload.
6. **Sources used** (collapsed `<details>`): provider + count; "View source links" reveals list. No raw long URLs by default.

## 10. Activity tab

- Clean timeline list: `HH:MM · Title` + optional one-line body.
- Map `event_type` to friendly labels (`tool_call_started` → `… started`, etc.). Hide raw provider blobs.

## 11. Empty / fallback states

Polished cards (replace generic "No results") for: no contacts, no websites, no drafts, actor unavailable — copy per spec.

## 12. Files changed

Edited:
- `src/components/chat/workspace/ResizableWorkspaceSplit.tsx`
- `src/components/chat/workspace/ChatWorkspace.tsx` (verify responsive fallback threshold + key wiring)
- `src/components/chat/workspace/ChatView.tsx` (bubble width + composer padding)
- `src/components/chat/workspace/bubbles/LeadSourceCard.tsx` (grid reflow via pane width)
- `src/components/chat/workspace/workbench/WorkbenchPanel.tsx` (3-tab refactor, default `table`, dev-only raw)
- `src/components/chat/workspace/workbench/WorkbenchHeader.tsx` (title/subtitle/chip rules)
- `src/components/chat/workspace/workbench/LeadResultsView.tsx` + `leadTable/*` (columns, locked CTAs, internal h-scroll, recommended banner)
- `src/components/chat/workspace/workbench/OutputActionBar.tsx` (compact default actions + bulk variant)

New:
- `src/components/chat/workspace/workbench/InsightsView.tsx`
- `src/components/chat/workspace/workbench/ActivityTimeline.tsx`
- `src/components/chat/workspace/workbench/RecommendedActionBanner.tsx`

Kept but no longer in tab bar (reused inside Table/Insights or dev-only):
- `SummaryView.tsx`, `HawkResearchView.tsx`, `AriaRankingView.tsx`, `PennDraftView.tsx`, `RawJsonView.tsx` (dev-only).

## 13. Verification

- Build passes (auto).
- Browser QA at 1280×800 and 1057×778:
  - Default opens 40/60; drag resizes live; double-click resets; refresh restores ratio.
  - Only `Table · Insights · Activity` tabs visible; Table is default; no Raw/Sources visible.
  - Lead Source Selector reflows 2→1 col under ~520px chat pane.
  - No page horizontal scroll at any split.
  - Composer stays pinned; no message hidden behind it.
  - Actions preserve conversation; no auto-send.

## 14. Out of scope

Landing page, backend logic, DB migrations, edge functions, auth, any auto-outbound.
