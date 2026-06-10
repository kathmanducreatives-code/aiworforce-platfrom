## Goal

Make Agentory's chat orchestrator behave like a real AI assistant. Gemini reads messy natural-language messages, outputs a strict structured-intent JSON, and the backend validates everything before executing. No schema, UI, secrets, or registry changes. All safety gates remain.

## Files to change

- `supabase/functions/_shared/agentorySystemPrompt.ts` — strengthen the `tool_parameter_extraction` framing as an intent normalizer.
- `supabase/functions/_shared/toolInputPlanner.ts` — new JSON spec, new few-shot examples, extended `ToolInput`, advisory-field merge with re-validation, builders for `people_action` / `companies_action` / `agency_action` / `fallback_action`.
- `supabase/functions/pilot-chat/index.ts` — clarification-reply resolver: classify user reply against stored actions and execute the matching action directly, without re-running the planner. (Resolver already partially exists for `people_action` / `companies_action`; extend to `agency_action` / `fallback_action` and reuse stored fields like `location`, `seniority`, `remote_ok`.)

No other files. No DB schema, no migrations, no UI, no secrets, no actorRegistry edits.

## 1. Gemini intent-normalizer prompt

Rewrite `PLANNER_JSON_TAIL` to instruct Gemini to:
- Treat any user message as messy business language.
- Output **only** a strict JSON object matching the shape the user specified:

```text
business_goal, user_said, interpreted_need, intent,
confidence, needs_clarification, clarification_type, clarification_question,
selected_workflow, agents[], tool_name, selected_actor_key,
source_type, query, role_keywords[], location, remote_ok, seniority,
max_results, needs_enrichment, needs_outreach, requires_approval,
people_action, companies_action, agency_action, fallback_action, reason
```

- Pick `selected_actor_key` only from the registry summary already injected; if unsure, set it to `null`, set `needs_clarification=true`, and pre-build `people_action` / `companies_action` / `agency_action` the backend can run after the user picks.
- Never answer conversationally, never run tools, never invent unavailable capabilities.

Add 7 few-shot examples (one per scenario in the brief): dev-pain, companies-hiring-React-London, individual-React-London, ambiguous "10 engineers in London", "more customers + outreach", `https://stripe.com/jobs` URL analyze, LinkedIn content write-up.

## 2. Backend validation (unchanged guardrails, extended scope)

After Gemini returns JSON, `toolInputPlanner.ts` still:
- Runs `fallbackParse` when Gemini is empty/invalid.
- Validates `selected_actor_key` via `getActorByKey` + `isActorRuntimeEnabled`; drops or switches to fallback when missing/disabled.
- Re-validates every `*_action` (people / companies / agency / fallback) through the same pipeline and clamps `max_results` per actor.
- Keeps the explicit-people guard, the ambiguous role+location block, the disabled-actor switch, the low-confidence missing-field gate, and the Firecrawl URL short-circuit (no Apify side-fire).
- Always sets `clarification_type` when `needs_clarification` is true (one of `people_vs_companies`, `people_vs_agency`, `people_unavailable`, `generic`) and persists `people_action` / `companies_action` / `agency_action` / `fallback_action` on the assistant message metadata that `pilot-chat` already writes.

Tool name / agent / approval rules unchanged:
- `send_email` and any external write still require approval.
- `search_web` only used if configured; otherwise the planner says it's unavailable.

## 3. Clarification memory & reply resolver

In `pilot-chat/index.ts`, extend the existing "previous assistant message metadata" reader to:
- Classify the user reply (`individual…`, `profiles`, `people` → `people_action`; `companies`, `hiring` → `companies_action`; `agency`, `agencies`, `firm` → `agency_action`; otherwise `fallback_action` if present).
- Execute the matched action directly — same `selected_actor_key`, `query`, `location`, `role_keywords`, `seniority`, `remote_ok`, `max_results` — without re-running the planner and without re-asking for fields already captured in the original request.
- If no action matches, fall through to the normal planner path.

No new persistence: actions live in the JSON metadata column `pilot-chat` already writes.

## 4. Verification (build mode)

Deploy `pilot-chat`, `orchestrate`, `run-agent`, then via `supabase--curl_edge_functions` run the 6 brief tests and report for each: assistant reply, `plan_id`, `selected_actor_key`, tool_call status/error, result count, Workbench `output_json` presence, plan status.

1. "We're having issues with development…" → clarification `people_vs_agency`, stored `people_action` (remote_ok=true, seniority=senior).
2. Reply "individual engineers" → executes `apify_people_search`, no location re-ask.
3. "Find 10 engineers in London" → clarification `people_vs_companies`, both actions stored.
4. Reply "individual profiles" → executes `apify_people_search` with London.
5. "Find companies hiring React engineers in London" → direct `apify_jobs`.
6. "Check https://stripe.com/jobs…" → direct `firecrawl_scrape_url`, no Apify.
7. "More customers… draft outreach" → `apify_jobs` → Aria → Penn draft, approval required, no auto-send.

## Out of scope

Schema changes, UI changes, secret changes, `actorRegistry` edits, removing any approval/safety gate.
