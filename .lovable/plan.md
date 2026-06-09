# Sync confirmation + schema drift audit

## 1. GitHub sync — confirmed present

All three files from Claude Code's commit exist in Lovable, untouched:

- `supabase/functions/_shared/harvestApiPeople.ts` (6,872 bytes)
- `supabase/functions/_shared/harvestApiPeople.test.ts` (6,144 bytes)
- `supabase/functions/_shared/toolRegistry.ts`
  - Line 13: `import { buildHarvestApiPeopleInput } from "./harvestApiPeople.ts";`
  - Line 390: invoked inside the Apify run path
  - Line 381–383: `people_profiles` registry entry → `harvestapi/linkedin-profile-search`
  - Line 811: `source_type === "people_profiles"` uses `normalizeApifyPeopleItem`

Related files already aligned: `actorRegistry.ts` (line 180/192), `toolInputPlanner.ts` (lines 26/141/464/467) — all reference `people_profiles` consistently.

No Lovable-side overwrite will happen.

## 2. Schema drift audit

Tables referenced by the people-search code path:

| Code path | Table | Status |
|---|---|---|
| `runApifySource` writes | `tool_calls`, `activity_feed`, `approvals` | exist, columns match |
| `pilot-chat` / `orchestrate` | `conversations`, `messages`, `task_plans`, `workspace_members`, `company_brain`, `activity_feed` | exist |
| `run-agent` | `tasks`, `handoffs` | exist |

The new `people_profiles` data shape is stored **inside the existing `tool_calls.output_json` JSONB column** (fields: `actor_output_type`, `selected_actor_key`, `items`, `no_results`, etc.). No new top-level columns, no new tables, no enum additions, no policy gaps.

**Result: zero schema drift. No additive migration required.**

## 3. Recommendation

Skip the migration step. Proceed directly to:

1. Confirm runtime secrets are set (already verified earlier):
   - `APIFY_API_TOKEN` ✓
   - `APIFY_ENABLE_PEOPLE_SEARCH=true` ✓
   - `APIFY_ACTOR_PEOPLE_SEARCH=harvestapi/linkedin-profile-search` ✓
2. Redeploy `pilot-chat`, `orchestrate`, `run-agent` so they pick up the synced shared code.
3. Verify the `[pilot-chat] people_actor_runtime` log line shows all three values truthy.
4. Run the three test prompts ("Find 10 engineers in London", etc.).

If you want, I can switch to build mode and execute steps 2–4. No DB migration will be created.
