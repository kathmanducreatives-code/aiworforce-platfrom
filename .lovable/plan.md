## Fix two chat-orchestrator logic bugs

Backend-only (edge functions). No schema, migrations, secrets, UI, registry, or HarvestAPI changes.

### Issue 1 — Clarification follow-up loses context

Root cause (in `supabase/functions/_shared/toolInputPlanner.ts`):

The pending-clarification resolver in `pilot-chat` (lines 290–387) already reads `meta.people_action` / `meta.companies_action` and re-delegates to orchestrate with that stored action — so on paper Issue 1 is solved. But it only works if the **previous turn actually wrote those fields**.

Today, those fields are only populated when the planner explicitly sets `clarification_type` to `"people_vs_companies"` or `"people_unavailable"` (line 438). The deterministic `ambiguousRoleLoc` branch (line 421) does set that type, but when the AI planner returns its own `ask_clarification=true` without a `clarification_type`, the gate fails and actions are never written. That matches what test 4 produced (Pilot asked again for location on the follow-up).

Fix:
- In `toolInputPlanner.ts`, treat any "ambiguous role + location" prompt as `people_vs_companies` regardless of whether the AI also set `requires_clarification`. Drop the `!merged.ask_clarification` guard on the `ambiguousRoleLoc` block so `clarification_type` is set to `"people_vs_companies"` whenever the heuristic matches.
- In the action-builder block (line 438), also fall through when `ask_clarification` is true and the prompt has both a role word and a location/`in <x>` hint, even if `clarification_type` is `undefined` — set it to `"people_vs_companies"` and build both `people_action` and `companies_action` from the parsed `role_keywords`, `location`, and `max_results`.
- No change to `pilot-chat` resolver logic itself; the existing branch at lines 311–361 already handles `wantsPeople` / `wantsCompanies` against stored actions, sets `resolved_with`, clears `pending_clarification`, and calls `delegateToOrchestrate` with the stored action and the original instruction from `meta.original_request`.

Result: the very first ambiguous prompt always persists `people_action` + `companies_action` (with `location`, `role_keywords`, `max_results`, `execution_mode`). Follow-up replies like "individual engineer profiles" or "companies hiring" execute the stored action directly — no re-asking for location, no re-running the planner.

### Issue 2 — Firecrawl URL analysis triggers spurious Apify call

Root cause (in `supabase/functions/run-agent/index.ts`):

The Apify sourcing trigger is:
```ts
const shouldUseApify =
  tool_input_body?.tool_name === "source_with_apify"
  || !!planned_actor_key
  || sourcingRe.test(...);
```

For a Firecrawl step, `tool_input_body.tool_name === "scrape_url"` and `planned_actor_key === "firecrawl_scrape_url"`, so `!!planned_actor_key` is truthy and Apify fires a second tool call that fails with `actor_missing`.

Fix:
- Replace the gate with: Apify runs only if **either** `tool_name === "source_with_apify"` **or** `selected_actor_key` starts with `"apify_"`. Explicitly skip when `tool_name === "scrape_url"`, when `selected_actor_key === "firecrawl_scrape_url"`, or when `source_type` is `"website_content"` / `"custom_web"` and a scrape was already attempted.
- Keep the regex heuristic only as a fallback when **no** `tool_input_body` was supplied at all (legacy free-form scout/hawk calls). When a planner-supplied `tool_input_body` exists, trust it.

### Files to change

- `supabase/functions/_shared/toolInputPlanner.ts` — relax the `ambiguousRoleLoc` and action-builder gates so `people_action` / `companies_action` are always populated for ambiguous role+location prompts.
- `supabase/functions/run-agent/index.ts` — tighten `shouldUseApify` so a Firecrawl-selected step never triggers Apify sourcing.

### Verification

After deploying `pilot-chat` (uses the shared planner) and `run-agent`, re-run the five smoke prompts via `curl_edge_functions` and DB introspection:

1. "Find 10 engineers in London" → clarification with `meta.people_action.location = "London"` and `companies_action.location = "London"`, both with `max_results = 10`, `role_keywords = ["engineer"]`.
2. Reply "individual engineer profiles" on the same conversation → no re-ask, `selected_actor_key = apify_people_search`, `source_type = people_profiles`, `location = London`, `max_results = 10`, plan reaches `complete`.
3. New conversation: "Find 10 engineers in London" → reply "companies hiring engineers" → `selected_actor_key = apify_jobs`, `source_type = jobs`, `location = London`, `max_results = 10`.
4. "Analyze https://stripe.com/jobs" → exactly one `tool_calls` row with `tool_name = scrape_url` / `firecrawl_scrape_url`; no `source_with_apify` row, no `actor_missing` error in activity feed.
5. "Find companies hiring React engineers in London" → unchanged: `apify_jobs`, plan complete.
6. "Find 10 individual React developer profiles in London" → unchanged: `apify_people_search` runs; if Apify returns nothing, tool_call output_json has `no_results: true` (not a failure).

### Final report will include

Files changed; exact diff to the clarification-metadata builder; exact diff to the Firecrawl-vs-Apify gate; per-test `selected_actor_key`, `tool_call` status, plan status, and `output_json` presence; confirmation that test 4 no longer fires a spurious Apify call.