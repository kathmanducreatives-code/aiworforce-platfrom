
# Staged Execution for ScreeningPilot

Goal: stop running every agent/tool for every prompt. Route by intent, plan tool inputs once, then execute the minimum needed (Apify → score → optional Firecrawl enrich → optional Penn draft). No UI changes, no architecture removal, no backend project change.

## Flow

```text
user prompt
  → pilot-chat
      → intentRouter.classify()           (NEW)
      → toolInputPlanner.plan()           (NEW, only if intent needs tools)
      → orchestrate (plan creation)       (existing, now reads tool_input)
          → tasks (metadata.tool_input)   (existing table, new metadata shape)
              → run-agent                 (existing, now branches on execution_mode)
                  → toolRegistry          (existing: apify, firecrawl, …)
                  → signals / lead_candidates / lead_enrichments / outreach_drafts
```

## Step 1 — Intent router

New file: `supabase/functions/_shared/intentRouter.ts`

- Exports `classifyIntent(prompt, ctx) → { intent, confidence, reason, clarification? }`.
- Intents: `simple_chat | daily_brief | source_signals | analyze_url | rank_existing_leads | enrich_existing_leads | draft_outreach | send_requires_approval | content | unclear`.
- Implementation: deterministic regex pass first (URL → `analyze_url`; "brief/today" → `daily_brief`; "find/source/leads/companies hiring" → `source_signals`; "enrich/research" → `enrich_existing_leads`; "draft/outreach/email/message" → `draft_outreach`; "send" → `send_requires_approval`; "write/post/article" → `content`). If ambiguous, fall back to `aiProvider.generateJson({ taskType: "helper" })` with a tight schema. Default `unclear` when confidence < 0.5.
- `pilot-chat/index.ts` calls this first:
  - `simple_chat` → reply directly, no plan, no orchestrate call.
  - `unclear` → assistant message asks one clarifying question; no plan.
  - everything else → continues into the tool input planner + orchestrate.

## Step 2 — Tool input planner

New file: `supabase/functions/_shared/toolInputPlanner.ts`

- Exports `planToolInput(prompt, intent, ctx) → ToolInput` where:
  ```ts
  type ToolInput = {
    intent: string;
    tool_name: "source_with_apify" | "scrape_url" | "search_web" | null;
    source_type: "jobs" | "companies" | "people" | "posts" | null;
    query: string;
    role_keywords: string[];
    location: string | null;
    max_results: number;          // default 25
    needs_enrichment: boolean;
    needs_outreach: boolean;
    execution_mode: "fast" | "deep" | "outreach";
    confidence: number;
    missing_fields: string[];
  };
  ```
- Calls `aiProvider.generateJson({ taskType: "tool_input_planning", jsonMode: true })` with a small schema and the user prompt + Company Brain summary.
- New `TaskType: "tool_input_planning"` added to `aiProvider.ts` (maps to `google/gemini-3-flash-preview`).

## Step 3 — Deterministic fallback parser

Same file, `fallbackParse(prompt, intent)`:

- numbers (`\b(\d{1,4})\b` capped at 200) → `max_results`.
- locations: tokens matching `London|UK|US|USA|Europe|Remote|EU|Berlin|NYC|SF|San Francisco|New York|Paris|Dublin|…` (small allow-list).
- roles: `engineer|developer|react|frontend|backend|marketing|growth|sales|gtm|sdr|bdr|designer|product|ops|founder|cto|cmo|recruiter`.
- outreach intent words: `draft|outreach|email|message|sequence|cold` → `needs_outreach`.
- enrichment intent words: `enrich|analyze website|research|deep dive|score` → `needs_enrichment`.
- merge AI result + fallback (fallback fills missing fields; never overrides a confident AI value).
- If final `confidence < 0.65` AND `missing_fields` non-empty → planner returns `{ ask_clarification: true, question }` and pilot-chat asks instead of running.

## Step 4 — Persist tool_input on tasks

- Update `orchestrate/index.ts`:
  - Accept `tool_input` in its request payload (passed by pilot-chat).
  - For sourcing-shaped intents, build a minimal plan (Scout/Hawk sourcing → optional Aria → optional Firecrawl enrich → optional Penn). Stop generating Aria/Penn when not requested.
  - When inserting the Scout/Hawk task, write `metadata.tool_input = { … }` (and copy `execution_mode` to the plan row's `metadata.execution_mode` for ExecutionPlanCard).
- Update `run-agent/index.ts`:
  - Prefer `task.metadata.tool_input` over re-parsing the prompt. Pass `max_results`, `role_keywords`, `location`, `source_type` straight into the Apify adapter.
  - Branch on `execution_mode` (see Step 5).

## Step 5 — Execution modes

In `run-agent/index.ts` after Scout/Hawk Apify call completes:

- **fast** (default): normalize → insert into `signals` / `lead_candidates` if tables exist → Aria does cheap heuristic scoring (no LLM rerank loop) → done. No Firecrawl. No Penn.
- **deep**: fast pipeline → pick top `min(5, max_results)` by score → run `scrape_url` (Firecrawl) on each company URL → Aria rescore with enrichment → write `lead_enrichments`.
- **outreach**: deep pipeline → Penn drafts outreach for top `min(5, deepCount)` leads → write `outreach_drafts` with `status='draft'` → never call send adapter. ExecutionPlanCard shows approval gate (existing).

Orchestrate's plan builder uses `execution_mode` to decide which agent tasks to create up front, so we don't insert a Penn task at all in fast mode.

## Step 6 — Cost and result caps

Hard limits enforced in `toolInputPlanner` and `run-agent`:

- `max_results`: clamp to `[1, 200]`, default 25.
- Firecrawl enrich: hard cap 5 companies per run regardless of plan.
- Penn drafts: hard cap 5 unless `metadata.tool_input.allow_bulk_outreach === true` (only set if the user explicitly confirms in a follow-up turn).
- Never Firecrawl the full Apify list; always score+slice first.

## Step 7 — Persistent signal memory

Detect (and create if missing in a follow-up migration step — flagged but **not** auto-run in this plan) the tables:

- `signals (id, workspace_id, source, source_type, external_id, payload jsonb, score, created_at)`
- `lead_candidates (id, workspace_id, signal_id, company, role, location, url, score, status, created_at)`
- `lead_enrichments (id, workspace_id, lead_candidate_id, source, payload jsonb, created_at)`
- `outreach_drafts (id, workspace_id, lead_candidate_id, channel, subject, body, status, created_at)`

`run-agent` calls a small helper `persistSignals()` that no-ops with a warning in the activity feed if the table doesn't exist, so the agent run never fails because of missing tables. Actual schema changes are out of scope of this plan and will be proposed in a follow-up migration once you approve the staged-execution code.

## Step 8 — User-facing copy (pilot-chat)

After run-agent finishes, pilot-chat's assistant message uses the plan's `execution_mode`:

- fast: `I found {N} hiring signals and ranked the top {M}. Want me to enrich the top 3 and draft outreach?`
- deep: `I found {N} signals, enriched the top {M} companies, and ranked them.`
- outreach: `I found {N} signals, enriched {M} companies, and drafted {K} outreach messages for review. Nothing was sent.`

No UI/component changes — copy only.

## Step 9 — Verification (manual smoke tests after build)

| Prompt | Expected tool_input | Expected pipeline |
|---|---|---|
| "Find 10 engineers in London" | role_keywords=[engineer], location=London, max_results=10, mode=fast | Apify only, no Firecrawl, no Penn |
| "Find companies hiring marketing roles in London" | source_type=jobs, query=marketing, location=London, max_results=25, mode=fast | Apify only |
| "Find 50 early-stage SaaS companies hiring GTM roles in the US and draft outreach" | max_results=50, role_keywords=[gtm], location=US, needs_outreach=true, mode=outreach | Apify → Aria → Firecrawl top 5 → Penn drafts (no send) |
| "Find leads" | confidence<0.65, missing role/location | Pilot asks one clarifying question, no Apify call |
| "Find companies hiring marketing roles in London and enrich the top 3" | needs_enrichment=true, mode=deep | Apify → Aria → Firecrawl top 3 |

## Files touched

- `supabase/functions/_shared/intentRouter.ts` (new)
- `supabase/functions/_shared/toolInputPlanner.ts` (new)
- `supabase/functions/_shared/aiProvider.ts` (add `tool_input_planning` TaskType)
- `supabase/functions/pilot-chat/index.ts` (call intent router → planner → orchestrate; new user-facing copy; clarification path)
- `supabase/functions/orchestrate/index.ts` (accept `tool_input`, build minimal plan per `execution_mode`, write `metadata.tool_input` + `metadata.execution_mode`)
- `supabase/functions/run-agent/index.ts` (read `metadata.tool_input`, branch on `execution_mode`, enforce caps, persistSignals helper)

## Non-goals (per your constraints)

- No UI redesign (ExecutionPlanCard, ToolStatusBadge, chat surface stay).
- No backend project change, no RLS disable, no secret exposure.
- No removal of existing agents, toolRegistry, Apify/Firecrawl, Daily Brief, approvals, activity_feed.
- Schema additions for `signals` / `lead_candidates` / `lead_enrichments` / `outreach_drafts` are **flagged as a follow-up migration**, not bundled in this plan. The run-agent helper is resilient to those tables being absent.
