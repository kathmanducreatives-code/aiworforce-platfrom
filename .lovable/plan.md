
## Actor Intelligence Layer

Goal: make Gemini / `toolInputPlanner` choose the **correct Apify actor or tool chain** for each request, including ambiguous "find engineers in London" prompts. No UI redesign, no backend project changes, no removed systems.

### 1. New file — `supabase/functions/_shared/actorRegistry.ts`

Single source of truth describing each available actor/tool in natural language. Exports:

- `ACTOR_REGISTRY` — the spec from the user message (`apify_jobs`, `apify_indeed_jobs`, `apify_website_content`, `apify_custom_web`, `firecrawl_scrape_url`, `search_web`, `people_profile_actor`).
- `getEnabledActors()` — filters by `enabled` and by env keys present (`APIFY_API_TOKEN`, `FIRECRAWL_API_KEY`).
- `getActorByKey(key)` and `resolveActorForSourceType(source_type)`.
- `summarizeRegistryForPrompt()` — compact string fed into the Gemini planner prompt (label, best_for, not_for, example_user_requests, enabled flag).
- `PEOPLE_INTENT_RE` / `JOBS_INTENT_RE` regexes for the disambiguation rules in step 3.

Actor metadata kept exactly as proposed; `enabled: true` only for `apify_jobs` and `firecrawl_scrape_url`. `people_profile_actor` carries `missing_message`.

### 2. Update `supabase/functions/_shared/toolInputPlanner.ts`

- Extend `ToolInput` with `selected_actor_key: string | null`, `reason: string | null`, and keep existing fields.
- Inject `summarizeRegistryForPrompt()` into `PLANNER_PROMPT` and require Gemini to return the new JSON shape (`intent`, `selected_tool`, `selected_actor_key`, `source_type`, `reason`, …).
- After AI merge, validate `selected_actor_key` against `ACTOR_REGISTRY`. If unknown or disabled → fall back deterministically:
  - URL in prompt → `firecrawl_scrape_url`.
  - Hiring/companies language → `apify_jobs`.
  - People-only language with no people actor configured → `selected_actor_key = null`, `tool_name = null`, `ask_clarification = true`, `clarification` from `people_profile_actor.missing_message` + "Want me to find companies hiring instead?".
  - Ambiguous role+location ("find 10 engineers in London") → `ask_clarification = true` with the people-vs-companies question from spec step 3, while pre-selecting `apify_jobs` as the proceed-if-confirmed default.
- Replace the current "everything sourcing → jobs" coercion with the registry-driven decision; keep cost caps and outreach/deep escalation.

### 3. Update `supabase/functions/orchestrate/index.ts`

- When `tool_input.selected_actor_key` is present, propagate it into `step.metadata.selected_actor_key` and `step.metadata.actor_reason` (no overwrite of generic `source_type`).
- Multi-tool expansion:
  - "enrich top N" / "analyze website" language after a sourcing step → append a Hawk step with `tool_needed: scrape_url` and `metadata.selected_actor_key = firecrawl_scrape_url`.
  - "draft outreach" / "send" → keep existing Penn step.
  - URL-only prompt → Hawk Firecrawl first, optional Scout only if hiring/discovery language is also present.
- Connector-missing messages: extend `TOOL_LIMITATION_MESSAGE` and `annotateTools` to read from the registry so `people_profile_actor` surfaces the configured `missing_message` instead of running silently.

### 4. Update `supabase/functions/run-agent/index.ts` and `toolRegistry.ts`

- `run-agent`: prefer `tool_input_body.selected_actor_key` (or `task.payload.metadata.selected_actor_key`) when resolving Apify; pass it into `runTool("source_with_apify", { selected_actor_key, source_type, … })`.
- `toolRegistry.execSourceWithApify`: accept `selected_actor_key`, look it up in the registry, then in `APIFY_ACTORS`. If still missing or disabled, return `{ ok: false, unavailable: true, error: "actor_missing", data: { actor_key, source_type, reason, configured_actor_keys } }` (clear payload for Workbench).
- Keep `OPT_IN_ONLY_ACTOR_IDS` and existing alias map; the registry overrides aliases only when an explicit `selected_actor_key` is passed.

### 5. UI transparency — minimal surface changes

No redesign. Two small additions:

- `ExecutionPlanCard.tsx` / `ExecutionTaskRow.tsx`: when `task.payload.metadata.selected_actor_key` exists, render the actor label + one-line `actor_reason` under the existing tool badge ("Apify Jobs — selected because this asks for hiring signals by role/location").
- `workbench/WorkbenchHeader.tsx` and `ScoutResultsView.tsx`: show actor label, actor_id, `output_type`, and reason as a small `Actor` section above the result list. Read from `toolCall.input_json.selected_actor_key` → registry, falling back to `toolCall.metadata`.
- When the planner returned `ask_clarification`, the Pilot chat already surfaces the question; nothing new here besides making sure orchestrate does not auto-execute when `requires_clarification = true`.

### 6. Verification

After deploy, run all 6 verification prompts from the spec against `agentory.space` and capture:
- selected_actor_key returned by planner
- step.metadata stored on the plan
- actor + reason rendered in Execution Plan Card and Workbench
- whether clarification was asked (tests 2, 3) and whether jobs actor was suppressed (test 3)
- whether multi-actor plan was produced (tests 4, 6) and whether Firecrawl ran first (test 5).

### Files changed

- **Add:** `supabase/functions/_shared/actorRegistry.ts`
- **Edit:** `supabase/functions/_shared/toolInputPlanner.ts`
- **Edit:** `supabase/functions/_shared/toolRegistry.ts`
- **Edit:** `supabase/functions/orchestrate/index.ts`
- **Edit:** `supabase/functions/run-agent/index.ts`
- **Edit:** `src/components/chat/workspace/plan/ExecutionPlanCard.tsx`
- **Edit:** `src/components/chat/workspace/plan/ExecutionTaskRow.tsx`
- **Edit:** `src/components/chat/workspace/workbench/WorkbenchHeader.tsx`
- **Edit:** `src/components/chat/workspace/workbench/ScoutResultsView.tsx`
- **Deploy:** `toolInputPlanner`, `toolRegistry`, `orchestrate`, `run-agent` (via deploy of `orchestrate`, `run-agent`, `pilot-chat` which import the shared files).

### Out of scope

No new tables, no RLS changes, no secret changes, no removal of existing tools/agents/UI surfaces, no new people-profile actor (kept disabled with `missing_message`).
