# Add Apify as a live sourcing tool

Mirrors the existing Firecrawl pattern. Backend-only, server-side token, no UI redesign, no architectural change.

## Step 1 — Secret

Request `APIFY_API_TOKEN` via the secure secrets prompt (not chat, no `VITE_` prefix). Confirm Edge Functions can read it.

## Step 2 — `source_with_apify` in `supabase/functions/_shared/toolRegistry.ts`

Add a new tool entry alongside `research_web` / `scrape_url` / `send_email`:

- name: `source_with_apify`
- provider: `apify`
- allowed_agents: `["scout", "hawk"]`
- requires_approval: `false`
- env: `APIFY_API_TOKEN`

Input schema (validated): `{ actor_id?, source_type, search_goal, query?, location?, role_keywords?, max_results=50, input? }`.

Execution (`execSourceWithApify`):
1. If `APIFY_API_TOKEN` missing → `{ ok:false, unavailable:true, error:"apify_not_configured" }`.
2. Resolve `actor_id` — explicit input wins; otherwise look up in `APIFY_ACTORS[source_type]`. If none configured → `{ ok:false, unavailable:true, error:"apify_actor_not_configured", data:{ source_type, message:"Apify is connected, but no actor is configured for this source type yet." } }`.
3. Build actor input from `{ query, location, role_keywords, max_results, ...input }` (merged, user `input` wins).
4. `POST https://api.apify.com/v2/acts/{actor_id}/runs?token=...` with JSON body.
5. Poll `GET /v2/actor-runs/{runId}` every 3s up to ~90s (`AbortController`, single retry on 5xx, 800ms backoff).
6. On `SUCCEEDED` → `GET /v2/datasets/{defaultDatasetId}/items?clean=true&limit={max_results}`.
7. Map 401/403 → `unavailable:"apify_unauthorized"`; 402/`MONTHLY_USAGE_HARD_LIMIT_EXCEEDED` → `unavailable:"apify_insufficient_credits"`; timeout → `failed:"apify_run_timeout"` with `run_id` preserved.
8. Normalize items (Step 5) and return:
   ```
   { actor_id, run_id, dataset_id, items, total, summary, citations }
   ```
9. `tool_calls.output_json` stores normalized payload (raw kept inside `items[].raw`, truncated). Activity feed writes `tool_used`/`tool_failed` like Firecrawl — `runTool` already does this.

## Step 3 — Actor config (top of file)

```ts
const APIFY_ACTORS: Record<string, { actor_id: string | null; description: string }> = {
  jobs:          { actor_id: null, description: "Find companies hiring for specific roles" },
  companies:     { actor_id: null, description: "Find companies matching a query" },
  linkedin_posts:{ actor_id: null, description: "Find people posting about hiring/problems" },
  comments:      { actor_id: null, description: "Find comments on relevant posts" },
  websites:      { actor_id: null, description: "Scrape arbitrary websites via actor" },
  generic:       { actor_id: null, description: "Fallback generic actor" },
};
```

All start `null`. Step 4 fills the first one.

## Step 4 — Ask for first actor ID

Once `APIFY_API_TOKEN` is added, ask the user (chat question) for the **jobs/hiring** actor ID — recommended first use case "Find companies hiring marketing roles in London". Only `jobs` is configured for v1.

## Step 5 — Normalization

`normalizeApifyItem(raw, source_type)` returns:
```
{ name, company, title, url, location, description, source:"apify",
  signal_type, confidence:null, raw:<truncated raw> }
```
- `signal_type` derived from `source_type` (`jobs→"hiring"`, `linkedin_posts→"post"`, etc.).
- Field mapping is best-effort across common Apify shapes (`title|jobTitle|name`, `companyName|company|employer`, `url|link|jobUrl`, `location|city`, `description|snippet|text`). Missing fields stay `null` — no hallucination.

## Step 6 — Wire Scout in `supabase/functions/run-agent/index.ts`

Add a sibling to the existing Firecrawl block, gated on `agent_slug === "scout"`:
- Heuristic: instruction matches any of `/find (companies|leads|founders|prospects|candidates)|hiring|job openings|roles|linkedin posts|comments/i`.
- Infer `source_type`: `hiring|jobs|roles` → `jobs`; `companies|founders|prospects` → `companies`; `linkedin|posts` → `linkedin_posts`; `comments` → `comments`; else `generic`.
- Extract `location` (simple `\bin ([A-Z][\w\s]+)` regex), `role_keywords` (split known role nouns), `max_results=25`.
- Call `runTool("source_with_apify", { source_type, search_goal: instruction, query, location, role_keywords, max_results })`.
- Append `APIFY:` block to `userMessage` with normalized items (compact JSON, capped). Never block on unavailable/failed — fall through to whatever else (Firecrawl) returned.

## Step 7 — Wire Hawk lightly

Same block, but only when `agent_slug === "hawk"` AND inferred `source_type ∈ {"jobs","companies"}`. No LinkedIn/posts for Hawk in v1.

## Step 8 — Orchestrate planning rules

In `supabase/functions/orchestrate/index.ts` (system prompt / few-shot section), add a sourcing rule:

> When user asks to **find companies / leads / hiring signals / job openings / prospects**, produce plan `Scout → Aria → Penn`:
> - Scout task `tool_needed: "source_with_apify"`, `provider: "apify"`, plus `source_type`, `query`, `location`, `role_keywords`, `max_results`, `expected_output`, `success_criteria`.
> - Aria ranks by ICP fit.
> - Penn drafts outreach, `requires_approval: true`.

No schema change to `tasks` — metadata already a jsonb column.

## Step 9 — Execution Plan Card

In `src/components/chat/workspace/plan/ExecutionPlanCard.tsx`:
- Extend `TOOL_PROVIDER_KEY` with `source_with_apify: "apify"`.
- Extend `connectorMissingKeys` parser to recognize `"apify"` in `connector_limitations`.

In `src/components/chat/workspace/plan/ExecutionTaskRow.tsx` / `ToolStatusBadge.tsx` (status badge already renders `queued|running|succeeded|failed|unavailable`):
- Add label "Apify" when `provider==="apify"`.
- Render distinct `unavailable` sub-states from `tool_calls.error`: `apify_not_configured` → "Apify not configured", `apify_actor_not_configured` → "Actor missing", `apify_unauthorized` → "Auth failed", `apify_insufficient_credits` → "Out of credits".
- Show `output_json.total` as "N results" when succeeded; show `run_id` (last 6 chars) as a muted suffix. No token, no full dataset.

## Step 10 — Testing

After deploy:
1. `"Find companies hiring marketing roles in London"` — Scout→Aria→Penn plan; Scout row shows Apify status; if jobs actor set, items return; if not, "Actor missing".
2. `"Find early-stage companies hiring React engineers"` — same path, `source_type=jobs`.
3. `"Find founders posting about hiring marketers"` — `linkedin_posts` actor null → unavailable with clear message, no hallucinated leads.
4. `"Research competitor hiring signals"` — Hawk uses `source_with_apify` with `source_type=jobs`.

Smoke each via `supabase--curl_edge_functions` against `pilot-chat` and inspect `tool_calls` row.

## Step 11 — Safety

- All Apify calls server-side; token never leaves Edge Functions.
- Penn stays approval-gated (unchanged).
- `max_results` clamped 1..100. Run timeout 90s. Raw item truncated to ~4KB each.
- No private/auth-walled scraping unless explicitly authorized.
- No auto-outreach.

## Files touched

- `supabase/functions/_shared/toolRegistry.ts` — add tool + actor config + normalizer.
- `supabase/functions/run-agent/index.ts` — Scout/Hawk Apify branch.
- `supabase/functions/orchestrate/index.ts` — planning rule for sourcing.
- `src/components/chat/workspace/plan/ExecutionPlanCard.tsx` — provider mapping.
- `src/components/chat/workspace/plan/ExecutionTaskRow.tsx` (+ `ToolStatusBadge.tsx` if needed) — Apify status labels.

No DB migrations. No RLS changes. No frontend token exposure.

## Final report (after build)

Will confirm: token status, jobs actor configured (or waiting on actor ID), files changed, tool behavior, Scout wiring, normalization shape, Execution Plan Card states, test outcomes, remaining actors pending.
