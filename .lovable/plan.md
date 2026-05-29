## Root cause

`supabase/functions/orchestrate/index.ts` uses `SUPABASE_SERVICE_ROLE_KEY` as a bare identifier on lines 182 (`createClient`) and 387 (`Authorization: Bearer …` when calling `run-agent`), but only declares `SUPABASE_URL` and `SUPABASE_ANON_KEY` from `Deno.env.get(...)`. Result: `ReferenceError: SUPABASE_SERVICE_ROLE_KEY is not defined` → `internal_error` returned to `pilot-chat` → user sees "the orchestrator failed: internal_error".

The secret itself exists in the project (confirmed in `<secrets>`: `SUPABASE_SERVICE_ROLE_KEY`). No new secret needed.

All other functions (pilot-chat, run-agent, toolRegistry, aiProvider) already read env vars correctly — orchestrate is the only one with the bug.

## Changes

### 1. `supabase/functions/orchestrate/index.ts`
Add the missing declaration alongside the existing ones:
```ts
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!SUPABASE_SERVICE_ROLE_KEY) {
  return json({ error: "missing_service_role_key", message: "SUPABASE_SERVICE_ROLE_KEY is not configured for this Edge Function" }, 500);
}
```
This keeps lines 182 (`createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`) and 387 (`Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) working unchanged.

### 2. `supabase/functions/_shared/aiProvider.ts` — make `logProviderCall` non-blocking
Already wrapped in try/catch with `console.warn`, but the caller passes an `admin` client created from a possibly-missing service role. Add a guard at the top of `logProviderCall`:
```ts
if (!admin) return;
```
And in each calling function (`pilot-chat`, `orchestrate`, `run-agent`), the existing pattern already swallows logging failures — no further change needed. Confirm by re-reading the call sites.

### 3. Redeploy
Deploy `orchestrate` (only file changed). `pilot-chat`, `run-agent`, `aiProvider` unchanged unless step 2's guard is added — in which case redeploy those too.

## Verification

After deploy, in Lovable Preview:
- "hello" → Pilot replies (already works).
- "generate a plan for finding 10 React engineers in London" → `task_plan` + Scout/Aria/Penn tasks created, no `internal_error`, no `ReferenceError`.
- "Brief me on today" → Hawk plan runs; without `PERPLEXITY_API_KEY`, returns the connector-needed message (unchanged behavior).
- Check `activity_feed` for `ai_provider_call` rows and `task_plan` rows.
- Check `supabase--edge_function_logs orchestrate` — no ReferenceError.

## Out of scope
No UI changes. No schema changes. No removal of any function. No new secret requests. No RLS changes.
