# Signals Storage — File-by-File Writer & Reader Inventory

Companion to `signals-storage-audit.md`. Read-only; every reference below was located in the tree at
main `0fa4d1f7`. No runtime code or data was changed.

## Writers into `public.signals`

### W1 — `writeApifyPeople` → `people_profile`  (identity evidence)
- **File**: `supabase/functions/_shared/memoryWriter.ts:515-596`; insert at `:557-573`.
- **Entry**: `writeMemoryFromToolCall` (`:277`) → branch `isPeopleOutput(out)` (`:290`-ish) → `writeApifyPeople`.
- **Caller in run-agent**: `run-agent/index.ts:1925` (dynamic import) inside `if (finalPersistSet.length > 0)` (`:1889`), `output.items = rawItems` = accepted-only.
- **signal_type**: `people_profile`; **source**: `apify_people`; **source_url**: LinkedIn `/in/` URL; **raw**: `p.raw` (provider profile).
- **Related writes**: `contacts.upsert(onConflict workspace_id,linkedin_url)` (`:544`); `lead_candidates.insert(signal_id = new signal, contact_id)` (`:582`).
- **Dedup**: none on `signals`. **Failure**: best-effort (surrounding try/catch at `index.ts:1955`).
- **Gate**: persisted/qualified leads only (source_and_qualify_only). Runs AFTER qualification.

### W2 — jobs memory → `hiring_signal`  (opportunity)
- **File**: `memoryWriter.ts:406-462`; `signal_type: "hiring_signal"` at `:414`.
- **Stage**: tool-call memory for `source_with_apify` jobs output. **Dedup**: none. Best-effort.

### W3 — LinkedIn engagement → `linkedin_engagement` / `competitor_engagement`
- **File**: `memoryWriter.ts:627-714`; insert at `:678`; `signalType` chosen at `:633`.
- **Stage**: tool-call memory for `apify_linkedin_posts`/`apify_linkedin_profile_posts`. Best-effort.

### W4 — competitor commenters → `competitor_engagement`
- **File**: `memoryWriter.ts:750-791`; insert at `:778`, `signal_type` at `:786`.

### W5 — Scout Radar → `hiring_signal` (+ others)
- **File**: `supabase/functions/run-radar-scan/index.ts:329` (`admin.from("signals").insert(kept)`).
- **Dedup**: app-level — reads existing rows at `:200` (`select id, source_url, title, signal_type, raw, created_at`) and filters `kept` before insert.

## Readers of `public.signals`

### R1 — Signals feed (frontend)
- **Helper**: `src/lib/signalsFeed.ts:27-33` `fetchSignals(workspaceId, limit)` — `select id, workspace_id, signal_type, signal_label, title, description, source_url, source, created_at, conversation_id, plan_id, raw`, `eq workspace_id`, `order created_at desc`.
- **Component**: `src/components/signals/SignalFeed.tsx` — per-tab `signal_type` filters at `:78-85`; counts at `:153-160`; People tab predicates at `:80,156,318,326`.
- **Card**: `src/components/signals/SignalCard.tsx:10` — `people_profile` colour class.
- **people_profile treatment**: rendered as a **People** feed item (identity), not as a buying signal.

### R2 — Radar dedup read
- `run-radar-scan/index.ts:200` — reads existing signals to avoid re-inserting duplicates.

### R3 — Plan summary count
- `run-agent/index.ts:2650` — `count … eq plan_id` (metric only; no content consumption).

### Lifecycle table — `signal_reviews`
- Migration `supabase/migrations/20260613130000_phase6_signal_reviews.sql`.
- `signal_id → signals(id) ON DELETE CASCADE`; unique `(workspace_id, user_id, signal_id)`; status `new|reviewed|ignored|saved|actioned`.

## Structural consumer

- `lead_candidates.signal_id → signals(id) ON DELETE SET NULL` (migration `20260611080445_…:108`).
- `lead_candidates` dedupe unique index includes `coalesce(signal_id,…)` (`:129-135`) — the people_profile row is part of a people-sourced lead's dedupe identity.

## Live TEST aggregate (read-only, sanitized)

`signal_type × source` counts: `hiring_signal/apify_jobs` 217 · `competitor_engagement/apify_linkedin_posts`
96 · `linkedin_engagement/apify_linkedin_posts` 84 · `people_profile/apify_people` 25 ·
`linkedin_engagement/apify_linkedin_profile_posts` 5. Total 427. `confidence` NULL on all 427.
427/427 referenced by a `lead_candidate.signal_id`. 60 duplicate `(signal_type,title)` groups.
`signal_reviews`: 4 rows.
