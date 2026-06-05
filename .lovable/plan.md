## Root cause

Live test of "Find 10 engineers in London" failed with "Apify actor missing" for three layered reasons:

1. **Planner returned `source_type: "people"`** (see pilot-chat log) for "engineers", because the AI planner treats "engineers" as people.
2. **run-agent then downgraded `people` to `generic`** (`run-agent/index.ts` L171: `st === "people" ? "generic" : st`). The Apify call log confirms this: `source_type: "generic"`.
3. **`APIFY_ACTORS` only has keys `jobs / indeed_jobs / website_content / custom_web / search_fallback`** — neither `people` nor `generic` resolves to an actor, so `execSourceWithApify` returns `apify_actor_not_configured` → UI shows "Apify actor missing".

The `jobs` actor itself is correctly configured (`curious_coder/linkedin-jobs-scraper`, `enabled_by_default: true`) — it just never gets selected for prompts like "engineers in London".

## Fix scope

Three edge-function files only. No UI redesign, no DB, no schema, no backend project change, no removal of Apify / Firecrawl / toolRegistry / run-agent / orchestrate / Execution Plan Card / Company Brain / approvals. One small ToolStatusBadge tooltip enrichment to surface debug fields when an actor is missing.

### File 1 — `supabase/functions/_shared/toolRegistry.ts`

Add a single normalization helper used both internally and exported for callers:

```ts
const SOURCE_TYPE_ALIASES: Record<string, string> = {
  jobs: "jobs", job: "jobs", hiring: "jobs", hiring_signals: "jobs",
  job_search: "jobs", linkedin_jobs: "jobs", companies_hiring: "jobs",
  source_companies: "jobs", source_candidates: "jobs",
  candidates: "jobs", people: "jobs", profiles: "jobs",
  engineers: "jobs", developers: "jobs", roles: "jobs",
  indeed_jobs: "indeed_jobs", website_content: "website_content",
  custom_web: "custom_web", search: "search_fallback",
};
export function normalizeApifySourceType(raw?: string | null): string {
  const k = (raw ?? "").toString().trim().toLowerCase();
  return SOURCE_TYPE_ALIASES[k] ?? (APIFY_ACTORS[k] ? k : "jobs");
}
```

In `execSourceWithApify`:
- Run input `source_type` through `normalizeApifySourceType` BEFORE looking up the actor.
- When actor lookup fails, return debug payload:
  ```ts
  data: {
    requested_source_type: i.source_type ?? null,
    normalized_source_type: source_type,
    expected_actor_key: source_type,
    actor_configured: false,
    message: "..."
  }
  ```
- On success, include `requested_source_type` and `normalized_source_type` in the returned data so the Execution Plan Card can show what was actually used.

Confirm `APIFY_ACTORS.jobs` keeps `actor_id: "curious_coder/linkedin-jobs-scraper"`, `enabled_by_default: true` (already correct — no change).

### File 2 — `supabase/functions/run-agent/index.ts`

Replace the `people → generic` map (L167-181) with:

```ts
import { normalizeApifySourceType } from "../_shared/toolRegistry.ts";
const raw_source_type = tool_input_body?.source_type ?? null;
let source_type = normalizeApifySourceType(raw_source_type);
// If no tool_input.source_type, do the existing regex sniff, then normalize.
if (!raw_source_type) {
  const text = `${instruction} ${tool_input_body?.query ?? ""}`.toLowerCase();
  if (/\b(engineers?|developers?|candidates?|people|hiring|roles?|jobs?)\b/.test(text)) source_type = "jobs";
  else if (/\b(companies|founders?|startups?)\b/.test(text)) source_type = "jobs"; // companies-hiring shape until a companies actor exists
}
```

Drop the `allowedForHawk` companies path (now also routes to `jobs`). Pass `source_type` (normalized) into the Apify call. Persist debug fields on the tool_calls row:

```ts
metadata: {
  requested_source_type: raw_source_type,
  normalized_source_type: source_type,
  expected_actor_key: source_type,
}
```

### File 3 — `supabase/functions/_shared/toolInputPlanner.ts`

Update the system prompt + fallback parser so that "find N engineers / developers / candidates / people in <place>" maps to:

```json
{ "tool_name": "source_with_apify", "source_type": "jobs",
  "query": "engineer", "role_keywords": ["engineer"],
  "location": "London", "max_results": 10, "execution_mode": "fast" }
```

In `fallbackParse`, when intent is `source_signals` always set `source_type: "jobs"` (drop the companies/posts/people branches — those actors do not exist). In the AI prompt, add a rule: "No people/profile actor is configured. For prompts that mention engineers / developers / candidates / individual people, interpret as 'companies hiring those roles' and set source_type = jobs."

Add a `people_actor_unavailable` clarification path: if the user explicitly asks for "individual people / candidates / profiles" (regex on `\b(individual|specific) (people|candidates|profiles)\b` or `\bprofiles?\b` without "hiring"), set:

```ts
ask_clarification = true;
clarification = "I can currently find companies hiring engineers using Apify Jobs. Individual candidate/profile sourcing requires a people/profile actor to be configured.";
```

So pilot-chat surfaces it instead of silently running jobs.

### File 4 — `src/components/chat/workspace/plan/ToolStatusBadge.tsx` (tooltip-only, no redesign)

When `latestCall.error === 'apify_actor_not_configured'`, set the existing `title` attribute on the badge span to include `requested_source_type`, `normalized_source_type`, `expected_actor_key`, `actor_configured` from `latestCall.output_json`. Same badge text, same colors — debug-only hover affordance. No new components, no layout change.

## Deployment

Deploy `pilot-chat`, `run-agent`, `orchestrate` after changes.

## Verification

1. **"Find 10 engineers in London"** → planner emits `source_type: jobs`, run-agent logs `requested=people normalized=jobs`, Apify runs `curious_coder/linkedin-jobs-scraper`, badge shows result count + run_id tail. Aria's output explains these are companies/jobs hiring engineers.
2. **"Find companies hiring marketing roles in London"** → `source_type: jobs`, jobs actor runs.
3. **"Find 10 individual React developer profiles in London"** → planner sets `ask_clarification` with the people-actor message; no Apify run.
4. Force a bad source_type via raw API call to confirm the badge tooltip shows requested vs normalized vs expected actor key.

## Out of scope

UI redesign, removing tools, DB changes, schema changes, RLS changes, secrets changes, search_web behavior (still returns `broad_web_search_not_configured`).
