
# Claude-first Canary — Single Workflow on Production

Scope: workspace `e510c1a6-2bb8-4aa4-95f7-0beb786ed995` only. One prompt, at most one continuation, hard cost ceiling $5. Flag is disabled again at the end regardless of outcome.

## Step 1 — Enable flag (production)

Set two runtime secrets on production project `wqnigjhcwjxtmordrwno`:

- `CLAUDE_FIRST_LEAD_PLANNING = "true"`
- `CLAUDE_FIRST_LEAD_PLANNING_WORKSPACES = "e510c1a6-2bb8-4aa4-95f7-0beb786ed995"`

Confirm both via `fetch_secrets` before invoking any function.

## Step 2 — Trigger exactly one workflow

Invoke the production planner path with the prompt:

> Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.

Target workspace: `e510c1a6-2bb8-4aa4-95f7-0beb786ed995`. Record the returned `task_id` / `plan_id`.

## Step 3 — Pre-execution planner verification (abort gate)

Before any provider (Apify / enrichment) execution runs, read the task's `result` / `task_plans.plan_summary` diagnostics and confirm ALL of:

- planner provider = Anthropic, source = Claude, status = successful
- no `deterministic_fallback` marker
- accepted hiring titles = {Sales Operations, Revenue Operations, GTM Operations}
- decision-makers = {Founder, Co-Founder, CEO}
- requested count = 5, quota mode = `contact_only`, geography = United States
- estimated total provider cost ≤ $5
- diagnostics contain no raw Actor IDs, credentials, or raw prompts

If ANY check fails → immediately set `CLAUDE_FIRST_LEAD_PLANNING=false`, stop, and report.

## Step 4 — Execution monitoring (abort gate)

While the task runs, poll `public.tasks` for the plan. Abort (set flag false, stop) if:

- provider switches away from Anthropic
- deterministic fallback fires
- any mission field mutates
- plan becomes incomplete
- estimated/actual cost exceeds $5
- WATCH candidates count against quota
- continuation spawns a NEW task row (must be same task ID)
- completed provider calls repeat
- diagnostics leak secrets/raw prompts

## Step 5 — Continuation (at most once)

If terminal status = `continuation_required`, call `claim_sourcing_continuation` + resume once on the SAME task ID. Verify: same task ID, cumulative quota + cost, no duplicate completed provider calls, previous results preserved, continuation claim released via `release_sourcing_continuation`. No second continuation is allowed.

## Step 6 — Disable flag

Regardless of outcome, set `CLAUDE_FIRST_LEAD_PLANNING = "false"` on production and confirm via `fetch_secrets`. Leave `CLAUDE_FIRST_LEAD_PLANNING_WORKSPACES` in place (harmless when flag is off) unless you want it cleared too.

## Step 7 — Report

Return: task ID, planner provider/model, accepted titles, capabilities, CONTACT-ready count, WATCH count, total cost, terminal status, continuation result, and confirmation `CLAUDE_FIRST_LEAD_PLANNING=false`.

## Technical notes

- Secrets managed via `secrets--set_secret` (create) / `secrets--update_secret` interactive form is NOT viable here — use `set_secret` for the fixed string `"true"` / `"false"` values, and same for the workspace UUID allowlist.
- Task trigger: invoke the same production edge function the UI uses for Pilot lead planning (`pilot-chat` → `orchestrate` → `run-agent`) via `supabase--curl_edge_functions` with a service-role JWT scoped to the target workspace, OR insert directly into `task_plans` using the documented planner entrypoint if the HTTP path requires a user session.
- Diagnostic reads use `supabase--read_query` on `public.tasks` and `public.task_plans` (fields: `result`, `plan_summary`, `status`, `checkpoint_version`, `continuation_claim_*`).
- Cost tallying uses `ai_gateway_logs--list_ai_gateway_requests` filtered by the task's `run_id` for the Anthropic planner call, plus any provider tool_calls rows for downstream spend.
- Hard stop: if at any abort gate the flag flip fails, retry `set_secret` up to 2×, then escalate in the report.
