## Goal

Clean up tool routing so Apify is only used for structured actors (jobs / hiring / company data / niche scrapers). The broad web search lane stays on `search_web` (Gemini/Lovable grounded search), and `apify/google-search-scraper` becomes an opt-in fallback that is disabled by default.

No UI, backend project, secret, or feature removal changes.

## Scope

One file: `supabase/functions/_shared/toolRegistry.ts`

Orchestrator/run-agent routing is already correct (hiring → `source_with_apify`, broad/current → `search_web`, URL → `scrape_url`), so no changes needed there.

## Changes

### 1. Replace `APIFY_ACTORS` map (toolRegistry.ts ~L318-348)

New shape adds `source_type`, `enabled_by_default`, and `use_for` per the spec, and removes the unused `companies`/`linkedin_posts`/`comments`/`websites`/`generic` placeholders that currently advertise `null` actors:

```ts
const APIFY_ACTORS: Record<string, ApifyActorCfg> = {
  jobs: {
    actor_id: "curious_coder/linkedin-jobs-scraper",
    source_type: "jobs",
    enabled_by_default: true,
    use_for: ["hiring signals", "companies hiring roles", "job openings"],
    description: "LinkedIn jobs search with company details",
    input_adapter: /* unchanged */,
  },
  indeed_jobs: {
    actor_id: "curious_coder/indeed-scraper",
    source_type: "indeed_jobs",
    enabled_by_default: false,
    use_for: ["Indeed jobs", "non-LinkedIn hiring signals", "backup jobs source"],
    description: "Indeed jobs scraper (backup hiring source)",
  },
  website_content: {
    actor_id: "apify/website-content-crawler",
    source_type: "website_content",
    enabled_by_default: false,
    use_for: ["website content fallback if Firecrawl fails"],
    description: "Website content crawler — fallback if Firecrawl fails",
  },
  custom_web: {
    actor_id: "apify/web-scraper",
    source_type: "custom_web",
    enabled_by_default: false,
    use_for: ["custom websites", "directories", "niche job boards"],
    description: "Generic web scraper for niche/custom sites",
  },
  search_fallback: {
    actor_id: "apify/google-search-scraper",
    source_type: "search",
    enabled_by_default: false,
    use_for: ["optional fallback only if grounded search is unavailable and user explicitly enables it"],
    description: "Google SERP via Apify — opt-in fallback only",
  },
};
```

`ApifyActorCfg` type extended with `source_type: string`, `enabled_by_default: boolean`, `use_for: string[]`.

### 2. Gate disabled actors in `execSourceWithApify` (~L434-453)

When the planner/orchestrator picks an actor via `source_type` or explicit `actor_id`:
- Look up the registry entry by `source_type` (falling back to scanning by `actor_id`).
- If the resolved actor has `enabled_by_default === false` AND the caller did not pass `allow_disabled: true` in input, return:
  ```ts
  { ok: false, unavailable: true, error: "apify_actor_disabled_by_default",
    data: { actor_id, source_type, use_for, message: "Actor is opt-in; enable explicitly via allow_disabled." } }
  ```
- Specifically guard `apify/google-search-scraper`: even with explicit `actor_id`, require `allow_disabled: true` so it never becomes the default broad-search path.

This keeps the orchestrator's existing "search_web unavailable" honesty intact — it will no longer silently fall through to Apify SERP scraping.

### 3. Keep `search_web` as-is

`search_web` already returns `{ ok: false, unavailable: true, error: "broad_web_search_not_configured" }` until a grounded backend is wired. No change. The orchestrator already prefers `source_with_apify` for hiring shape and `search_web` for broad/current work — routing is already correct.

### 4. No changes to

- `toolInputPlanner.ts` (already routes hiring → `source_with_apify`, URL → `scrape_url`, broad → `search_web`)
- `orchestrate/index.ts`, `run-agent/index.ts` (already use the same routing)
- Firecrawl `scrape_url` path
- Approvals / Execution Plan Card / Daily Brief / Company Brain / activity_feed

## Verification

- `source_type: "jobs"` request → runs `curious_coder/linkedin-jobs-scraper` (unchanged).
- `source_type: "indeed_jobs" | "website_content" | "custom_web" | "search"` without `allow_disabled` → returns `apify_actor_disabled_by_default` (surfaces as a ToolStatusBadge warning, not a silent run).
- Broad research prompt with no grounded backend → `search_web` returns `broad_web_search_not_configured` (existing behavior); orchestrator reports honestly instead of falling through to SERP Apify.
- No frontend, no secrets, no schema changes.