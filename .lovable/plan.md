## Multi-Scenario Apify Actor Registry

Extend the existing Actor Intelligence Layer to cover 8 actors (4 new) with env-based overrides, richer Gemini routing, and Workbench/Plan Card surface for disabled actors. No UI redesign, no backend project changes, no removed systems.

### 1. Rewrite `supabase/functions/_shared/actorRegistry.ts`

Replace the current `ACTOR_REGISTRY` with the full 9-entry spec from the user message:

- `apify_jobs` — enabled, `curious_coder/linkedin-jobs-scraper`
- `apify_advanced_linkedin_jobs` — disabled, `curious_coder/linkedin-jobs-search-scraper` (NEW)
- `apify_indeed_jobs` — disabled, `curious_coder/indeed-scraper`
- `apify_website_content` — disabled, `apify/website-content-crawler`
- `apify_custom_web` — disabled, `apify/web-scraper`
- `apify_people_search` — disabled, `harvestapi/linkedin-profile-search` (renamed from `people_profile_actor`, requires_explicit_opt_in)
- `apify_profile_enrichment` — disabled, `atomus/linkedin-profile-scraper` (NEW)
- `firecrawl_scrape_url` — enabled
- `search_web` — disabled

Add env overrides (read once at module load via `Deno.env.get`):

| Env var | Effect |
|---|---|
| `APIFY_ACTOR_JOBS` | overrides `apify_jobs.actor_id` |
| `APIFY_ACTOR_ADVANCED_LINKEDIN_JOBS` | overrides `apify_advanced_linkedin_jobs.actor_id` |
| `APIFY_ACTOR_INDEED_JOBS` | overrides `apify_indeed_jobs.actor_id` |
| `APIFY_ACTOR_WEBSITE_CONTENT` | overrides `apify_website_content.actor_id` |
| `APIFY_ACTOR_CUSTOM_WEB` | overrides `apify_custom_web.actor_id` |
| `APIFY_ACTOR_PEOPLE_SEARCH` | overrides `apify_people_search.actor_id` |
| `APIFY_ACTOR_PROFILE_ENRICHMENT` | overrides `apify_profile_enrichment.actor_id` |
| `APIFY_ENABLE_ADVANCED_LINKEDIN_JOBS` / `APIFY_ENABLE_INDEED_JOBS` / `APIFY_ENABLE_WEBSITE_CONTENT` / `APIFY_ENABLE_CUSTOM_WEB` / `APIFY_ENABLE_PEOPLE_SEARCH` / `APIFY_ENABLE_PROFILE_ENRICHMENT` | flips `enabled` to true (value `"1"`/`"true"`/`"yes"`) |

Defaults: `apify_jobs` and `firecrawl_scrape_url` enabled; everything else disabled.

Helpers unchanged in shape: `getActorByKey`, `getEnabledActors`, `isActorRuntimeEnabled` (still gated by `required_env`, e.g. `APIFY_API_TOKEN` / `FIRECRAWL_API_KEY`), `summarizeRegistryForPrompt`. Add `resolveActorForIntent({source_type, has_url, mentions_indeed, mentions_advanced, people_intent, enrichment_intent})` used by the planner fallback. Keep `PEOPLE_INTENT_RE`, `COMPANY_INTENT_RE`, `AMBIGUOUS_ROLE_RE`; add `INDEED_INTENT_RE`, `ADVANCED_JOBS_INTENT_RE`, `ENRICHMENT_INTENT_RE`, `MULTIPAGE_CRAWL_INTENT_RE`, `LINKEDIN_URL_RE`.

### 2. Update `supabase/functions/_shared/toolInputPlanner.ts`

- Reinject the larger `summarizeRegistryForPrompt()` (now 9 actors with `enabled` state) into the Gemini prompt and add explicit routing rules in the system instruction matching the 7 scenarios from the spec (hiring → `apify_jobs`; advanced LinkedIn → `apify_advanced_linkedin_jobs` if enabled else fall back to `apify_jobs`; Indeed/avoid-LinkedIn → `apify_indeed_jobs`; people search → `apify_people_search`; profile enrichment with LinkedIn URLs → `apify_profile_enrichment`; specific URL → `firecrawl_scrape_url`; multi-page crawl → `apify_website_content`; niche directories → `apify_custom_web`).
- After AI merge, re-validate `selected_actor_key`. If the chosen actor is disabled, do not silently swap to `apify_jobs`:
  - `apify_advanced_linkedin_jobs` disabled → fall back to `apify_jobs`, set `reason` accordingly.
  - `apify_indeed_jobs` disabled → set `ask_clarification = true` with message "Indeed Jobs actor is not configured. I can use LinkedIn Jobs instead." (pre-select `apify_jobs` as proceed-default).
  - `apify_people_search` disabled → no tool, `ask_clarification = true` using `apify_people_search.missing_message` + companies-hiring offer.
  - `apify_profile_enrichment` disabled → no tool, `ask_clarification = true` with "Profile enrichment actor is not configured."
  - `apify_website_content` / `apify_custom_web` disabled → `ask_clarification` explaining disabled state, suggest Firecrawl if a URL is present.
- Result caps: fast mode default 25 (jobs), people search 10, enrichment 3–5, outreach drafts 3–5 — enforce via clamps on `max_results` per actor's `default_max_results` / `max_safe_results`.

### 3. Update `supabase/functions/orchestrate/index.ts`

- Multi-tool plans (already partially in place). Confirm the planner's `selected_actor_key` propagates into `step.metadata.selected_actor_key` for every expanded step. Add specific expansions:
  - "enrich the top N" after sourcing → Hawk `scrape_url` with `firecrawl_scrape_url` (cap N at 3–5).
  - "draft outreach" / "send" → Penn step, approval-gated, cap drafts at 3–5.
  - LinkedIn profile URLs in prompt → `apify_profile_enrichment` step (only when enabled, else clarification).
- `annotateTools` / `TOOL_LIMITATION_MESSAGE`: read disabled-actor `missing_message` from the registry so each new disabled actor surfaces its own message.
- Suppress auto-execution whenever `requires_clarification = true` (already exists; just verify path for new actor keys).

### 4. Update `supabase/functions/run-agent/index.ts` and `_shared/toolRegistry.ts`

- `run-agent`: keep using `tool_input_body.selected_actor_key`; pass through unchanged. No behavioural change beyond accepting the new keys.
- `toolRegistry.execSourceWithApify`: when resolving a `selected_actor_key`, look it up in the registry, check `isActorRuntimeEnabled`, then resolve `actor_id`. On disabled/missing, return `{ ok: false, unavailable: true, error: "actor_missing", data: { actor_key, source_type, reason, configured_actor_keys, missing_message } }` so the Workbench can show the configuration-needed copy.
- Keep `OPT_IN_ONLY_ACTOR_IDS`; ensure `apify_people_search` and `apify_profile_enrichment` actor IDs are in that set (people/profile compliance).

### 5. Minimal UI surface changes

No redesign. Show the new actor metadata using existing components:

- `src/components/chat/workspace/plan/ExecutionTaskRow.tsx`: already shows `actorKey` + `actorReason`. Add a small "disabled — configuration needed" pill when `task.payload.metadata.actor_disabled === true` (set by orchestrate from registry lookup) and surface `missing_message` underneath.
- `src/components/chat/workspace/workbench/WorkbenchHeader.tsx` and `ScoutResultsView.tsx`: add `Actor enabled: yes/no` and `Configuration: <missing_message>` lines next to the existing actor label/id/output_type/reason block, read from `toolCall.input_json.selected_actor_key` → registry summary already returned by the edge function (no new fetch).

### 6. Verification

After deploy, run the 6 prompts from the spec against agentory.space and capture for each:
- `selected_actor_key` returned by planner
- `step.metadata.selected_actor_key`, `actor_disabled`, `actor_reason`
- Whether clarification was asked vs auto-run
- Workbench display (label, id, output_type, enabled, missing_message)
- Multi-tool expansion order (Scout → Hawk → Aria → Penn) for prompt 6

### Technical detail

Files changed:
- **Edit:** `supabase/functions/_shared/actorRegistry.ts`
- **Edit:** `supabase/functions/_shared/toolInputPlanner.ts`
- **Edit:** `supabase/functions/_shared/toolRegistry.ts`
- **Edit:** `supabase/functions/orchestrate/index.ts`
- **Edit:** `supabase/functions/run-agent/index.ts`
- **Edit:** `src/components/chat/workspace/plan/ExecutionTaskRow.tsx`
- **Edit:** `src/components/chat/workspace/workbench/WorkbenchHeader.tsx`
- **Edit:** `src/components/chat/workspace/workbench/ScoutResultsView.tsx`
- **Deploy:** `orchestrate`, `run-agent`, `pilot-chat` (pulls shared files)

Out of scope: new tables, RLS, secret creation, enabling people/profile actors by default, removing existing tools or UI surfaces, redesign of Workbench/Plan cards. New people/profile actors stay disabled with `missing_message`; users enable them via the env flags above.
