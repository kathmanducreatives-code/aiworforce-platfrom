# Moving Edge Functions onto the Railway service

**Status: implemented and verified locally. Nothing is deployed and no traffic has moved.**

The Railway service can now serve `pilot-chat`, `run-agent`, `orchestrate` and
`enqueue-lead-mission` over HTTP, using the same handler modules the Supabase
Edge deployment runs. Both deployments still exist; which one receives a call is
decided by two environment variables on each side, and the default on both is
"everything stays on Supabase".

---

## 1. What was audited, and what each function is

`Pilot → Lead Mission → Lead V2 → Workbench` is the path that matters. Every
Edge Function was classified against it.

### A — moved now (served by both, callers still default to Supabase)

| Function | Lines | Why |
|---|---|---|
| `pilot-chat` | 4 366 | The entry point. Compiles the mission, calls `orchestrate`. |
| `run-agent` | 8 382 | The engine. Already imported in-process by the worker, so the seam existed. |
| `orchestrate` | 1 767 | Plans and kicks off; the hinge between chat and execution. |
| `enqueue-lead-mission` | 69 | The V2 queue door. Service-role only; moves with `orchestrate` or the kickoff breaks. |

### B — kept on Supabase for now

`continue-workflow` (346) and `approve-and-continue` (125) are on the Workbench
path and are the obvious next candidates, but they only *call* `run-agent` —
they now do so through the resolver, so they benefit from the migration without
moving. `resume-stalled-leads` (429) is cron-driven and likewise dispatches
through the resolver. Everything else — `daily-brief`, `run-radar-scan`,
`run-monitoring-*`, `firecrawl-scrape`, `google-calendar-*`, `send-scheduled-emails`,
`email-tracking`, `generate-*`, `setup-company-brain`, `unlock-founders`,
`job-feed`, `tool-availability`, `integration-readiness`, `run-lead-action`,
`mcp` — is outside the Lead V2 spine and was deliberately left alone.

### C — dead / legacy

None were removed. Nothing was deleted as part of this change.

### D — needs more investigation

* `mcp` (122) — unclear whether anything still calls it.
* `job-feed` (102) — no frontend call site was found.

Both are outside the spine and were not touched.

---

## 2. How it works

**One implementation.** `worker/api/routes.ts` imports each function's own
handler out of `supabase/functions/`. Nothing is reimplemented and nothing is
copied — the module serving `/functions/v1/pilot-chat` is the module serving
`/api/pilot-chat`, at the same commit.

`pilot-chat` mounts `servePilotChat`, not `handlePilotChat`: the wrapper is
where an unhandled failure becomes a message in the conversation and where
model spend reaches the ledger. It was *extracted* from the `Deno.serve`
callback rather than duplicated, so both front doors fail and bill identically.

**One destination table.** Nine hard-coded `${SUPABASE_URL}/functions/v1/…`
literals across five files became `functionUrl(name, env)`
(`supabase/functions/_shared/functionEndpoints.ts`). Callers ask; they no longer
assume.

**One transport in the browser.** `src/lib/agentoryApi.ts` returns
`supabase.functions.invoke`'s own `{ data, error }` shape, including
`error.context` as a real `Response`, so `readErrorBody` keeps working
untouched.

**Auth is unchanged, and is still the handlers'.** Every migrated handler
already validated the JWT and workspace membership itself
(`isServiceRoleBearer` → `auth.getUser` → `workspace_members` →
`decideWorkspaceAccess`). The API forwards `Authorization` verbatim and never
reads `workspace_id` or `user_id` from the body. What it *adds* is
`worker/api/gateway.ts`, replacing the first gate that Supabase's `verify_jwt`
provided for free: a bearer-shape and signature check taken before any body is
read or any handler is entered.

---

## 3. Environment matrix

Secrets are named, never printed. `—` means "not set".

### Railway service

| Variable | Today (worker) | API + worker | API only |
|---|---|---|---|
| `AGENTORY_ROLE` | — (= `worker`) | `both` | `api` |
| `AGENTORY_API_ROUTES` | — | `*` or a comma list | same |
| `PORT` | set by Railway | required | required |
| `SUPABASE_URL` | ✅ | ✅ | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | ✅ | ✅ |
| `SUPABASE_ANON_KEY` | ✅ | ✅ (handlers' `getUser`) | ✅ |
| `SUPABASE_JWT_SECRET` | — | optional, HS256 projects only | same |
| `AGENTORY_API_URL` | — | its own public URL | same |
| `AGENTORY_API_FUNCTIONS` | — | which functions it dispatches to itself | same |
| `AGENTORY_API_ALLOWED_ORIGINS` | — | optional; default `*`, matching the Edge functions | same |
| `LEAD_V2_WORKER_WORKSPACES` | ✅ | ✅ | ignored (claims nothing) |
| provider/model keys | ✅ | ✅ | ✅ |

### Supabase Edge Function secrets

`AGENTORY_API_URL` and `AGENTORY_API_FUNCTIONS` must be set to the **same
values** as the Railway service once anything is migrated. Otherwise a function
still running on the Edge will hand off to the Edge copy of a function that has
moved, and two deployments will drive the same mission.

### Frontend build

| Variable | Meaning |
|---|---|
| `VITE_AGENTORY_API_URL` | Railway's public base. Unset ⇒ everything goes to Supabase. |
| `VITE_AGENTORY_API_FUNCTIONS` | Comma list or `*`. Unset ⇒ everything goes to Supabase. |

### `SUPABASE_JWT_SECRET` — read this before setting it

Supabase issues either HS256 (legacy shared secret) or **ES256/RS256**
(asymmetric signing keys, published at `/auth/v1/.well-known/jwks.json`). The
local stack issues ES256. The gate verifies HS256 with the secret, ES256/RS256
against the JWKS endpoint, and **defers rather than refuses** when the key
material is unavailable — in which case the handler's own `auth.getUser()`
remains the authority, exactly as on the Edge platform. Setting the secret on an
asymmetric project is harmless; leaving it unset is also safe.

---

## 4. Local development

```bash
supabase start                                            # local stack
bash scripts/local-supabase/start-local-api.sh            # api + worker on :8795
AGENTORY_ROLE=api bash scripts/local-supabase/start-local-api.sh   # api only
npm run dev -- --port 8082                                # frontend
```

`.env.development.local` carries `VITE_AGENTORY_API_URL` /
`VITE_AGENTORY_API_FUNCTIONS`; regenerate it with
`bash scripts/local-supabase/print-local-env.sh > .env.development.local`.
Emptying `VITE_AGENTORY_API_FUNCTIONS` sends the browser back to the edge
runtime without restarting anything but Vite.

The start script refuses any `SUPABASE_URL` that is not loopback.

---

## 5. Staged cutover

Each stage is one environment change, verifiable on its own, and reversible by
undoing that change. **Mount before pointing**: `AGENTORY_API_ROUTES` (what the
API serves) is deliberately separate from `AGENTORY_API_FUNCTIONS` (where
callers send work), so a route can be deployed and probed before it carries
traffic.

| Stage | Change | Verify | Rollback |
|---|---|---|---|
| 0 | Deploy the code. Nothing set. | `/health` 200; no `/api/*` route exists | redeploy previous image |
| 1 | `AGENTORY_ROLE=both`, `AGENTORY_API_ROUTES=*` | `/api/pilot-chat` with no bearer ⇒ 401; with a forged token ⇒ 401; `/health` still 200 | unset `AGENTORY_ROLE` |
| 2 | Railway: `AGENTORY_API_URL`, `AGENTORY_API_FUNCTIONS=pilot-chat`. Same on Edge secrets. | one real chat turn; compare against an Edge turn | empty `AGENTORY_API_FUNCTIONS` |
| 3 | Frontend build with `VITE_AGENTORY_API_*` set to `pilot-chat` | browser posts to `/api/pilot-chat`; cross-workspace id ⇒ 403 | rebuild without the variables |
| 4 | Add `orchestrate`, then `enqueue-lead-mission`, then `run-agent` — **one per stage**, both sides each time | a full Pilot → plan → mission run | remove that one name from the list |
| 5 | Steady state | error rates and mission completion match the Edge baseline | any stage above, independently |

**Rollback is always the same shape**: remove a name from
`AGENTORY_API_FUNCTIONS` (server) or `VITE_AGENTORY_API_FUNCTIONS` (browser).
Server-side that takes effect on the next request with no redeploy; the browser
needs a rebuild, which is why the browser moves *after* the server.

**Both sides must agree.** Do not set the browser variable for a function the
server-side variables have not already moved.

### Do not delete the Edge Functions

They stay deployed for as long as rollback is wanted — which is what makes every
stage above reversible. Deleting them is a separate decision, after Stage 5 has
held.

---

## 6. One service or two?

**Recommended: one service, `AGENTORY_ROLE=both`.** The two roles share a
container, a deploy and one set of secrets, and both are almost entirely waiting
on somebody else's network. A second service would double the secret surface
for no isolation that matters yet.

Split when API latency starts competing with mission execution, or when the two
need different scaling. That split is `AGENTORY_ROLE=api` on a new service and
`worker` on the existing one — an environment change, not a code change, which
is why the role is a variable at all.
