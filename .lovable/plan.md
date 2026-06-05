# Replace Perplexity-first messaging with Apify + Firecrawl as primary live-data tools

## Audit — where the Perplexity messaging comes from

| Location | Issue |
|---|---|
| `supabase/functions/pilot-chat/index.ts:358-360` | Builds the literal string "Live data via {X} requires a connector — add the API key in Settings to enable it." from `connectors_missing` returned by orchestrate. This is the warning the user sees. |
| `supabase/functions/orchestrate/index.ts:69-74` | `TOOL_FRIENDLY` maps `PERPLEXITY_API_KEY → "Perplexity"`, so any missing env name surfaces as "Perplexity" in `connectors_missing`. |
| `supabase/functions/orchestrate/index.ts:170-256, 315-339, 379-424` | Fallback plans for `intelligence`, `brief`, `content (current)`, and `general` default `tool_needed` to `research_web`. When `PERPLEXITY_API_KEY` is missing (it is — not in project secrets), `annotateTools` flags it as `connector_required` and pushes "Perplexity" into `connectors_missing`. |
| `supabase/functions/orchestrate/index.ts:521-578` (planner prompt) | Tells the AI planner that `research_web (perplexity)` is a first-class tool, encourages C/E archetypes to use it. |
| `supabase/functions/run-agent/index.ts:117, 200-216` | Hawk/Scout flow runs `research_web` and surfaces "Live web research (Perplexity) is not configured" notes. |
| `supabase/functions/daily-brief/index.ts:138-147, 189-191` | Daily Brief lists "Connect Perplexity…" as a recommended action and the intel section says live research requires Perplexity. |
| `supabase/functions/setup-company-brain/index.ts:121` | Onboarding warning "Live enrichment requires Perplexity or Firecrawl." |
| `supabase/functions/_shared/toolRegistry.ts:41-101, 595-602, 629-634` | `research_web` tool definition + `TOOL_ENV` mapping. |
| `src/components/chat/workspace/plan/ToolStatusBadge.tsx:13-20` | `TOOL_PROVIDER_HINT.research_web = 'Perplexity'`. |
| `src/components/chat/workspace/plan/ExecutionPlanCard.tsx:31-36, 70-80` | Maps `research_web → perplexity` and bubbles "perplexity" into the amber warning row. |

Project secrets present: `APIFY_API_TOKEN`, `FIRECRAWL_API_KEY`, `RESEND_API_KEY`, `LOVABLE_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_AI_API_KEY`. **`PERPLEXITY_API_KEY` is not configured.** No Gemini Enterprise / grounded-search connector is linked either, so a real `search_web` tool cannot be added in this iteration — it will be a stub that reports `unavailable`.

## Changes

### 1) `toolRegistry.ts`
- Keep `research_web` (Perplexity) as an optional fallback — no removal.
- Add a new tool entry `search_web` with `provider: "gemini_search"` whose `execute` returns `{ ok: false, unavailable: true, error: "broad_web_search_not_configured" }` until a grounded-search backend is wired. Allowed agents: `hawk`, `scout`. No env in `TOOL_ENV`, but `isToolConfigured("search_web")` returns `{ ready: false, env: "GEMINI_SEARCH" }` so orchestrate/daily-brief treat it as not configured without naming Perplexity.
- Export a small helper `getPrimaryLiveDataTool(intent)` that returns:
  - `sourcing` / `intelligence` (hiring-shaped) → `source_with_apify`
  - `extraction` (URL present) → `scrape_url`
  - `intelligence` (broad market) → `search_web` if ready, else `research_web` if ready, else null

### 2) `orchestrate/index.ts`
- Rework `TOOL_FRIENDLY` to map env → friendly label without surfacing "Perplexity" for tools that didn't request it. Add: `APIFY_ACTORS_JOBS_MISSING → "Apify jobs actor"`, `GEMINI_SEARCH → "Broad web search"`. Keep `PERPLEXITY_API_KEY → "Perplexity"` only for steps whose `tool_needed === 'research_web'`.
- Add `intent === "sourcing"` heuristic refinement: any prompt matching hiring/job/role/company keywords forces the first step to use `source_with_apify` (Scout/Hawk), not `research_web`.
- In `fallbackPlan` and `expandPlan`, change defaults:
  - `intelligence` with hiring/job keywords → Hawk uses `source_with_apify` (not `research_web`).
  - `intelligence` with broad market keywords → Hawk uses `search_web` (will be `unavailable`); orchestrate produces a friendly limitation "Broad web search is not configured. Hiring-signal sourcing via Apify is available." instead of "Perplexity".
  - `brief` → drop the Perplexity-dependent "Live market pulse" step. Add it only if `search_web` or `research_web` is ready.
  - `general` default tool → null (let Scribe answer from workspace) instead of `research_web`.
- `annotateTools`: when a step's tool is unavailable, push a human-readable string into `connectors_missing` based on the actual tool, not the env name. Examples:
  - `source_with_apify` missing token → `"Apify token missing"`
  - `source_with_apify` missing actor (detected by checking `APIFY_ACTORS.jobs` env or static config) → `"Apify jobs actor missing"`
  - `scrape_url` → `"Firecrawl missing"`
  - `search_web` → `"Broad web search unavailable"`
  - `research_web` → `"Perplexity not configured (optional)"` — only included if a step actually selected it.
- Update planner prompt: relabel `research_web` as "(optional fallback)", relabel `source_with_apify` as the primary for company/lead/hiring/jobs/posts research, mention `search_web` as the broad-web option that may be unavailable.

### 3) `pilot-chat/index.ts`
- Replace the hardcoded `"Live data via {X} requires a connector — add the API key in Settings to enable it."` string with a friendlier, tool-aware sentence built from the new `connectors_missing` strings (already human-readable from orchestrate). Drop the "add the API key in Settings" copy entirely — connectors are workspace-level and the user shouldn't see provider names they didn't ask for. New copy: `Heads up: ${connectors_missing.join("; ")}. I'll continue with available tools.`

### 4) `run-agent/index.ts`
- Branch on `tool_needed`:
  - If `source_with_apify` or `scrape_url`, do not run the legacy Perplexity fallback path; rely on toolRegistry.
  - If `research_web` and Perplexity is not configured, return a clean `unavailable` note rather than "Live web research (Perplexity)…" string; instead say "Broad web research is not configured for this workspace. Continuing with available context."
- Remove the line that hard-codes "Perplexity / Firecrawl / Apollo / Apify connector" guidance.

### 5) `daily-brief/index.ts`
- Replace the connector status block with:
  - `Lovable AI Gateway: active`
  - `Apify hiring signals: configured | token missing | actor missing`
  - `Firecrawl page extraction: configured | missing`
  - `Broad web search: unavailable (no grounded search connector)`
  - `Perplexity: not configured (optional fallback)`
- Replace the "Connect Perplexity…" recommended action. Only add a Perplexity recommendation if the user explicitly opted into broad web search before. By default, recommend completing Company Brain, connecting Apify if missing, connecting Firecrawl if missing.
- Replace `sectionIntel` copy with: `"Broad web search is not configured. I can still pull hiring signals via Apify and extract specific URLs via Firecrawl."` when `search_web`/`research_web` are unavailable.

### 6) `setup-company-brain/index.ts`
- Update the enrichment warning to: `"Live enrichment requires Firecrawl. Continuing with manually entered data."` (drop Perplexity).

### 7) `ToolStatusBadge.tsx` (frontend)
- Update `TOOL_LABEL` / `TOOL_PROVIDER_HINT`:
  - `source_with_apify → "Apify"`
  - `scrape_url → "Firecrawl"`
  - `search_web → "Gemini Search"`
  - `research_web → "Perplexity (optional)"`
- Status `unavailable` handling already exists; just make sure `source_with_apify` and `scrape_url` show "Apify ready"/"Firecrawl ready" badges instead of Perplexity warnings.

### 8) `ExecutionPlanCard.tsx` (frontend)
- Replace the `connectorMissingKeys` parsing block to handle the new human-readable strings: match on `apify`, `firecrawl`, `broad web search`, `perplexity`. Don't emit a Perplexity warning when no `research_web` step exists in the plan.
- The amber `connector_limitations` row at line 135 stays, but its content will now be the new tool-aware sentences instead of "Perplexity".

### 9) Agent prompts (in `run-agent/index.ts` and planner prompt)
- Scout/Hawk: prefer Apify for company/job sourcing, Firecrawl for URL analysis. Don't reference Perplexity in copy.
- Aria/Scribe/Penn: unchanged behavior, but copy is updated to drop Perplexity dependencies.

### 10) Verification (after build mode)
Run smoke tests in deployed preview:
- `Find companies hiring marketing roles in London` → expect plan: Scout(source_with_apify) → Aria → Scribe, **no** Perplexity warning, Apify badge.
- `Find companies hiring marketing roles in London and draft outreach` → adds Penn(draft_outreach, approval).
- `Hawk, scrape https://stripe.com/jobs and tell me what they're hiring for` → Hawk(scrape_url) Firecrawl, no Perplexity warning.
- `What changed in the market today?` → plan includes Hawk(search_web) which is unavailable; banner says "Broad web search is not configured…".
- `Brief me on today` → Daily Brief shows Apify configured, Firecrawl configured, Broad web search unavailable; no "Connect Perplexity" recommendation.

## Files touched
- `supabase/functions/_shared/toolRegistry.ts`
- `supabase/functions/orchestrate/index.ts`
- `supabase/functions/pilot-chat/index.ts`
- `supabase/functions/run-agent/index.ts`
- `supabase/functions/daily-brief/index.ts`
- `supabase/functions/setup-company-brain/index.ts`
- `src/components/chat/workspace/plan/ToolStatusBadge.tsx`
- `src/components/chat/workspace/plan/ExecutionPlanCard.tsx`

## Non-goals (per user constraints)
- No UI redesign, no backend project change, no removal of Pilot/orchestrate/run-agent/toolRegistry/Apify/Firecrawl/Daily Brief/Execution Plan Cards/Company Brain/approvals/activity_feed.
- No frontend API keys, no direct tool calls from frontend.
- `search_web` is wired into the registry and labeled, but its `execute` returns `unavailable` until a real grounded-search connector (e.g. Gemini Enterprise with `webGroundingSpec`) is linked. The plan is to honestly report unavailability rather than fake live data.
