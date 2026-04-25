# Connect ScreeningPilot Frontend → Supabase Orchestration Layer

This plan adds the missing **agent orchestration backend** (tables, RLS, edge functions) and rewires the existing dock, dashboard feed, awaiting-you inbox, and command bar to consume real Supabase data with realtime updates. Existing recruiter features (resume_analyses, ICP, leads, screening jobs, etc.) are **untouched**.

---

## 1. Database Schema (single migration)

All 8 tables are scoped to a `workspaces` table. RLS enforces "user must be a member of the workspace". A `workspace_members` join table + `is_workspace_member(uid, ws)` SECURITY DEFINER function is added to avoid recursive RLS (per project memory `rls-security-definer-function`).

**Tables**

| Table | Key columns |
|---|---|
| `workspaces` | `id uuid pk`, `name text`, `owner_id uuid → auth.users`, `created_at` |
| `workspace_members` | `workspace_id`, `user_id`, `role text`, unique(workspace_id,user_id) |
| `agents` | `id uuid pk`, `workspace_id`, `slug text` (aria/scout/penn/hawk/scribe), `name`, `department text` (talent/growth/intelligence/content), `model text` (gpt-4o/claude-sonnet/claude-haiku/gemini-pro), `status text` ('idle'\|'running'\|'awaiting_approval'\|'error'), `current_task text`, `progress int`, `last_active_at` |
| `agent_capabilities` | `id`, `agent_id`, `capability text`, `tool text`, `enabled bool` |
| `task_plans` | `id`, `workspace_id`, `user_instruction text`, `plan_summary text`, `status text` ('planning'\|'executing'\|'awaiting_approval'\|'complete'\|'failed'), `created_by uuid`, `created_at`, `completed_at` |
| `tasks` | `id`, `plan_id`, `agent_id`, `step_index int`, `description text`, `status text` ('pending'\|'running'\|'complete'\|'failed'\|'skipped'), `input jsonb`, `output jsonb`, `started_at`, `finished_at` |
| `activity_feed` | `id`, `workspace_id`, `plan_id` (nullable), `agent_id` (nullable), `event_type text` (`plan_created`\|`agent_started`\|`handoff`\|`awaiting_approval`\|`approved`\|`rejected`\|`plan_complete`), `title text`, `body text`, `metadata jsonb`, `created_at` |
| `handoffs` | `id`, `plan_id`, `from_agent_id`, `to_agent_id`, `payload jsonb`, `created_at` |
| `approvals` | `id`, `workspace_id`, `plan_id`, `agent_id`, `task_id` (nullable), `title text`, `description text`, `payload jsonb`, `status text` ('pending'\|'approved'\|'rejected'), `decided_by uuid`, `decided_at` |

**RLS** — Enabled on all 8 tables; policies use `public.is_workspace_member(auth.uid(), workspace_id)` for SELECT, and `is_workspace_member(...) AND auth.uid() IS NOT NULL` for write. `workspaces` itself uses `owner_id = auth.uid() OR id IN (select workspace_id from workspace_members where user_id = auth.uid())`.

**Auto-provisioning** — A trigger on `auth.users` (extending the existing `handle_new_user` pattern) creates a default workspace per new user, inserts them as `owner` in `workspace_members`, and seeds 5 default agents (Aria, Scout, Penn, Hawk, Scribe) with their canonical departments + models matching `src/data/dockAgents.ts`. A backfill block at the bottom of the migration provisions the same for existing users so the dock isn't empty for the current account.

**Realtime** — `ALTER PUBLICATION supabase_realtime ADD TABLE` for `agents`, `activity_feed`, `approvals`, `task_plans` (+ `REPLICA IDENTITY FULL`).

---

## 2. Edge Functions (3 new)

All in `supabase/functions/<name>/index.ts`, using `verify_jwt = false` + in-code `getClaims` validation, modern CORS headers, and Zod input validation per project standards.

### `orchestrate`
- **Input**: `{ user_instruction: string, workspace_id: string }`
- **Auth**: requires JWT; verifies `is_workspace_member`.
- **Does**:
  1. Calls Lovable AI Gateway (`gemini-2.5-flash` per `ai-model-standards`) to produce a structured plan: `{ plan_summary, steps: [{ agent_slug, description }] }`.
  2. Inserts `task_plans` row (status=`planning`), inserts N `tasks`, inserts `activity_feed` event `plan_created`.
  3. Updates plan status to `executing`, then asynchronously invokes `run-agent` for the first step via `supabase.functions.invoke()` (fire-and-forget — no `await`).
  4. Returns `{ plan_id, plan_summary, steps_count }` to the frontend.

### `run-agent` (called by orchestrate; never directly from frontend)
- **Input**: `{ task_id: string }`
- **Does**: Marks task `running`, sets agent `status=running`, inserts `activity_feed` (`agent_started`). Calls AI Gateway to "execute" the step (mock-actionable output for now: returns a structured JSON describing what was done). On completion:
  - If the step requires approval (e.g. "send emails", "post outreach", "schedule interview"), creates an `approvals` row, sets agent `status=awaiting_approval`, inserts `activity_feed` (`awaiting_approval`), and stops.
  - Otherwise marks task `complete`, inserts a `handoffs` row + `activity_feed` (`handoff`) if a next step exists, sets next agent, and recursively invokes itself for the next task.
  - When no next task: marks plan `complete`, inserts `activity_feed` (`plan_complete`), sets agent back to `idle`.

### `approve-and-continue`
- **Input**: `{ approval_id: string, action: 'approve' | 'reject' }`
- **Does**: Verifies workspace membership, updates approval row (`status`, `decided_by`, `decided_at`), inserts `activity_feed` (`approved` | `rejected`). On approve, resumes by invoking `run-agent` for the next pending task in the plan; on reject, marks plan `failed` and resets agent to `idle`.

`supabase/config.toml` — add the 3 functions with `verify_jwt = false`.

---

## 3. Frontend Wiring

### A. `src/lib/orchestration.ts` (new)
Centralized data layer:
- `getCurrentWorkspaceId()` — returns the auth user's first workspace id (cached in `useState` via context below).
- `fetchAgents(workspaceId)`, `fetchActivityFeed(workspaceId, limit=50)`, `fetchPendingApprovals(workspaceId)`, `fetchCurrentPlan(workspaceId)`.
- `subscribeAgents`, `subscribeActivityFeed`, `subscribeApprovals`, `subscribePlans` — return unsubscribe fns; use `supabase.channel(...).on('postgres_changes', ...)`.
- `submitInstruction(text)` → `supabase.functions.invoke('orchestrate', ...)`.
- `decideApproval(id, action)` → `supabase.functions.invoke('approve-and-continue', ...)`.

### B. `src/contexts/WorkspaceContext.tsx` (new)
Provides `{ workspaceId, loading }` to the tree by querying `workspace_members` for `auth.uid()`. Mounted inside `AuthProvider` in `App.tsx`.

### C. Operative Dock — `src/components/dock/OperativeDock.tsx`
- Replace static `DOCK_AGENTS` with `useAgents(workspaceId)` hook backed by `fetchAgents` + `subscribeAgents`.
- Map DB agent rows → existing `DockAgent` shape using the `slug` to look up image/role from `agentProfiles.ts` (kept as a static profile registry).
- `status === 'running' || 'awaiting_approval'` → pulsing dot; else static. Department color ring stays driven by `department`.
- Hover card / drawer pull `current_task`, `progress`, `model`, `name` directly from the row.

### D. Command Bar — `src/components/dock/CommandBar.tsx` + `CommandPalette.tsx`
- Add a controlled text input + submit handler inside the existing palette flow. On submit:
  ```ts
  const { data } = await submitInstruction(text);
  toast.success('Plan created', { description: data.plan_summary });
  ```
- Keep the existing `command-bar:prefill` event so dock-driven prefill still works.

### E. Awaiting You Inbox — `src/pages/AwaitingYou.tsx`
- Replace the hardcoded `INITIAL` array with `useApprovals(workspaceId)` (fetch + subscribe).
- "Approve" / "Reject" buttons call `decideApproval(id, 'approve' | 'reject')`. Optimistic removal stays for snappy UX; sonner toast on success/error.
- Pending count is exposed via context so the sidebar/dock can show a badge.

### F. Activity Feed (Dashboard) — `src/components/dashboard/HandoffFeedItem.tsx` + Dashboard
- Generalize `HandoffFeedItem` to render any `event_type`: switch on `event_type` for icon, color stripe, and layout (handoff stays two-agent; others use a single-agent compact card).
- Replace the hardcoded `HANDOFF_EVENTS` in `Dashboard.tsx` with a `useActivityFeed(workspaceId, 20)` hook that prepends new realtime inserts at the top with a fade-in.

### G. Verification Panel — `src/components/dev/VerificationPanel.tsx` (new)
- Fixed bottom-right card, only renders when `import.meta.env.DEV`.
- On mount, runs 8 lightweight `select count` queries (one per orchestration table) + a `supabase.functions.invoke('orchestrate', { /* dry-run flag */ })` ping (orchestrate accepts `{ ping: true }` and returns `{ ok: true }` without creating a plan).
- Shows green ✓ + row count per table, red ✗ + error message on failure. Dismiss button hides for the session (sessionStorage flag).
- Mounted in `App.tsx` next to `<AuthenticatedBackground />`, gated on `import.meta.env.DEV`.

---

## 4. Files Touched

**Created**
- `supabase/migrations/<timestamp>_orchestration_layer.sql`
- `supabase/functions/orchestrate/index.ts`
- `supabase/functions/run-agent/index.ts`
- `supabase/functions/approve-and-continue/index.ts`
- `src/lib/orchestration.ts`
- `src/contexts/WorkspaceContext.tsx`
- `src/hooks/useAgents.ts`, `useActivityFeed.ts`, `useApprovals.ts`
- `src/components/dev/VerificationPanel.tsx`

**Modified**
- `supabase/config.toml` (register 3 functions)
- `src/App.tsx` (mount `WorkspaceProvider`, `VerificationPanel`)
- `src/components/dock/OperativeDock.tsx` (live agents)
- `src/components/dock/CommandBar.tsx` + `src/components/shared/CommandPalette.tsx` (submit → orchestrate)
- `src/pages/AwaitingYou.tsx` (live approvals)
- `src/pages/Dashboard.tsx` (live activity feed)
- `src/components/dashboard/HandoffFeedItem.tsx` (generalize event types)
- `src/data/dockAgents.ts` (kept as static profile fallback; runtime data now flows from DB)

---

## 5. Out of Scope / Notes
- Existing tables (`resume_analyses`, ICP, leads, screening jobs) are untouched.
- The Lovable AI Gateway secret (`LOVABLE_API_KEY`) is already provisioned for this project — no new secret required.
- The orchestrate/run-agent loop is intentionally simple (sequential plan execution). Parallel fan-out, retries, and tool-calling can be layered on later without schema changes.

**Ready to switch to default mode and execute?** Reply *approve* and I'll ship the migration, the 3 edge functions, and the frontend wiring in one pass.