# Fix orchestrator "Workspace not found"

## Root cause

`supabase/functions/orchestrate/index.ts` does:

```ts
.from("workspaces")
  .select("company_brain, daily_run_limit, tokens_used_today")
  .eq("id", workspace_id)
  .single();
```

The `workspaces` table in `wqnigjhcwjxtmordrwno` only has:
`id, name, owner_user_id, created_at, updated_at`.

Selecting non-existent columns makes `.single()` return `data = null` with an error → the function falls into the `if (!workspace)` branch and returns `404 "Workspace not found"`. The workspace and the user's membership actually exist:

- 1 workspace: `e510c1a6-2bb8-4aa4-95f7-0beb786ed995` (owner = the signed-in user)
- 1 row in `workspace_members` for that user
- 5 agents seeded with 2 capabilities each

pilot-chat is correct (it forwards `workspace_id` snake_case, with a valid uuid, after checking membership itself).

Additional drift discovered while tracing the path (will be fixed in the same edit so the pipeline doesn't just fail at the next step):

| Table | Code uses | Real columns |
|---|---|---|
| workspaces | company_brain, daily_run_limit, tokens_used_today | (none of these) |
| agent_capabilities | input_type, output_type, priority | only `capability`, `config` |
| task_plans | plan, current_step, status='running' | goal, user_instruction, plan_summary, steps, status, workspace_id, created_by |
| tasks | task_plan_id, agent_id, workspace_id, step_index, input, output, tokens_in, tokens_out | plan_id, agent_slug, payload, result, user_id, status |
| activity_feed | task_plan_id | plan_id |
| handoffs | from_agent_id, to_agent_id, task_plan_id | from_agent_slug, to_agent_slug, plan_id |
| approvals | summary, payload, task_plan_id | description, plan_id, task_id |

## Changes (frontend untouched)

### 1. `supabase/functions/orchestrate/index.ts` — rewrite

- Validate JWT, derive `userId`, accept body with snake_case + camelCase aliases:
  ```ts
  const workspace_id = body.workspace_id ?? body.workspaceId;
  const user_instruction = body.user_instruction ?? body.userInstruction;
  const conversation_id = body.conversation_id ?? body.conversationId ?? null;
  ```
- Keep `ping` health-check first.
- Use service-role client, but **also** validate membership via `workspace_members` (user_id + workspace_id). On miss return structured 404:
  ```json
  { "error": "workspace_not_found", "details": "User is not a member of this workspace", "workspace_id": "..." }
  ```
- Look up workspace with `select("id, name")` only. Load `company_brain.profile` from the `company_brain` table separately (best-effort, empty-object fallback). Drop the `daily_run_limit / tokens_used_today` rate-limit check (those columns don't exist; non-blocking).
- Fetch capabilities with the columns that exist: `capability, config, agents ( id, slug, name, model, department )`.
- Update the Anthropic planner prompt to ask for `agent_slug` (not agent_id) and to drop input_type/output_type — just `capability` strings. Keep `needs_approval`, `instruction`, `step_index`.
- Persist plan into `task_plans` using real columns:
  ```ts
  insert({
    workspace_id,
    user_id: userId,
    created_by: userId,
    goal: user_instruction,
    user_instruction,
    plan_summary: parsedPlan.plan_summary,
    steps: parsedPlan.steps,
    status: "executing",
  })
  ```
- Log to `activity_feed` with `plan_id` (not `task_plan_id`), event_type `plan_created`.
- Fire first step into `run-agent` with the new payload contract:
  ```json
  { "plan_id": "...", "step_index": 0, "agent_slug": "scout",
    "workspace_id": "...", "user_id": "...", "instruction": "...",
    "input": "<user_instruction>", "needs_approval": false }
  ```
- On success return `{ success, plan_id, plan_summary, total_steps, plan }` (keep `task_plan_id` alias for backward compat with pilot-chat which already accepts both).

### 2. `supabase/functions/run-agent/index.ts` — minimum schema alignment

Only what's needed so the chained call from orchestrate doesn't crash with the same kind of error and report it back up:

- Accept `plan_id` (with `task_plan_id` alias) and `agent_slug` (with `agent_id` alias resolved to slug via a lookup).
- Insert task with real columns: `plan_id, agent_slug, payload: { instruction, input }, status: 'running', user_id`.
- `activity_feed` insert uses `plan_id` (not `task_plan_id`).
- Approvals insert uses `description` (not `summary`), `plan_id` (not `task_plan_id`), drop `payload`.
- Handoffs insert uses `from_agent_slug, to_agent_slug, plan_id` (not the _id variants / task_plan_id).
- Read plan back with `select("steps, plan_summary").eq("id", plan_id)`; `steps[step_index+1]` drives the next call.
- `task_plans` updates use status only (no `current_step` column).
- Tasks update writes `result: { output, tokens_in, tokens_out }` instead of separate columns.

### 3. Redeploy

Redeploy `orchestrate` and `run-agent`. No DB migration, no UI, no env, no schema change.

## Verification

- `select id from workspaces` → returns the same uuid pilot-chat is sending. ✅ already confirmed.
- Send "hello" → Pilot reply, same as today.
- Send "Find React engineers in London":
  - `orchestrate` returns 200 with `plan_summary` + `total_steps ≥ 1`.
  - One row inserted in `task_plans` (workspace_id matches the resolved id).
  - One row in `tasks` (plan_id matches).
  - One row in `activity_feed` with `event_type = 'plan_created'`, `plan_id` set.
  - No "Workspace not found".
  - No realtime/postgres_changes errors in console (the earlier fix is preserved).
- If anything fails, the response is the structured `workspace_not_found` JSON, not a crash.

## Out of scope (explicit)

- No backend project switch. Active backend stays `wqnigjhcwjxtmordrwno`.
- No `.env` / generated client / generated types edits.
- No new tables, no RLS changes, no reseeding agents (5 are already present).
- No UI redesign, no changes to `WorkspaceContext`, `pilotChat.ts`, `useChatConversation`, or `ChatErrorBoundary`.
- `chat-respond` not reintroduced.
