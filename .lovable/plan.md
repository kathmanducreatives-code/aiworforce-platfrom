# Phase 5 — Signal Feed UI Polish

Frontend-only polish. No backend, schema, edge function, or memory writer/reader changes. All actions continue to dispatch through the existing `chat:send` CustomEvent.

## Files to change

- `src/components/signals/SignalCard.tsx` — rewrite layout into two columns; show context-specific fields; contextual action set; cleaner reviewed state.
- `src/components/signals/SignalFeed.tsx` — bottom padding for composer overlap, tab counts, polished active state, filter-empty state, prompt chips in empty state.
- `src/lib/signalFeedModel.ts` — extend `FeedSignal` with extra optional fields read out of `raw` (fit_score, account/company, contact/person, role, location, post_snippet, reason). No new data invented — only surfacing fields if present in the existing `raw` JSON.
- (optional) `src/pages/Signals.tsx` — wrap with the standard page container if needed for the bottom-padding fix.

No changes to: `src/lib/signalsFeed.ts`, `src/hooks/useSignalFeed.ts`, any supabase function, migration, or memory module.

## 1. Card layout (two-column)

Desktop (`md:` and up): CSS grid `grid-cols-[1fr_220px] gap-4`.
- **Left rail** (main content): type+priority badges, title, signal_label sub-line, description (line-clamp-4), account/contact line, lead reason, "matched query" line, action buttons row.
- **Right rail** (metadata panel): vertical key/value list inside a softly bordered panel `rounded-md border border-white/[0.06] bg-white/[0.015] p-2.5 text-[11px]`. Items shown only if value exists:
  - Priority (colored pill)
  - Type
  - Source (domain extracted from `source_url` if `source` empty)
  - Created (relative + tooltip with ISO)
  - Fit score (if present in raw)
  - Confidence (competitor_confidence)
  - Competitor (name · category)
  - Conversation type
  - Matched query (truncated)

Mobile (`<md`): single column; metadata panel stacks below content.

## 2. Contextual content per signal_type

Render a small sub-section above actions:

- **competitor_engagement**: "Competitor" block — name, category, source tag (`ai_inferred`/`post_content`/`seed`), confidence %, conversation_type, matched_query, business description / website context if present.
- **linkedin_engagement**: author/person, company/title, post snippet (from `raw.post_snippet` or description), source link.
- **hiring_signal**: company, role, location, "why this matters" (from `raw.reason` if present), source link.
- **people_profile**: name, title, company, link.
- Generic fallback: title + description only.

All fields are read from existing `signal` + `signal.raw`. If a field is missing, the line is omitted. If description is missing entirely show muted "No detailed reason saved yet."

## 3. Contextual actions (still chat:send only)

Helper `actionsForSignal(s)` returns:

- competitor_engagement → Draft comment, Draft DM, Enrich, Mark reviewed, Source
- linkedin_engagement → Draft comment, Draft DM, Enrich, Mark reviewed, Source
- hiring_signal → Enrich company, Draft outreach, Source, Mark reviewed
- people_profile → Enrich, Draft outreach, Source, Mark reviewed
- default → Enrich, Draft outreach, Source, Mark reviewed

Source button hidden when `source_url` is null. All other actions dispatch existing `buildActionCommand(...)` via the existing `sendToPilot` helper. No new network paths.

## 4. Reviewed state

Already client-side via `reviewed: Set<string>` in `SignalFeed`. Polish:
- Reviewed card: `opacity-60`, a small "Reviewed" check chip top-right next to priority badge.
- Button label toggles "Mark reviewed" ⇄ "Reviewed".
- Persistence not added (memory: "no schema changes").

## 5. Fix composer overlap

Add `pb-[180px]` (or `pb-44`) to the root `<div>` in `SignalFeed.tsx`. Verify last card is fully scrollable above the floating composer at 1056×777 and at mobile width.

## 6. Tabs + filters polish

- Tab buttons get counts computed client-side from `signals`/`drafts`/`savedOutputs` (e.g. `LinkedIn (12)`). Counts only shown when > 0.
- Active tab: solid emerald underline + emerald text; inactive: muted with hover.
- Filters row: align with `flex flex-wrap items-center gap-2`, consistent control heights (h-8), monospace-free.
- When filtered list is empty but signals exist: show "No signals match these filters." with a "Clear filters" button that resets `query`, `priority`, `hasSource`.

## 7. Empty state

When `signals.length === 0`:
- Existing empty copy.
- Add 3 prompt chips that dispatch `chat:send`:
  - "Find companies hiring GTM roles"
  - "Find LinkedIn posts about AI SDRs"
  - "Find competitor conversations for my company"

## 8. Loading + error

- Replace the plain "Loading signals…" with 3 skeleton card placeholders using existing `Skeleton` component.
- Keep error banner; ensure Retry button styling matches other buttons.

## 9. Model additions (purely surfacing existing `raw` data)

Add optional fields on `FeedSignal` read out of `raw`:
```ts
fit_score: number | null;          // raw.fit_score
account_name: string | null;       // raw.account_name | raw.company | raw.company_name
contact_name: string | null;       // raw.contact_name | raw.person_name | raw.author
role_title: string | null;         // raw.role | raw.title
location: string | null;           // raw.location
post_snippet: string | null;       // raw.post_snippet | raw.snippet
reason: string | null;             // raw.reason | raw.why
```
No invented values — null when absent. Existing tests in `signalFeedModel.test.ts` continue to pass; add 2–3 cases for the new fields.

## 10. Verification

- `bunx vitest run src/lib/signalFeedModel.test.ts`
- Build/typecheck runs automatically.
- Visual check: `/signals` at 1056×777 and 390×844.
  - Two-column layout on desktop, stacked on mobile.
  - Last card not hidden under composer.
  - Competitors tab shows full Phase 4 metadata.
  - Reviewed dims the card and changes label.

## Out of scope (will NOT do)

- No DB schema, migrations, edge functions, memoryWriter/Reader, actor registry changes.
- No auto-send/comment/DM/email.
- No Phase 6 work.
- No persistence of reviewed state.
- No deploy.

## Final report will include

Files changed, visual diff summary, overlap fix confirmation, competitor metadata confirmation, reviewed-state behavior, confirmation actions remain `chat:send`-only, typecheck result, any remaining gaps, PR #7 readiness.
