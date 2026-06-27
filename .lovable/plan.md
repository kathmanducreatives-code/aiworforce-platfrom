# Signal Feed v1 — ICP-Aware Market Radar

Turn `/signals` into a working radar that defaults to 10 ICP-matched signals across hiring, LinkedIn intent, competitor conversations, and workflow trends — sourced through capability-gated providers, scored, deduped, and editable by the user.

## Scope guardrails (from brief)
- No landing-page changes. No new migration (reuse existing `signals` table + `company_brain.profile` JSON). Migration `145631` untouched.
- No auto-send / auto-DM / auto-comment / auto-post / auto-email anywhere.
- No fake signals — unavailable sources render "setup-needed" cards.
- Live QA in TEST only, <$5 spend.

## 1. Storage (reuse, no migration)
- **Signals**: existing `public.signals` row (`signal_type`, `signal_label`, `title`, `description`, `source_url`, `source`, `raw`, `conversation_id`, `plan_id`). New status/score/priority/why/matched_icp/next_action live inside `raw` so we avoid a migration. `normalizeSignalRow` already surfaces several of these.
- **Preferences**: `company_brain.profile.signal_preferences` (new JSON sub-object). Read/write via existing `useCompanyBrain` + a small upsert helper.

```ts
signal_preferences: {
  keywords, competitors, hiring_roles, linkedin_topics,
  workflow_topics, geographies, industries, disqualifiers,
  default_mix: { hiring, linkedin_intent, competitors, workflows, people },
  frequency: 'weekly' | 'daily' | 'manual',
}
```
Defaults derived from Company Brain (`icp.industries`, `icp.buyer_roles`, `competitors.known`, `icp.geography`, `gtm.*`) when the field is empty.

## 2. Backend — new edge function `run-radar-scan`
`supabase/functions/run-radar-scan/index.ts` (JWT-validated, workspace-scoped).

Inputs: `{ workspace_id, mode: 'default'|'load_more'|'category', category?, limit? }`.

Pipeline:
1. Load `company_brain.profile` + `signal_preferences` (fallback to defaults).
2. Capability check via existing `integration-readiness` logic — Apify (hiring/people), Firecrawl (workflow/page extract), LinkedIn actor (intent posts).
3. Build per-category queries from ICP + prefs. Default mix = 3 hiring / 3 LinkedIn intent / 2 competitor / 2 workflow trends (10 total).
4. Run only ready providers in parallel. Skipped categories return `{ status: 'setup_needed', reason }`.
5. Normalize → dedupe (URL + title hash + 7-day window using existing rows) → score via new `_shared/signalQuality.ts` `evaluateSignalQuality()`.
6. Reject disqualifier matches, weak/no-action signals, irrelevant geographies (strict mode).
7. Persist accepted signals to `signals` table with `raw.score`, `raw.priority`, `raw.why_it_matters`, `raw.matched_icp`, `raw.next_action`, `raw.status='new'`.
8. Return `{ signals: [...], per_category: {hiring: {found, accepted, status}, ...}, credits_used }`.

Modes:
- `default` — first run, returns up to 10.
- `load_more` — appends N more (default 10), requires `confirmed: true` body flag.
- `category` — targeted scan from chat ("find LinkedIn posts about AI SDRs").

## 3. Scoring helper — `supabase/functions/_shared/signalQuality.ts`
Pure function (testable, no imports):
```ts
evaluateSignalQuality({ signal, companyBrain, signalPreferences, sourceType })
  → { accepted, priority, score, reason, matched_icp, missing_context, next_action }
```
Weights: ICP industry/role match (+), competitor keyword match (+), recency (decay), source confidence (provider-driven), intent verbs ("looking for", "hiring", "frustrated with"), disqualifier hit (hard reject), geography mismatch in strict mode (reject), no clear action (reject).

## 4. Frontend rewrite — `src/components/signals/SignalFeed.tsx`

Replace current empty-feeling layout with:

### Header
"Signal Feed — Your ICP-aware market radar" + Scout subtitle. Actions row: `Run radar scan`, `Edit radar`, `Refresh`, `Rank by fit`, `Load more`. Credit note line.

### Radar summary (4 cards) — `RadarSummaryCards.tsx` (new)
Hiring · LinkedIn intent · Competitor conversations · Workflow trends. Each shows count, ready/setup-needed badge, top keyword from prefs, last scan time, category CTA.

### Signal list
Reuse `SignalCard.tsx`, extend to show: priority pill, why-it-matters block, matched-ICP chips, next-action button. Sort by `priority → score → recency`. Empty state = premium card with "Run your first ICP radar scan to load 10 signals" CTA.

### Edit Radar drawer — `EditRadarDrawer.tsx` (new)
Sheet with type-ahead chip inputs for industries, personas, geographies, competitors, keywords, pain points, hiring roles, workflow topics, disqualifiers; sliders for default mix; frequency select. Saves to `company_brain.profile.signal_preferences`.

### Load-more confirm — `LoadMoreConfirmDialog.tsx` (new)
Modal: "Load 10 more signals? Scout will scan additional sources based on your radar settings. Estimated cost: ~X credits. Nothing will be sent." Requires explicit confirm before the edge call.

### Setup-needed cards — `SetupNeededCard.tsx` (new)
Per-category explainer with link to Settings → Integrations.

## 5. Hook + data layer
- `src/hooks/useSignalFeed.ts` — extend with `runRadarScan(mode, opts)`, `perCategoryStatus`, `lastScanAt` (read from most recent row), preferences read/write.
- `src/lib/signalPreferences.ts` (new) — defaults builder from Company Brain, validation.
- `src/lib/signalFeedModel.ts` — extend normalizer to surface `priority`, `score`, `why_it_matters`, `matched_icp`, `next_action`, `status` from `raw`.

## 6. Chat / Pilot routing
Add Scout capability + route in existing intent router:
- "find more signals this week" / "find LinkedIn posts about X" / "show competitor conversations for X" → invoke `run-radar-scan` via Pilot's tool layer, surface confirmation card before external scans, then post Scout's summary line and link to `/signals`.
- Wire through existing `_shared/toolRegistry.ts` (new tool: `run_radar_scan`) and `intentRouter.ts` — no new orchestration framework.

## 7. Actions on a signal
Card buttons (no auto-send): Save · Ignore · Mark reviewed · Turn into lead (existing lead candidate flow) · Find decision-maker (Pilot prompt) · Enrich company · Create LinkedIn post (drafts only) · Add to Workflow Radar (writes to `saved_outputs`). All update `raw.status` via an RPC-free direct update (RLS already scoped).

## 8. Tests
- `src/lib/signalPreferences.test.ts` — defaults from brain, override merge, disqualifier validation.
- `supabase/functions/_shared/signalQuality.test.ts` — default mix totals 10, ICP keyword influence, disqualifier rejects, duplicate rejects, hiring/competitor/workflow scoring, geography strict mode, no-action reject.
- `src/components/signals/SignalFeed.test.tsx` (light) — empty state renders, load-more shows confirm, setup-needed renders when capability missing.

## 9. Browser QA (TEST workspace, <$5)
Scenarios A–E from brief: empty → first scan → edit radar → load more confirm → save/ignore/review filters. Verify no outbound side effects.

## 10. Validation
```
deno test supabase/functions/_shared --allow-all
npx tsc --noEmit
npm run build
deno check supabase/functions/pilot-chat/index.ts || true
deno check supabase/functions/run-agent/index.ts || true
deno check supabase/functions/run-radar-scan/index.ts
```

## Files

**New**
- `supabase/functions/run-radar-scan/index.ts`
- `supabase/functions/_shared/signalQuality.ts` (+ `.test.ts`)
- `supabase/functions/_shared/signalSources.ts` (provider adapters: hiring/Apify, linkedin/actor-or-skip, competitor/Firecrawl, workflow/Firecrawl)
- `src/lib/signalPreferences.ts` (+ `.test.ts`)
- `src/components/signals/RadarSummaryCards.tsx`
- `src/components/signals/EditRadarDrawer.tsx`
- `src/components/signals/LoadMoreConfirmDialog.tsx`
- `src/components/signals/SetupNeededCard.tsx`

**Modified**
- `src/components/signals/SignalFeed.tsx` (full layout rebuild)
- `src/components/signals/SignalCard.tsx` (priority, why-it-matters, matched-ICP, next-action)
- `src/hooks/useSignalFeed.ts` (radar scan, prefs, per-category status)
- `src/lib/signalFeedModel.ts` (surface new `raw.*` fields)
- `src/lib/companyBrainSchema.ts` (add `signal_preferences` typing — additive, no migration)
- `supabase/functions/_shared/toolRegistry.ts` + `intentRouter.ts` (Scout `run_radar_scan` tool)
- `supabase/functions/pilot-chat/index.ts` (route radar intents; emit confirmation card before scan)

**Not touched**: landing, migration `145631`, any other migration files, env/secrets.

## Out of scope / deferred
- Weekly cron / scheduled radar (manual scan only in v1; preferences include frequency for v2 cron).
- People/profile provider (renders setup-needed unless `APIFY_ENABLE_PEOPLE_SEARCH=true`).
- New DB columns for status/score (kept in `raw` to honor no-migration rule).
