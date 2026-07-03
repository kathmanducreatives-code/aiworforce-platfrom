## Content Command Center — /content redesign

Rebuild `src/pages/Content.tsx` from a static drafts list into an operating surface that connects **Signals → Content → Engagement**, mirroring the same honesty + provider-aware pattern used on `/signals`. Frontend-only, draft-only, no auto-publish, no fake data, no migrations, no secret changes.

### 1. Typography & layout
- Title 30px bold / subtitle 15–16px / section titles 18–20px / card titles 16–18px / body 14–15px / metadata 12–13px / buttons 14–15px semi-bold.
- 2-column grid on lg (`grid-cols-1 lg:grid-cols-12`, left col-span-7, right col-span-5).
- Bottom padding `pb-40` (~160px) so the global command dock never overlaps the last section.

### 2. New components (all under `src/components/content/`)
- `ContentPromptBox.tsx` — "What should Scribe write today?" prompt + 8 example chips + confirmation card (estimated credits, sources used, missing context, "Nothing will be sent until you click Start"). Reuses ProviderBadge classification. Mirrors ScoutPromptBox pattern.
- `CreatePostModal.tsx` — opens on "Create post" with 5 sources: saved signal, product update, founder thought, company brain, pasted URL. Each just dispatches a `chat:send` brief; nothing publishes.
- `ContentDraftCard.tsx` — richer card: title, type, source, status badge, date, preview, next action. Status enum: `needs_input | draft_ready | review_needed | approved | published | blocked`. Actions: Open draft, Add context, Improve hook, Turn into carousel, Mark reviewed (all dispatch chat intents; no server writes here).
- `CommentOpportunityCard.tsx` — same card grammar for comment drafts.
- `SignalToContentCard.tsx` — replaces "Related signals" as **Signals worth turning into content**. Shows title, type, source date, priority, why-it-matters, source proof or "No source proof — use as idea only", "Needs verification" pill for unverified. Actions: Turn into post, Turn into comment, Save idea, Ignore.
- `ContentLoopPreview.tsx` — weekly plan (Mon–Fri suggestions) with empty state and "Build content loop" CTA that opens a small config panel (frequency, topics, ICP, tone, pillars) → dispatches chat brief only.
- `ManualContentSource.tsx` — inputs for LinkedIn URL, Signal URL, company site, product update text, founder thought. Actions: Generate post brief, Draft LinkedIn post, Draft comment, Save as idea. When Firecrawl/Apify unavailable, show "Provider setup needed — you can still paste text manually".
- `ContentEmptyState.tsx` — reusable smart empty states for each section per spec (Comment drafts, Engagement opportunities, Content drafts needing context).

### 3. Page layout
```text
Header (title 30px + subtitle + top CTAs: Create post / Find posts to comment on / Build content loop)
ContentPromptBox
 ┌───────── Left (col-span-7) ─────────┐   ┌──────── Right (col-span-5) ────────┐
 │ Content briefs                      │   │ Comment opportunities              │
 │ Founder post drafts                 │   │ Signals worth turning into content │
 │ ManualContentSource                 │   │ Content loop                       │
 └─────────────────────────────────────┘   └────────────────────────────────────┘
pb-40 spacer
```

### 4. Data sources (unchanged hooks)
- `useSignalFeed(workspaceId)` for `savedOutputs`, `drafts`, `signals`.
- Reuse `useIntegrationReadiness` + existing `ProviderBadge` (`src/components/signals/ProviderBadge.tsx`) for LinkedIn/Firecrawl/Apify readiness so "Find posts to comment on" / manual source states are honest.
- Bucket briefs vs post drafts by `savedOutputs.type` (`brief` → briefs, others → drafts). Comment drafts from `drafts.channel = comment`. Signals filtered to `signal_type` relevant to content (news, funding, hiring, launch, product) with verified-first sort.

### 5. Trust & safety rules
- Never render fake drafts. Empty states never fabricate items.
- All actions dispatch `chat:send` intents or open modals — no direct DB writes from this page, no external send, no auto-post/comment/DM.
- Unverified signals labelled `Needs verification` and cannot be "Turn into post" without a confirm step ("This signal is unverified — continue as idea only?").
- Every content card derived from a signal shows source signal + URL + provider + verified/unverified. Missing proof → `No source proof — use as idea only`.

### 6. Files touched
- Rewrite `src/pages/Content.tsx` (composition only).
- Add the 8 new components above.
- No changes to hooks, edge functions, migrations, secrets, or `SignalFeed`.

### 7. Validation
- `npx tsc --noEmit`
- `npm run build`
- No deno tests (backend untouched).

### 8. Out of scope
- Real posting/commenting integrations, calendar persistence, content-loop DB schema, migrations, edits to migration 145631.

### Final report will include
files changed, UI/typography changes, draft-card improvements, empty-state behavior, signals-to-content behavior, manual source behavior, provider readiness behavior, tsc/build results, remaining gaps.
