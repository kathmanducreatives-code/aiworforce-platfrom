# Firecrawl `scrape_url` wiring

Scope: backend only. No UI changes. No Perplexity work. Architecture unchanged.

## Step 1 — Secret

`FIRECRAWL_API_KEY` is not in the project's edge-function secrets list. I'll request it via Lovable's secure secrets flow (`add_secret`). No `VITE_` prefix, never reaches the frontend.

If the user prefers, they can instead link the **Firecrawl connector** (gateway-based). For v1 I'll use the direct REST API + `FIRECRAWL_API_KEY` env var, matching the existing pattern used by `research_web` (Perplexity) and `send_email` (Resend). This keeps `isToolConfigured("scrape_url")` working as-is.

## Step 2 — Upgrade `scrape_url` in `supabase/functions/_shared/toolRegistry.ts`

Replace the stub `execScrapeUrl` with a real Firecrawl v2 implementation. Keep the `ToolDef` (provider `firecrawl`, allowed_agents `["hawk","scout"]`, `requires_approval: false`) and the `TOOL_ENV` mapping unchanged.

Input schema (validated server-side):
```ts
{ url: string (http/https), extraction_goal?: string, max_pages?: number (1..5, default 1) }
```

Behavior:
- Validate `url` (must parse, http/https only) → 400-style `{ ok:false, error:"invalid_url" }` on fail.
- `max_pages === 1` (default): call `POST https://api.firecrawl.dev/v2/scrape` with `{ url, formats:["markdown","summary"], onlyMainContent:true }`.
- `max_pages > 1`: call `POST /v2/crawl` with `{ url, limit: clamp(max_pages,1,5), scrapeOptions:{ formats:["markdown"] } }`, poll status endpoint up to ~25s, then return aggregated docs. If still running at timeout, return `{ ok:true, data:{ partial:true, ... } }` with whatever pages came back.
- 25s `AbortController` timeout, single retry on 5xx (mirrors `execResearchWeb`).
- 402 (insufficient credits) → return `{ ok:false, unavailable:true, error:"firecrawl_insufficient_credits" }` so the agent surfaces a clear "connector unavailable" message instead of hallucinating.
- 401/403 → `{ ok:false, unavailable:true, error:"firecrawl_unauthorized" }`.
- Return shape on success:
  ```ts
  { ok:true, data:{
      url, markdown, summary?, title?, source_url, metadata,
      extraction_goal,        // echoed back so the agent can keep context
      pages?: [{ url, markdown, metadata }],  // only for max_pages>1
      truncated?: boolean
  }}
  ```
- All `tool_calls` / `activity_feed` writes already handled by the surrounding `runTool` — no changes needed there.

## Step 3 — Wire into `run-agent`

In `supabase/functions/run-agent/index.ts`, the hawk/scout branch currently always calls `research_web`. Extend it so Firecrawl is used when the instruction targets a specific URL, and Perplexity is gracefully skipped while it remains unconfigured.

Logic (only for `agent_slug === "hawk" || "scout"`, before composing `userMessage`):

1. Extract URLs from `instruction` + `input` with a simple regex (`/https?:\/\/[^\s)]+/g`), dedupe, cap at 3.
2. If URLs found:
   - For each (≤3), call `runTool("scrape_url", { url, extraction_goal: instruction, max_pages: 1 }, ctx)`.
   - Concatenate successful `markdown` (truncated to ~6k chars each) into `SCRAPED CONTENT` block with source URLs.
   - Collect any `unavailable` / failure into `toolNotice`.
3. Then attempt `research_web` exactly as today. If it's `unavailable` (Perplexity not configured), keep the existing graceful notice and DO NOT fail the step.
4. Compose `userMessage` with whichever of `toolContext` (research) + `scrapedContext` (firecrawl) succeeded. If both fail/unavailable, fall back to the existing `toolNotice` path so the agent acknowledges the limitation and proceeds without fabrication.

No schema changes. No changes to `pilot-chat`, `orchestrate`, `toolRegistry.runTool` plumbing, Execution Plan Cards, or RLS. `ToolStatusBadge` already handles `firecrawl` via the `scrape_url` label.

## Step 4 — Deploy & test

Deploy `run-agent` (toolRegistry is bundled via relative import, so deploying `run-agent` picks up the new code; also deploy `daily-brief`, `pilot-chat`, `orchestrate` if they import the registry — confirmed only `run-agent` does).

Manual test matrix (no code changes needed, just verification):
1. Without `FIRECRAWL_API_KEY`: hawk task with a URL → `tool_calls` row `status=unavailable`, activity_feed shows "Firecrawl not configured", agent output acknowledges limitation.
2. With key set, valid URL → `tool_calls.status=succeeded`, output includes markdown, agent answer cites the page.
3. Invalid URL → `tool_calls.status=failed`, error `invalid_url`.
4. Scout task with company URL in instruction → scrape succeeds, ICP-style summary returned.
5. Hawk task with no URL → behaves as today (only research_web path; currently unavailable → graceful notice).

## Files changed

- `supabase/functions/_shared/toolRegistry.ts` — real `execScrapeUrl` (v2 scrape + optional crawl, 402/401 handling).
- `supabase/functions/run-agent/index.ts` — URL-detection branch that calls `scrape_url` before/in addition to `research_web`.
- Secret added: `FIRECRAWL_API_KEY` (via secure flow, server-only).

## Out of scope

- No frontend changes.
- No Perplexity changes (stays "unavailable" until you decide to enable).
- No new tables, migrations, or RLS edits.
- No connector-gateway rewrite (can be a follow-up if you'd rather use the Lovable Firecrawl connector instead of a raw key).
