
# Smarter Intent + Clarification Memory for Actor Selection

## Goal
Make the planner choose `apify_people_search` for unambiguous "individual profile" prompts, ask clarification only for genuinely ambiguous role+location prompts, persist both candidate actions on the clarifying assistant message, and resolve the user's next reply against that stored context — instead of re-running the planner cold.

No UI redesign. No RLS, schema, or registry removals. Deterministic backend safety stays.

## Step 1 — Verify people actor at runtime

`supabase/functions/_shared/actorRegistry.ts` already defines `apify_people_search` with `actor_id: "harvestapi/linkedin-profile-search"` and env overrides `APIFY_ACTOR_PEOPLE_SEARCH` + `APIFY_ENABLE_PEOPLE_SEARCH`. `enabled` is driven by `APIFY_ENABLE_PEOPLE_SEARCH`.

Action: add `best_for: "finding individual LinkedIn profiles"` to its `best_for` list (tiny clarity tweak — no behavior change). Read `APIFY_ENABLE_PEOPLE_SEARCH` and `APIFY_API_TOKEN` at boot of one diagnostic log line in `pilot-chat` to report runtime-enabled status in the final verification.

## Step 2 — Sharper intent classification in `toolInputPlanner.ts`

Edits to `supabase/functions/_shared/toolInputPlanner.ts`:

1. **Strengthen people-intent detection.** Update `fallbackParse` so when the prompt explicitly contains "individual / profile(s) / candidate profiles / LinkedIn profiles / people search" AND a role keyword, it selects `apify_people_search` (not `apify_jobs`). When that actor is runtime-disabled, the existing people-intent guard already converts it into a clear "not configured" clarification with companies-hiring fallback offer.
2. **Tighten the ambiguous-prompt rule.** The current `ambiguousRoleLoc` check requires `\bin\s+[A-Z]` which misses "Find 10 engineers in London" when the AI lowercases. Replace with case-insensitive role+location detection: role keyword present, location resolved (`merged.location` truthy) OR `\bin\s+\w+`, no `COMPANY_INTENT_RE`, no `PEOPLE_INTENT_RE`. Result: clarification triggers reliably.
3. **Stop pre-committing to jobs on ambiguity.** When `ambiguousRoleLoc` fires, set `selected_actor_key=null`, `tool_name=null`, `source_type=null` so the orchestrator doesn't silently run jobs while waiting. Add two new fields to `ToolInput`:
   - `people_action?: ToolInput`
   - `companies_action?: ToolInput`
   Build both from the parsed `role_keywords`, `location`, `max_results` (clamped via `clampForActor` for each actor). `companies_action` always populated; `people_action` populated only when `apify_people_search` is runtime-enabled. The clarification question references whichever options are actually available.
4. **PLANNER_JSON_TAIL rule updates.** Add rules 7a/7b: explicit "individual"/"profile"/"candidate" + role → `apify_people_search`; if disabled, set `requires_clarification=true` with people-not-configured + companies-fallback offer. Rule 9 stays for ambiguous prompts but now must populate both `people_action` and `companies_action` in the returned JSON (extend schema). Keep deterministic post-validation as the final authority.

## Step 3 — Persist clarification context

In `supabase/functions/pilot-chat/index.ts`, when `toolInput.ask_clarification` is true, expand the assistant-message `metadata` payload (already saved at line ~388) to:

```json
{
  "intent": "...",
  "clarification": true,
  "pending_clarification": true,
  "clarification_type": "people_vs_companies" | "people_unavailable" | "generic",
  "original_request": "<user message>",
  "people_action": { ToolInput | null },
  "companies_action": { ToolInput | null },
  "prompt_version": AGENTORY_SYSTEM_PROMPT_VERSION
}
```

`clarification_type` is derived: "people_vs_companies" when both actions exist; "people_unavailable" when only companies_action exists and the prompt was explicitly people-intent; otherwise "generic". No schema change needed — `messages.metadata` is `jsonb`.

## Step 4 — Resolve clarification replies in `pilot-chat`

Before calling `classifyIntent(message)` on a new turn, query the **last assistant message** in this `conversation_id`:

```sql
select id, metadata from messages
where conversation_id = $1 and role = 'assistant'
order by created_at desc limit 1
```

If `metadata.pending_clarification === true`, run a small `resolveClarificationReply(text, metadata)` helper (new, local to `pilot-chat/index.ts`):

- People keywords regex: `\b(individual|individuals|profiles?|people|candidates?|persons?|linkedin profiles?)\b` OR a bare "engineers|developers|founders|marketers|designers" reply when the original request already named that role.
- Companies keywords regex: `\b(companies?|hiring|jobs?|roles?|openings?|careers?|recruit)\b`.
- If people match AND `metadata.people_action` exists → use that ToolInput.
- If companies match AND `metadata.companies_action` exists → use that ToolInput.
- If people match but `people_action` is null → reply with the people-unavailable message + companies fallback offer; if user confirms next turn, run companies_action.
- If unclear → ask once: "Please choose one: individual profiles or companies hiring." Re-save the same `pending_clarification` metadata (do not lose `original_request`/actions). Do not re-run the planner.

On a successful resolution, mark the prior assistant message: `update messages set metadata = metadata - 'pending_clarification' || jsonb_build_object('resolved_with', 'people'|'companies') where id = $prior_id`, then call `delegateToOrchestrate({ ... toolInput: stored_action, instruction: metadata.original_request, ... })`. This bypasses `classifyIntent` and the planner entirely on the resolution turn.

## Step 5 — `toolRegistry` support for the people actor

`APIFY_ACTORS.people_profiles` already maps to `harvestapi/linkedin-profile-search`. Two changes in `supabase/functions/_shared/toolRegistry.ts`:

1. **Add `input_adapter`** for `people_profiles` that maps the generic `{query, role_keywords, location, max_results}` into the actor's expected input. Default shape (mirrors harvestapi schema):

   ```ts
   {
     searchQuery: keywords ?? query,        // e.g. "React engineer"
     location: location ?? undefined,
     maxItems: Math.min(max_safe_results, max_results),
     profileScraperMode: "Short"            // structured profile data, no contact scraping
   }
   ```

   Always allow `user_input` overrides to win.

2. **Output normalization.** Add a dedicated `normalizeApifyPeopleItem(raw)` that returns the requested shape:

   ```ts
   {
     full_name, headline, title, location, profile_url,
     company, summary, source: "apify", signal_type: "people_profile",
     raw: truncObj(raw, 4000)
   }
   ```

   Pick from common harvestapi keys: `name|fullName`, `headline`, `currentJobTitle|title`, `location|geoLocation`, `profileUrl|linkedinUrl|url`, `currentCompany|company`, `summary|about`. Never invent email/phone — leave absent.

   Branch in the items mapping: when `source_type === "people_profiles"`, use `normalizeApifyPeopleItem`; otherwise existing `normalizeApifyItem`.

3. **Alias map.** Leave the existing `SOURCE_TYPE_ALIASES` aliases (`people→jobs`, `profiles→jobs`, etc.) as a default for unspecified prompts, but when `selected_actor_key === "apify_people_search"` reaches `execSourceWithApify`, the registry path already wins (line ~556). No alias change required.

The existing `OPT_IN_ONLY_ACTOR_IDS` gate is satisfied because `registryApproved` is set when `apify_people_search` was resolved through `selected_actor_key` and passed `isActorRuntimeEnabled`.

## Step 6 — Workbench display

`src/components/chat/workspace/workbench/AgentOutputViewer.tsx` already routes Scout's Apify output to `ScoutResultsView` via `normalizeApifyItems` (job-shaped). Add a thin branch:

1. In `normalize.ts`, add `normalizeApifyPeople(output)` returning `{ full_name, headline, title, location, company, profile_url, summary, source, raw }[]`. Detect by `output.source_type === "people_profiles"` or by item shape (`full_name` / `profile_url` / `signal_type === "people_profile"`).
2. In `ScoutResultsView`, when the normalized array is people-shaped, render a People variant (name, title/headline, company, location, "View profile" link, source badge, raw JSON collapsed). Job-shape rendering is unchanged.

No new viewer file, no route changes, no design overhaul.

## Step 7 — Untouched (safety)

- `actorRegistry` enable flags and `isActorRuntimeEnabled` semantics.
- Deterministic disabled-actor handlers in `toolInputPlanner` (only refined, not removed).
- `OPT_IN_ONLY_ACTOR_IDS` gate, `send_email` approval requirement, `search_web` unavailable behavior.
- RLS, schemas, secrets, edge function `verify_jwt` settings.

## Deploy
Edited functions only: `pilot-chat`, plus `_shared/toolInputPlanner.ts`, `_shared/toolRegistry.ts`, `_shared/actorRegistry.ts` (recompiled via the consumers). Redeploy: `pilot-chat`, `orchestrate`, `run-agent` (they import shared modules).

## Verification on agentory.space

Run 6 prompts; for each capture `selected_actor_key`, `ask_clarification`, `metadata.pending_clarification`, `metadata.people_action`/`companies_action` presence, plan step agents, any unsupported-capability claim, behavior delta.

1. "Find companies hiring React engineers in London" → `apify_jobs`, no clarification.
2. "Find 10 individual React developer profiles in London" → `apify_people_search` (if `APIFY_ENABLE_PEOPLE_SEARCH=true`), Workbench renders people cards. If disabled → "people sourcing not configured" + companies fallback offer, **no jobs silently**.
3. "Find 10 engineers in London" → one clarification; assistant message metadata contains both `people_action` and `companies_action`; no tool run yet.
4. Reply "individual engineer profiles" → executes stored `people_action` (`apify_people_search`); prior message marked `resolved_with: people`.
5. New thread → "Find 10 engineers in London" then reply "companies hiring engineers" → executes stored `companies_action` (`apify_jobs`).
6. People actor disabled → "Find 10 individual React developer profiles in London" → clear unavailable message, no jobs run.

## Final report (what I will deliver after build)
- Runtime status of `apify_people_search` (`enabled`, `actor_id`, env flags read).
- Files changed.
- How clarification context is stored (message metadata schema).
- How replies are resolved (regex + stored-action execution, planner bypass).
- People actor input mapping + output normalization shape.
- Test results for all 6 scenarios.
