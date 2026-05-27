
# ScreeningPilot — Architecture Audit & Workspace Fix Plan

## 1. Root cause of "No workspace selected" (confirmed)

The new orchestration stack (pilot-chat, orchestrate, run-agent, approvals, activity feed, Company Brain injection) expects a schema that **does not exist in the Supabase project Lovable Cloud is connected to**.

Evidence:
- `.env` → `VITE_SUPABASE_PROJECT_ID=wqnigjhcwjxtmordrwno` (the Lovable-managed project).
- The "correct live project" you mentioned (`zbwsbnqqpkvdhqwavjke`) is a *different* Supabase project. Claude Code migrated **that** one, not this one.
- `SELECT table_name FROM information_schema.tables WHERE table_schema='public'` on the Lovable project returns **none** of: `workspaces`, `workspace_members`, `company_brain`, `approvals`, `activity_feed`, `agent_capabilities`, `tools`, `secret_connections`, `jobs`, `job_steps`, `organizations`, `dialer_leads`.
- RPC `provision_workspace_for_user` does **not** exist either.
- `src/contexts/WorkspaceContext.tsx` calls `getCurrentWorkspaceId()` → `supabase.from('workspace_members').select('workspace_id')` → table missing → throws → catch logs, `workspaceId` stays `null` → every chat surface short-circuits with "No workspace selected".

So this is **not** a provider lifecycle bug, not async hydration, not a missing guard. The frontend code is correct. The database it talks to is missing half the new architecture.

The Lovable preview cannot be re-pointed at the other Supabase project from inside Lovable — the connection is managed. The only correct path is to **bring this project's schema up to parity** with what the new runtime expects, then let auto-provisioning create the first workspace per user.

## 2. Fix (minimal, correct, no fake UUIDs)

Single migration that creates the missing orchestration tables + auto-provisioning, mirroring what `lib/orchestration.ts` and `pilot-chat` already expect:

1. `workspaces (id, name, owner_user_id, created_at)` — owner_user_id references `auth.users`.
2. `workspace_members (id, workspace_id, user_id, role, created_at)` — unique(workspace_id, user_id).
3. `company_brain (workspace_id PK, profile jsonb, updated_at)` — single row per workspace, optional.
4. `approvals (id, workspace_id, plan_id, agent_id, task_id, title, description, status, created_at)` matching `DBApproval` in `orchestration.ts`.
5. `activity_feed (id, workspace_id, plan_id, agent_id, event_type, title, body, metadata, created_at)` matching `DBActivity`.
6. Add missing `workspace_id`, `created_by`, `plan_summary`, `user_instruction`, `status`, `completed_at` columns to existing `task_plans` (if not present) and `agent_id`, `step_index`, `description`, `status`, `input`, `output`, `started_at`, `finished_at` to `tasks` — only ALTER where columns are missing.
7. Security-definer function `has_workspace_access(_user_id uuid, _workspace_id uuid)` to avoid recursive RLS on `workspace_members`.
8. RLS + GRANTs on all new tables (authenticated read/write scoped via `has_workspace_access`, service_role full).
9. `provision_workspace_for_user(_user_id uuid)` RPC — creates a personal workspace if the user has none, inserts the membership row, returns the workspace id. Matches the fallback in `getCurrentWorkspaceId()` exactly.
10. Trigger on `auth.users` insert → call `provision_workspace_for_user(NEW.id)` so every future signup auto-gets a workspace. Existing users are covered by the RPC fallback in `getCurrentWorkspaceId()` the first time they load any chat surface.
11. Seed: run the RPC once for every existing row in `profiles` so current logged-in users immediately have a workspace.

No frontend code changes are required for the fix itself — `WorkspaceContext` and `getCurrentWorkspaceId` already implement the right "fetch membership, else RPC-provision" flow. The DB just has to honor it.

### Frontend hardening (small, after the migration lands)

- In `WorkspaceContext`, surface the error state explicitly (`error: Error | null`) so chat surfaces can render a single retry CTA instead of a generic toast when something does go wrong post-fix.
- Gate `MainLayout`'s `CommandDock` / `ChatWorkspace` on `workspace.loading === false && workspaceId != null` to avoid the toast flashing during the first paint after sign-in.

That's it for the bug.

## 3. Architecture audit (brutal, current state)

### Frontend
- **Provider tree** (`App.tsx`): `Auth → Workspace → Client → ClientTheme`. Correct order. `WorkspaceProvider` correctly waits on `authLoading`. No lifecycle bug here.
- **Chat surfaces** (`CommandDock`, `ChatComposerPro`, `HeroCommandSurface`, `ConversationView`, `ChannelView`, `DirectAgentView`, `PlanDetailView`) all consume `useWorkspace()` and call `pilotChat()` / `submitInstruction()`. They will all start working the moment workspaces exist.
- **Dead/legacy code still imported**: `OperativeDock.tsx`, `HeroCommandSurface.tsx` (per audit, removed from mount but file still in tree and references `useWorkspace`). Worth deleting to prevent regressions.
- **State management**: ad-hoc `useState` + realtime channels per surface. No global cache for plans/tasks/agents. Re-mount = refetch. Will hurt as plan volume grows. React Query is in the tree (`QueryClient`) but most orchestration hooks bypass it.
- **Realtime fan-out**: each surface opens its own `supabase.channel('realtime:...')`. No central subscription manager. Easy to leak channels on fast route changes.
- **Error UX**: `pilotChat` errors bubble as toasts only. No retry, no message persistence on failure, no offline buffering.
- **Types**: heavy use of `as any` against `supabase.from('agents' as any)` because the generated `types.ts` was regenerated against the *other* project and doesn't include the new tables here. Once the migration lands, types regenerate and most casts can go.

### Backend / Edge functions
- `pilot-chat`, `orchestrate`, `run-agent`, `approve-and-continue` exist and (per your smoke tests) execute real Claude calls. Good.
- **No queue.** Long-running plans run inside a single function invocation. Vulnerable to Supabase's 150s edge function timeout, cold starts, and silent kill on deploy. First scalability cliff.
- **No retries / no DLQ.** A failed step writes `status='failed'` and stops. No exponential backoff, no resumability.
- **No structured-output validation.** `schemas.ts` exists but enforcement is best-effort; malformed Claude JSON tanks a step.
- **No observability beyond `activity_feed` rows.** No latency, token, cost, or model-version logging per step. You can't answer "why did Aria cost 12k tokens today" without grep'ing logs.
- **Approval architecture** is server-driven but client-coupled — UI assumes realtime delivers approval rows instantly. No reconcile loop on reconnect.
- **`verify_jwt`** disabled on most functions (Lovable default). Acceptable short-term, but `pilot-chat` should validate the JWT in code and re-derive `workspace_id` from membership, not trust the client-sent value. Today it trusts the client.

### AI runtime
- Prompts in `run-agent/prompts.ts` are concise and per-agent. Good.
- **No retrieval / memory beyond Company Brain.** Aria doesn't see prior candidates; Penn doesn't see prior outreach replies. Cross-turn memory is whatever the client stuffs into the next message.
- **No model routing / fallback.** Single hard-coded Claude model per agent. One Anthropic outage = product-wide outage.
- **Context length unmanaged.** Long conversations will silently truncate or 400 once they exceed the model window.
- **Multi-agent strength**: real chaining + approval gates is genuinely good and rare at this stage.
- **Multi-agent weakness**: no shared scratchpad, no agent-to-agent message bus — handoffs are JSON blobs passed through `tasks.output → tasks.input`.

## 4. Product maturity — honest read

- **Demo-ready**: yes, for a 10-minute scripted run on the happy path, *after* the workspace fix lands.
- **Pilot-user-ready**: not yet. Top blockers in order:
  1. Workspace schema parity (this plan).
  2. Plan execution visibility (live task graph, per-step status, errors surfaced in chat).
  3. Queue + retries so a refresh / deploy doesn't kill an in-flight plan.
  4. Per-workspace cost & token observability.
  5. Approval inbox (`/awaiting-you`) wired to realtime approvals across all surfaces.
- **Biggest current risk**: silent failures inside `run-agent`. A user sees "thinking…" forever because nothing surfaces the failed step back to the conversation.

## 5. Recommended next priorities (post-fix, in order)

1. **Plan rendering in chat** — when `pilotChat` returns `type: 'plan'`, inline render `PlanDetailView` directly in the conversation with live task status, not a separate route hop.
2. **Workspace onboarding** — first-run flow: name your workspace → fill Company Brain (the existing 12-question setup) → land on Dashboard. Currently auto-provisioned workspaces have empty Brain and agents underperform.
3. **Execution observability** — `agent_runs` already exists; add `latency_ms`, `input_tokens`, `output_tokens`, `cost_cents`, `model_version`. Surface a per-workspace usage panel.
4. **Resumable plans** — move `run-agent` step execution behind a `pg_cron` + `job_queue` pattern (or Supabase Queues). Functions enqueue, a worker drains. Kills the 150s ceiling.
5. **Retries + structured-output guard** — wrap every Claude call with: schema-validate → 1 retry with "fix the JSON" prompt → mark step failed with reason → post failure bubble into the conversation.
6. **Approval UX** — global approval badge in `CommandDock`, click → opens a side panel with the diff/preview the agent produced. Today approvals live inside one plan view only.
7. **Memory layer** — workspace-scoped vector store (pgvector) seeded from Company Brain + prior conversations + prior candidate decisions. Inject top-k into every agent call. Single biggest quality unlock.
8. **Firecrawl + retrieval** — Hawk and Scout should pull live data, not hallucinate. Wire `firecrawl_scrape_logs` results into Aria/Penn context.
9. **Model routing & fallback** — config table per agent, Lovable AI Gateway as fallback when Anthropic is degraded.
10. **Delete dead code** — `OperativeDock`, `HeroCommandSurface`, `chat-respond` edge function, legacy commented routes in `App.tsx`. Each is a future regression.
11. **Drop the `as any` casts** once types regenerate against the corrected schema.

## 6. Deliverables of this plan

- **Migration** creating `workspaces`, `workspace_members`, `company_brain`, `approvals`, `activity_feed`, missing columns on `task_plans` / `tasks`, `has_workspace_access()` security-definer, `provision_workspace_for_user()` RPC, `auth.users` trigger, RLS + GRANTs, and a one-time backfill for existing `profiles`.
- **Small frontend hardening** in `WorkspaceContext` (expose error, retry) and `MainLayout` (gate chat surfaces on `loading=false && workspaceId`).
- **Memory update** documenting the orchestration schema contract so future passes don't drift again.

No other code changes in this pass. Audit findings beyond the fix are recommendations, not deliverables.
