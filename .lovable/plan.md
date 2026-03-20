

# Firecrawl Live Integration Plan

## Current State

All 10 scrapers already make real Firecrawl API calls and insert into Supabase. The `BrowserFirecrawl` client reads `VITE_FIRECRAWL_API_KEY`. Both pages wire up run buttons correctly.

**What's actually broken / missing:**

1. **API key not set** — `VITE_FIRECRAWL_API_KEY` has no value in the environment, so all calls fail silently
2. **Scrapers use `formats: ['markdown']`** instead of `formats: ['extract']` with structured extraction prompts — results are raw markdown that gets poorly parsed with regex
3. **No rate limiting** — no 500ms delay between consecutive `scrapeUrl` calls
4. **Year references say "2025"** — queries in companyAcquired and spokeAtEvent use 2025
5. **No realtime subscriptions** — pages don't live-update while scrapers run
6. **No API key missing banner** — pages crash or show empty with no explanation
7. **The `firecrawl.ts` client doesn't support `extract` format** — the `scrapeUrl` method just passes `...params`, which works, but scrapers need to use the right params

## Important Security Note

The provided API key (`fc-d5fea...`) is a **private Firecrawl key** being exposed client-side via `VITE_` prefix. This is the existing architecture pattern. I will NOT change this architecture — just make it work as-is. However, migrating to edge functions would be the proper approach for production.

---

## Phase 1: Set API Key

Store `fc-d5fea417d1b04035b44c11e6c72fd7a9` as `VITE_FIRECRAWL_API_KEY` in the codebase (it's already referenced by `import.meta.env.VITE_FIRECRAWL_API_KEY` in `firecrawl.ts`). Since it's a `VITE_` key, it must be in the client code.

## Phase 2: Upgrade All 10 Scrapers to Use Extract Format

For each scraper, replace `formats: ['markdown']` with `formats: ['extract']` and add structured extraction prompts. This gives us clean JSON instead of raw markdown that needs regex parsing.

### Talent Scrapers (5 files)

**openToWork.ts** — Change search calls to include `scrapeOptions` with extract prompt asking for candidate name, title, company, LinkedIn URL, post date, role summary. Fix queries to use "2026". Add 500ms delay between queries.

**layoffVictims.ts** — Change `scrapeUrl` of layoffs.fyi to use extract format with prompt to get company name, layoff date, number affected, departments. Much more reliable than regex parsing markdown tables.

**publishedContent.ts** — Add extract prompts to search calls asking for author name, title, company, article title, URL, date, engagement. Remove regex-based author extraction.

**companyAcquired.ts** — Fix "2025" to "2026". Add extract prompts. Also add TechCrunch M&A page scrape. Remove regex-based company name extraction.

**spokeAtEvent.ts** — Fix "2025" to "2026". Add extract prompts for speaker name, title, company, event name, talk topic, date.

### Competitor Scrapers (5 files)

**pricingMonitor.ts** — Change to extract format with prompt asking for tier names, prices, features, free trial, pricing model. Store structured JSON instead of raw markdown in `pricing_data`. This makes comparison actually meaningful.

**productIntel.ts** — Change blog scrape to extract format asking for post titles, dates, summaries, categories. Remove regex heading extraction (`/#{1,3}/`). Add changelog and ProductHunt scraping.

**reviewSentiment.ts** — Change G2 scrape to extract format asking for rating, review count, recent reviews with pros/cons, common themes. Remove regex-based rating extraction. Add Capterra search.

**executiveChanges.ts** — Already using search correctly. Add extract prompts for structured executive data extraction.

**hiringPatternAnalysis.ts** — No Firecrawl calls needed (reads from Supabase). Just fix: add geographic expansion detection and contraction detection improvements.

### Common Changes Across All Scrapers
- Add `const delay = (ms: number) => new Promise(r => setTimeout(r, ms))` utility
- Add `await delay(500)` between consecutive Firecrawl calls
- Wrap every Firecrawl call in individual try/catch (most already do this)

## Phase 3: Add Realtime Subscriptions to Both Pages

**TalentIntelligence.tsx** — Subscribe to `INSERT` events on `talent_signals` filtered by `user_id`. When new row arrives, prepend to signals state with animation. Unsubscribe on unmount.

**CompetitorIntelligence.tsx** — Same pattern for `competitor_intel_signals`.

## Phase 4: Add API Key Missing Banner

Both pages: check `import.meta.env.VITE_FIRECRAWL_API_KEY` on mount. If missing/empty, show a warning banner: "Firecrawl API key not configured." Disable run buttons.

---

## Files Modified

| File | Change |
|------|--------|
| `src/lib/scrapers/talent/openToWork.ts` | Extract format, fix queries, add delays |
| `src/lib/scrapers/talent/layoffVictims.ts` | Extract format for layoffs.fyi |
| `src/lib/scrapers/talent/publishedContent.ts` | Extract format, remove regex parsing |
| `src/lib/scrapers/talent/companyAcquired.ts` | Extract format, fix year, add TechCrunch |
| `src/lib/scrapers/talent/spokeAtEvent.ts` | Extract format, fix year |
| `src/lib/scrapers/competitors/pricingMonitor.ts` | Extract format, structured pricing comparison |
| `src/lib/scrapers/competitors/productIntel.ts` | Extract format, add changelog/PH scraping |
| `src/lib/scrapers/competitors/reviewSentiment.ts` | Extract format, add Capterra |
| `src/lib/scrapers/competitors/executiveChanges.ts` | Extract prompts |
| `src/lib/scrapers/competitors/hiringPatternAnalysis.ts` | Minor pattern detection improvements |
| `src/pages/TalentIntelligence.tsx` | Realtime subscription + API key banner |
| `src/pages/CompetitorIntelligence.tsx` | Realtime subscription + API key banner |

No new files. No structural changes. Same insertion patterns into Supabase.

