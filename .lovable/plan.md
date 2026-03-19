

# Talent Intelligence + Competitor Intelligence — Implementation Plan

## Overview

Two new pages (`/talent-intel` and `/competitor-intel`) sharing a common scraper engine, backed by 4 new Supabase tables, with 10+ scraper modules using the existing Firecrawl client.

---

## Phase 1: Database Migration

Create 4 new tables via Supabase migration:

1. **`talent_signals`** — stores talent movement signals (open_to_work, layoff, published_content, etc.) with candidate info, scoring, tier, action tracking, and optional role match to `screening_jobs`
2. **`competitor_intel_signals`** — stores competitor intelligence signals (pricing_change, new_feature, executive_change, etc.) with importance levels and read/dismiss tracking, FK to `competitor_companies`
3. **`competitor_profiles`** — rich competitor snapshot (positioning, pricing tiers as JSONB, features, team signals, G2 ratings, sentiment) with FK to `competitor_companies`
4. **`pricing_history`** — time-series pricing snapshots per competitor with change detection

All tables get RLS enabled with policies requiring `auth.uid() = user_id` (or join through `competitor_companies.user_id` for competitor tables). `competitor_profiles` and `pricing_history` need a user_id column added (not in original spec but required for RLS) or RLS via a security definer function that checks ownership through the `competitor_companies` FK.

---

## Phase 2: Scraper Engine — `src/lib/scrapers/`

All scrapers use the existing `firecrawl` client from `src/lib/firecrawl.ts` and `supabase` from `@/integrations/supabase/client`. Each accepts `user_id`, logs to `firecrawl_scrape_logs`, and returns a summary.

### Talent Scrapers (`src/lib/scrapers/talent/`)

| File | Firecrawl Method | Signal Type | Scoring Logic |
|------|-----------------|-------------|---------------|
| `openToWork.ts` | `search()` — "open to work" queries | `open_to_work` | Recency + seniority + engagement |
| `layoffVictims.ts` | `scrapeUrl()` — layoffs.fyi | `layoff_victim` | Always 15 (HOT) |
| `publishedContent.ts` | `search()` — dev.to, Medium, Substack | `published_content` | Recency + seniority + engagement |
| `companyAcquired.ts` | `search()` — TechCrunch, Crunchbase | `company_acquired` | Recency-based (12 or 8) |
| `spokeAtEvent.ts` | `search()` — conference sites | `spoke_at_event` | Recency + seniority |
| `runAllTalentScrapers.ts` | Orchestrator | — | `Promise.all` all 5 |

### Competitor Scrapers (`src/lib/scrapers/competitors/`)

| File | Method | Signal Type |
|------|--------|-------------|
| `pricingMonitor.ts` | `scrapeUrl()` on /pricing pages | `pricing_change` |
| `productIntel.ts` | `scrapeUrl()` on /blog, /changelog, ProductHunt | `new_feature`, `content_published`, `positioning_shift` |
| `reviewSentiment.ts` | `scrapeUrl()` on G2/Capterra | `review_trend` |
| `executiveChanges.ts` | `search()` for exec moves | `executive_change` |
| `hiringPatternAnalysis.ts` | Reads `competitor_job_postings` table | `new_job_posting` (pattern-level) |
| `runAllCompetitorScrapers.ts` | Orchestrator | `Promise.all` all 5 |

Each competitor scraper iterates over `competitor_companies` rows for the user, inserts signals to `competitor_intel_signals`, and updates `competitor_profiles` where applicable.

---

## Phase 3: Talent Intelligence Page — `/talent-intel`

**File**: `src/pages/TalentIntelligence.tsx`

Uses existing design system components: `PageHeader`, `MetricCard`, `EmptyState`, `Badge`, `Button`, `Skeleton`.

### Layout (top to bottom):
1. **PageHeader** — "Talent Intelligence" + [Run Scrapers] + [Configure] buttons
2. **MetricCard row** (4 cards) — New Signals Today, HOT Candidates, Matched to Open Roles, Actioned This Week
3. **Role match dropdown** — fetches from `screening_jobs`, filters/sorts signals by `matched_job_id`
4. **Signal type filter pills** — horizontal pill bar with unactioned counts per type
5. **Signal cards** — 2-col grid (1-col mobile), each card shows candidate info, colored signal block (left border by type), role match %, and action buttons (Add to ICP, Add to Outreach, Dismiss)
6. **EmptyState** — Users icon, "No talent signals yet", CTA to run scrapers

### Sub-components (`src/components/talent-intel/`):
- `TalentSignalCard.tsx` — individual signal card with actions
- `SignalFilterPills.tsx` — horizontal filter bar
- `RoleMatchFilter.tsx` — dropdown for screening_jobs

### Actions:
- **Add to ICP** — inserts to `icp_lookalike_sessions` with candidate as seed
- **Add to Outreach** — inserts to `outreach_leads` with trigger_type and signal_summary
- **Dismiss** — sets `is_dismissed = true`

---

## Phase 4: Competitor Intelligence Page — `/competitor-intel`

**File**: `src/pages/CompetitorIntelligence.tsx`

Distinct from existing `/competitors` (job posting tracker). Reuses `AddCompetitorModal` from existing competitor feature.

### Layout (top to bottom):
1. **PageHeader** — "Competitor Intelligence" + [Add Competitor] (reuses existing modal) + [Run Scan]
2. **MetricCard row** (4 cards) — Competitors Tracked, Signals This Week, Pricing Changes, High Importance
3. **High importance alert strip** — warning banner if any HIGH + unread signals exist
4. **Competitor tabs** — one tab per `competitor_companies` row + "All" tab, each with unread badge
5. **Signal feed** — grouped by type in collapsible sections (Pricing Changes, Product & Features, Hiring Patterns, Team Changes, Customer Sentiment, Positioning), each signal card shows company, importance badge, title, summary, source link, mark-as-read
6. **Competitor profile cards** — full snapshot from `competitor_profiles` (positioning, pricing tiers, features, hiring summary, G2 rating, recent moves) with [Rescan] button
7. **EmptyState** — Eye icon, "No competitor intelligence yet", CTA to add competitor

### Sub-components (`src/components/competitor-intel/`):
- `CompetitorIntelSignalCard.tsx`
- `CompetitorProfileCard.tsx`
- `SignalGroupSection.tsx` — collapsible section per signal type
- `ImportanceAlertStrip.tsx`

---

## Phase 5: Routing & Navigation

### `src/App.tsx`
Add two new routes inside ProtectedRoute + MainLayout:
- `/talent-intel` → `<TalentIntelligence />`
- `/competitor-intel` → `<CompetitorIntelligence />`

### `src/components/Sidebar.tsx`
In the "Intelligence" nav group:
- Add `{ path: '/talent-intel', icon: Users, label: 'Talent Intel' }` 
- Add `{ path: '/competitor-intel', icon: Eye, label: 'Competitor Intel' }`
- Rename existing "Competitor Monitor" label to "Job Tracker"

---

## Technical Notes

- All new tables use `(supabase as any)` pattern matching existing codebase (tables not in generated types)
- Tier assignment: score ≥ 15 = HOT, ≥ 8 = WARM, else COLD — computed in scraper before insert
- Firecrawl calls happen client-side via the existing `BrowserFirecrawl` class (not edge functions) — matching existing pattern
- All pages follow `bg-transparent` pattern for grid background visibility
- Loading states use `<Skeleton>` components throughout
- Mobile responsive: signal cards go single-column, filter pills scroll horizontally

---

## Files Created/Modified

| Action | File |
|--------|------|
| Migration | 4 new tables + RLS policies |
| Create | `src/lib/scrapers/talent/openToWork.ts` |
| Create | `src/lib/scrapers/talent/layoffVictims.ts` |
| Create | `src/lib/scrapers/talent/publishedContent.ts` |
| Create | `src/lib/scrapers/talent/companyAcquired.ts` |
| Create | `src/lib/scrapers/talent/spokeAtEvent.ts` |
| Create | `src/lib/scrapers/talent/runAllTalentScrapers.ts` |
| Create | `src/lib/scrapers/competitors/pricingMonitor.ts` |
| Create | `src/lib/scrapers/competitors/productIntel.ts` |
| Create | `src/lib/scrapers/competitors/reviewSentiment.ts` |
| Create | `src/lib/scrapers/competitors/executiveChanges.ts` |
| Create | `src/lib/scrapers/competitors/hiringPatternAnalysis.ts` |
| Create | `src/lib/scrapers/competitors/runAllCompetitorScrapers.ts` |
| Create | `src/pages/TalentIntelligence.tsx` |
| Create | `src/pages/CompetitorIntelligence.tsx` |
| Create | `src/components/talent-intel/TalentSignalCard.tsx` |
| Create | `src/components/talent-intel/SignalFilterPills.tsx` |
| Create | `src/components/talent-intel/RoleMatchFilter.tsx` |
| Create | `src/components/competitor-intel/CompetitorIntelSignalCard.tsx` |
| Create | `src/components/competitor-intel/CompetitorProfileCard.tsx` |
| Create | `src/components/competitor-intel/SignalGroupSection.tsx` |
| Create | `src/components/competitor-intel/ImportanceAlertStrip.tsx` |
| Modify | `src/App.tsx` — add 2 routes |
| Modify | `src/components/Sidebar.tsx` — add 2 nav items, rename 1 |

