## Root cause

Live test of `/dashboard` actually renders correctly — the blank screen is **intermittent**, not deterministic. Your own console log gave away why:

```
workspace resolve failed: Lock "lock:sb-...-auth-token" was released because another request stole it
```

Three places race for the same Supabase auth `navigator.lock` on mount (worse under React StrictMode double-invoke):

1. `useAuth` → `supabase.auth.getSession()` + `fetchProfile`
2. `ClientContext` → `fetchClientBranding` (calls `auth.getSession`)
3. `WorkspaceContext` → `getCurrentWorkspaceId()` which calls `supabase.auth.getUser()` in `src/lib/orchestration.ts:58`

`getUser()` is the heaviest — it does a network round-trip while holding the lock. When another caller steals the lock, `getCurrentWorkspaceId` throws, `WorkspaceContext` permanently sets `workspaceId = null` with no retry, and any descendant that assumes a workspace (CommandDock, ChatWorkspace, dashboard widgets, ExecutionPlanCard, realtime channels) can render nothing or throw. The outer `AppErrorBoundary` catches the throw, but the sidebar/background layout still paints, leaving the visible area looking blank/black.

A secondary class of intermittent crashes is null-unsafe access in the new Execution Plan / tool-call UI when message metadata is malformed.

## What we'll change (frontend only, no backend/route/architecture changes)

### 1. Eliminate the auth-lock race in workspace resolution
- `src/lib/orchestration.ts` → `getCurrentWorkspaceId`: use the already-cached session via `supabase.auth.getSession()` instead of `getUser()` (no network call, far less lock contention), fall back to `getUser()` only if session is absent.
- `src/contexts/WorkspaceContext.tsx`:
  - Subscribe to `supabase.auth.onAuthStateChange` so we re-resolve once the session settles instead of racing it.
  - Auto-retry once on `isAcquireTimeout` / "lock … was released" errors (small backoff) before surfacing an error.
  - Keep the existing manual `retry()` for the fallback UI.

### 2. Visible fallback when workspace can't load (no more silent blank)
- New `src/components/WorkspaceGate.tsx`: small component that reads `useWorkspace()` and renders:
  - loading: subtle spinner card
  - error / no workspace: card with message, **Retry**, **Sign out**, **Go to setup** buttons
  - otherwise: `{children}`
- Wrap `MainLayout`'s `<main>` content in `WorkspaceGate` so every protected route gets a fallback instead of a black panel.

### 3. Route-level error boundaries
- Add a lightweight `RouteErrorBoundary` (reuse `AppErrorBoundary` styling) inside `MainLayout` around `{children}` so a crash in one page doesn't blank the whole shell — sidebar, dock, and a visible "this page failed" card stay on screen.
- Keep existing `ChatErrorBoundary` for `ChatWorkspace`; ensure it wraps `ChatWorkspace` and `CommandDock` mounts in `MainLayout`.

### 4. Null-safety pass on Execution Plan UI
Files: `src/components/chat/workspace/plan/ExecutionPlanCard.tsx`, `ExecutionTaskRow.tsx`, `ToolStatusBadge.tsx`, `ApprovalBadge.tsx`, `ActivityMiniFeed.tsx`, `src/hooks/usePlanDetail.ts`, and the place where chat messages decide to render a plan card.
- Guard `message.metadata`, `metadata.type === 'execution_plan'`, missing `plan_id` → render nothing (or a tiny dev-only "malformed plan metadata" hint) instead of throwing.
- Default `tasks`, `toolCalls`, `activity`, `approvals` to `[]`.
- Safe access to `task.metadata?.tool_needed`, Apify `run_id` / result count, and date formatting (skip if `created_at` is null).

### 5. Realtime subscription hardening
- In `usePlanDetail` and `useActivityFeed`: only create the channel when the required id exists; register all `.on(...)` handlers before `.subscribe()`; cleanup with `supabase.removeChannel(channel)` via the existing `src/lib/realtime.ts` helpers; use stable channel names via `createRealtimeChannelName`.

### 6. Frontend secret hygiene
- `src/lib/api/screening.ts` and `src/components/SupabaseTest.tsx` reference `process.env` in browser code — replace with `import.meta.env` guarded checks. (No real server secrets are exposed today; `APIFY_API_TOKEN`, `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `LOVABLE_API_KEY` are not referenced in `src/`. `VITE_FIRECRAWL_API_KEY` in `src/lib/firecrawl.ts` / Talent/Competitor pages is a `VITE_` public var by design — leaving it, only adding a comment that production scraping should go through the edge function.)

### 7. Dev-only diagnostics panel
- New `src/components/dev/PreviewDiagnostics.tsx`, mounted in `App.tsx` only when `import.meta.env.DEV`. Floating, collapsed-by-default chip in the corner showing: auth status, user id (truncated), workspaceId, current route, last fatal error captured by `AppErrorBoundary` (via a small event bus). Zero impact on production.

### 8. VerificationPanel safety
- Already gated by `VITE_ENABLE_VERIFICATION_PANEL` — keep as-is, just ensure its `AppErrorBoundary` wrap stays.

## Verification

1. Reload `/dashboard` 10x in Lovable preview (StrictMode double-mounts) → no `workspace resolve failed` toast/crash; if one slips through, the WorkspaceGate fallback shows with a Retry that recovers.
2. Open hosted preview URL directly → renders.
3. Send `hello`, `Brief me on today`, `Find companies hiring marketing roles in London`, and a Hawk Firecrawl prompt → plan cards render; if metadata is malformed, no white-screen.
4. Manually throw inside `Dashboard` (temporarily) → only the main panel shows the route fallback; sidebar/dock stay alive. Revert after verifying.
5. `tsc` / preview build passes.

## Out of scope (per your constraints)

No redesign, no route changes, no backend/RLS changes, no removal of Pilot / ChatWorkspace / Plan Cards / Apify / Firecrawl / orchestrate / run-agent / WorkspaceContext / onboarding.
