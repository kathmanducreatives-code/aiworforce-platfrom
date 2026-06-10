## Goal

Make Gemini act as a **structured intent normalizer** for messy, business-style user prompts (e.g. "Currently having issues with development. I think we may need to hire new engineers..."), while keeping all deterministic safety: actorRegistry validation, disabled-actor fallback, max_results clamping, approval gating, and clarification persistence.

No schema, UI, secret, or registry changes. Only `toolInputPlanner.ts` and `agentorySystemPrompt.ts` are edited.

## Changes

### 1. `agentorySystemPrompt.ts` — add an intent-normalizer framing

In `taskFraming()`, expand the `tool_parameter_extraction` case to declare Gemini as **Agentory's intent normalizer**:
- "Read messy business language; produce strict ToolInput JSON."
- "Do not answer conversationally. Do not run tools. Do not invent unavailable capabilities."
- "Extract business goal, intent, actor/tool choice, missing fields, clarification question."
- Enumerate supported intents: `simple_chat`, `capabilities`, `daily_brief`, `source_people_profiles`, `source_companies_hiring`, `source_agencies`, `analyze_url`, `broad_research`, `draft_outreach`, `create_content`, `unclear`.

This keeps the master system prompt untouched for other task types.

### 2. `toolInputPlanner.ts` — rewrite the planner JSON tail + add few-shot examples

Replace `PLANNER_JSON_TAIL` with a new spec that:
- Documents the **extended ToolInput JSON shape** including new advisory fields the user listed: `business_goal`, `remote_ok`, `seniority`, `needs_clarification`, `ask_clarification`, `clarification_type`, `people_action`, `companies_action`, `agency_action`.
- Tells Gemini to normalize messy business text → strict JSON, never prose.
- Repeats the routing rules (URL → Firecrawl, hiring → apify_jobs, explicit individuals → apify_people_search, ambiguous role+location → clarification with both actions, vague business pain → people_vs_agency clarification).
- Includes 5 few-shot examples from the user's brief (messy dev-help, companies hiring React London, individual React London, ambiguous "10 engineers in London", "find sales + outreach").

### 3. `toolInputPlanner.ts` — merge new advisory fields without weakening validation

Extend the AI-merge block (lines ~278-309) to accept (advisory, non-breaking) fields from Gemini:
- `business_goal` (string) — kept on the returned object for downstream logging/UI.
- `remote_ok` (boolean), `seniority` (string|null) — passed through.
- `clarification_type` string mapped to existing union (`people_vs_companies` | `people_unavailable` | `generic` | new `people_vs_agency`).
- `people_action` / `companies_action` / `agency_action` — accepted only after each is re-validated through the same actor/tool/clamp pipeline (re-run `getActorByKey` + `isActorRuntimeEnabled` + `clampForActor`; drop or null any action whose actor is missing/disabled).

Add these fields to the `ToolInput` interface (optional) so they survive without TS errors. No DB schema change — they live in the JSON metadata `pilot-chat` already persists on the message.

### 4. `toolInputPlanner.ts` — keep all existing guardrails

Unchanged:
- `fallbackParse` (deterministic baseline if Gemini returns nothing).
- Disabled-actor switch (lines 316-394).
- Explicit-people guard (396-410).
- Ambiguous role+location block (412-439) — still forces clarification and nulls the tool when ambiguous.
- People/Companies action builder (441-498) — extended to also build `agency_action` when `clarification_type === "people_vs_agency"`.
- Per-actor `max_results` clamp at the end.
- Low-confidence missing-field gate.

Gemini's output is never trusted blindly — every actor key must resolve in `ACTOR_REGISTRY` and pass `isActorRuntimeEnabled`, otherwise it is dropped exactly like today.

### 5. Backend follow-up resolution (already in place)

The existing `pilot-chat` resolver that reads stored `people_action` / `companies_action` from the previous assistant message metadata continues to work. The new `agency_action` will piggyback on the same persistence path (same JSON column), so when the user replies "individual engineers" / "agency" / "companies", the backend executes the stored action without re-running the planner. No new persistence code required for the planner change itself.

## Verification (after switch to build mode)

Deploy `pilot-chat`, `run-agent`, `orchestrate`, then run via `supabase--curl_edge_functions`:

1. Messy dev-pain prompt → expect `clarification_type=people_vs_agency` + stored `people_action` (remote_ok=true, seniority=experienced) + `agency_action`.
2. Reply "individual engineers" → executes `apify_people_search` with experienced + remote, no location re-ask.
3. "Find 10 engineers in London" → people_vs_companies clarification with both actions stored.
4. Reply "individual profiles" → executes `apify_people_search` with location=London.
5. "Find companies hiring React engineers in London" → direct `apify_jobs`.
6. "Analyze https://stripe.com/jobs" → direct `firecrawl_scrape_url`, no Apify side-fire.

## Files changed

- `supabase/functions/_shared/agentorySystemPrompt.ts` — expand `tool_parameter_extraction` framing.
- `supabase/functions/_shared/toolInputPlanner.ts` — new prompt tail, few-shot examples, extended `ToolInput`, advisory-field merge with re-validation, `agency_action` builder.

No schema, no UI, no secrets, no registry changes.