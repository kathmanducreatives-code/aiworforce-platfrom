# Master Agentory System Prompt

## New file
`supabase/functions/_shared/agentorySystemPrompt.ts`

Exports:
- `AGENTORY_SYSTEM_PROMPT_VERSION = "2026-06-06-v1"`
- `getAgentorySystemPrompt({ companyBrain, actorRegistrySummary, availableTools, currentAgent, taskType })`

Prompt body covers (compact, ~3.5KB before injections):
- Identity (Agentory = AI workforce OS, not chatbot)
- Team roles (Pilot/Scout/Aria/Penn/Hawk/Scribe)
- Tool strategy (Apify / Firecrawl / Gemini / search_web / Resend)
- Actor selection rules (ordered, people-vs-companies disambiguation, URL → Firecrawl, enrichment 3–5, outreach → Penn)
- Execution modes (fast / deep / outreach)
- Clarification, data-honesty, output, approval-safety rules
- Task-specific framing line based on `taskType`

Compact injection helpers cap `company_brain` at ~1.6KB (top-level keys, trimmed values) and `actor_registry` summary at ~3.5KB.

## Edits

**`supabase/functions/_shared/aiProvider.ts`**
- Add optional `prompt_version?: string` to `logProviderCall` meta → stored in `activity_feed.metadata.prompt_version`.

**`supabase/functions/_shared/toolInputPlanner.ts`**
- Replace static `PLANNER_PROMPT` with `getAgentorySystemPrompt({ taskType: "tool_parameter_extraction", currentAgent: "pilot", actorRegistrySummary: summarizeRegistryForPrompt() }) + planner-specific JSON-schema tail`. Keep existing routing rules + ToolInput schema + deterministic post-validation untouched.

**`supabase/functions/pilot-chat/index.ts`**
- Build system prompt with `getAgentorySystemPrompt({ taskType: "pilot_router", currentAgent: "pilot", companyBrain: brain, actorRegistrySummary, availableTools: ["apify","firecrawl","resend"] })` and append the existing JSON-decision contract (`{"decision":"reply"|"delegate"...}`).
- Pass `prompt_version: AGENTORY_SYSTEM_PROMPT_VERSION` to `logProviderCall` and include in `announceMetadata`.

**`supabase/functions/orchestrate/index.ts`**
- Replace `"You are a planning assistant. Respond with valid JSON only."` with `getAgentorySystemPrompt({ taskType: "planning", currentAgent: "pilot", companyBrain, actorRegistrySummary })`; keep existing `orchestratorPrompt` as the user message.
- Pass `prompt_version` to `logProviderCall`.

**`supabase/functions/run-agent/index.ts`**
- Compose system prompt = `agent.role_prompt` + `\n\n` + `getAgentorySystemPrompt({ taskType: "agent_execution", currentAgent: agent_slug, companyBrain: brain, actorRegistrySummary })`. (Drop the duplicate inline brain block — now inside the shared prompt.)
- Pass `prompt_version` to `logProviderCall`.

**`supabase/functions/daily-brief/index.ts`**
- Prepend `getAgentorySystemPrompt({ taskType: "reporting", currentAgent: "scribe", companyBrain: brainProfile })` to the existing formatting instructions.
- Pass `prompt_version` to `logProviderCall` if practical (helper task).

## Untouched (deterministic safety)
- `actorRegistry.ts` enable flags, `isActorRuntimeEnabled`, `summarizeRegistryForPrompt`.
- `toolRegistry.ts` opt-in gates (`people_profiles`, `profile_enrichment`), send_email approval requirement, `search_web` unavailable behavior.
- `toolInputPlanner.ts` post-AI validation (disabled-actor fallbacks, people-intent guard, ambiguous-role clarification).
- UI, RLS, schemas, secrets.

## Deploy
`pilot-chat`, `orchestrate`, `run-agent`, `daily-brief` (all edited).

## Verification on agentory.space
Run 6 prompts; capture per run:
- `selected_actor_key`
- `ask_clarification` flag
- plan step agents
- whether any unsupported capability was claimed
- behavior delta vs prior run

Prompts:
1. "Find companies hiring React engineers in London" → expect `apify_jobs`, no clarification.
2. "Find 10 engineers in London" → clarification (people vs companies).
3. "Find 10 individual React developer profiles in London" → "people actor not configured" + fallback offer; `selected_actor_key=null`.
4. "Find SaaS companies hiring GTM roles in the US and draft outreach" → apify_jobs → Aria → optional Firecrawl → Penn draft, no send.
5. "Analyze https://stripe.com/jobs" → `firecrawl_scrape_url`.
6. "What changed in the market today?" → honest "broad web search not configured".
