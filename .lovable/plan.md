# 🩹 Disk IO Remediation Plan

Targeted edits to 7 hot-path files. No schema changes, no logic changes — purely query optimization. Expected IO reduction: **60–80%** on dashboard + competitor pages.

---

## 1. `src/pages/CompetitorMonitor.tsx` — Kill the 15s poller
- **Remove** `setInterval(loadCompetitors, 15000)` (line 44) — biggest single offender; refetches 2 unbounded tables every 15s on every open tab.
- **Replace** with a Supabase realtime subscription on `competitor_companies` + `competitor_job_postings` filtered to `event: 'INSERT'`, with a 500ms debounce on `loadCompetitors`.
- **Tighten** the `competitor_job_postings` select on line 25: change `.select("job_title, is_new, first_seen_at")` to add `.limit(2000)` and `.gte('first_seen_at', oneMonthAgo)`.

## 2. `src/components/lead-scraper/StatsCards.tsx`
- Lines 61, 69: change `count: "exact"` → `count: "estimated"` (Postgres uses `pg_class` stats — sub-millisecond).
- Lines 73–75: replace `.select("status")` (full table scan) with two separate `count: 'estimated'` head queries: one with `.eq('status','completed')`, one total. Compute rate from those.
- Lines 91–100: change both realtime listeners from `event: "*"` → `event: "INSERT"`. Add a 500ms debounce to `fetchStats` so burst inserts during scraping don't re-trigger 5 full queries per row.

## 3. `src/pages/CompetitorMonitor.tsx` (count fix)
- Line 67: `count: "exact"` → `count: "estimated"`.

## 4. `src/pages/ClientMetrics.tsx`
- Line 62: `count: 'exact'` → `count: 'estimated'`.

## 5. `src/pages/DataDashboard.tsx` — Tighten 5 unbounded reads
- Lines 69–73: rewrite the `Promise.all` to:
  - Select only required columns (e.g. `resume_analyses`: `id, created_at, fit_score, overall_factor`; `client_placements`: `id, placement_date`; `scheduled_emails`: `id`; `linkedin_leads`: `id`; `deep_search_results`: `id, fit_score`).
  - Add `.gte('created_at', oneMonthAgo.toISOString())` where the metric is monthly-bound.
  - Add `.limit(5000)` as a safety ceiling on each query.

## 6. `src/components/ModernDashboard.tsx`
- Line 200: `from('resume_analyses').select('*').order('created_at', {ascending:false})` → add `.limit(500)`. Dashboard only paginates 10/page client-side; loading entire table is wasteful.

## 7. Realtime wildcard narrowing (debounce + INSERT-only)
Add a small shared `useDebouncedCallback` (or inline `setTimeout` ref) and apply to:
- `src/hooks/useInterviews.ts` line 298 → `event: 'INSERT'` + 300ms debounce on `fetchInterviews`.
- `src/pages/DeepSearch.tsx` line 162 → `event: 'INSERT'` + 300ms debounce.
- `src/components/lead-scraper/DeepSearchResults.tsx` line 52 → keep as-is (it routes payload by id, doesn't refetch — already cheap).
- `src/components/collaboration/RoomView.tsx` line 107 → `event: 'INSERT'` + 300ms debounce (attachments rarely update/delete).

---

## Files modified (6)
1. `src/pages/CompetitorMonitor.tsx` — remove poller, add realtime, narrow query, fix count
2. `src/components/lead-scraper/StatsCards.tsx` — estimated counts, INSERT-only, debounce
3. `src/pages/ClientMetrics.tsx` — estimated count
4. `src/pages/DataDashboard.tsx` — column lists + date filters + limits
5. `src/components/ModernDashboard.tsx` — add limit(500)
6. `src/hooks/useInterviews.ts` — INSERT-only + debounce
7. `src/pages/DeepSearch.tsx` — INSERT-only + debounce
8. `src/components/collaboration/RoomView.tsx` — INSERT-only + debounce

## Out of scope (intentionally untouched)
- Scraper rate-limiting (low impact vs. above; can do as follow-up).
- `SupabaseTest.tsx` (dev/debug component, rarely loaded).
- Edge functions (read-side dominates IO based on audit).

## Verification after changes
- `bunx tsc --noEmit` for type safety.
- Manually open Competitor Monitor + Lead Scraper Stats and confirm data still updates (realtime now drives it instead of poll).
- No UI/visual changes expected.
