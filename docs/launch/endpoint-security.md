# Endpoint security — launch hardening (Phase 1)

Every Supabase edge function, classified by what it IS, and the protection that
fits it. "Tested" names the suite that attacks it. Nothing here is deployed
until Phase 9; statuses are IMPLEMENTED/TESTED unless stated.

Classes:
- **USER** — a signed-in user; workspace derived server-side or checked by membership.
- **INTERNAL** — service-role bearer only; unusable with the public anon key.
- **PUBLIC** — no private data, no privileged mutation, no paid spend (or verified against stored state).
- **RETIRED** — answers 410, touches nothing.

| Function | Class | Protection | Change | Tested by |
|---|---|---|---|---|
| approve-and-continue | USER | JWT → approval loaded server-side → workspace from the approval → membership + role → conditional settle (pending only) | **FIXED** (was: no auth at all) | approveAndContinueAuthorization (17) |
| continue-workflow | USER | JWT + membership; refuses a service key | — | existing suite |
| daily-brief | USER | JWT + membership | — | existing |
| email-tracking | PUBLIC (beacon) | id must be an existing email; a click redirects only to a link in that email | **FIXED** (was: open redirect, unauthenticated writes) | endpointSecuritySweep |
| enqueue-lead-mission | INTERNAL | `isServiceRoleBearer` (verified with Supabase Auth) | — | existing |
| firecrawl-scrape | USER | JWT + membership + daily caps (25/workspace, 15/user, from the ledger) + 1 credit reserved with enforcement always on | **FIXED** (was: any signed-in user, unlimited) | endpointSecuritySweep |
| generate-company-brain-draft | USER | JWT + membership | — | existing |
| generate-content-image | USER | JWT + membership | — | existing |
| google-calendar-auth | USER | JWT | **FIXED** (was: open OAuth-secret proxy; refresh always threw) | endpointSecuritySweep |
| google-calendar-events | USER | JWT; the caller's own tokens only | — | — |
| integration-readiness | USER | JWT; writes only for members | — | — |
| job-feed | RETIRED | 410 | **FIXED** (was: any user's jobs to anyone) | endpointSecuritySweep |
| mcp | USER (OAuth) | user JWT through the publishable key; RLS scopes every read | — | isolation suite (RLS) |
| orchestrate | USER | JWT + membership + Start idempotency + workspace USD ceiling | — | existing |
| pilot-chat | USER | JWT + membership | — | existing |
| resume-stalled-leads | INTERNAL | service key (cron) | — | existing |
| run-agent | USER / INTERNAL | service bearer, or JWT + membership (`decideWorkspaceAccess`) | — | existing |
| run-lead-action | USER / INTERNAL | `decideWorkspaceAccess` | — | existing |
| run-monitoring-scan | USER | JWT + membership | — | existing |
| run-monitoring-tick | INTERNAL | service key (cron) | — | existing |
| run-radar-scan | USER | JWT + membership | — | existing |
| send-scheduled-emails | USER | JWT; sends and updates only `user_id = caller` | **FIXED** (was: anyone could send every user's mail) | endpointSecuritySweep |
| setup-company-brain | USER | JWT + membership | — | existing |
| tool-availability | USER | JWT | **FIXED** (was: provider config to anonymous callers) | endpointSecuritySweep |
| unlock-founders | USER | JWT + membership + credits | — | existing |

No inbound provider webhook exists today, so there is no VERIFIED_WEBHOOK.

## Database functions (RPC)

| Function | Before | After (migration 20260929120000) |
|---|---|---|
| credits_grant / credits_reserve / credits_finalize / credits_release_stale | SECURITY DEFINER, **executable by anon** — mint or drain any workspace's credits | service_role only |
| monitoring_spend_in_period, seed_agents_for_workspace, dev_table_counts | SECURITY DEFINER, executable by anon | service_role only |
| provision_workspace_for_user | anyone could provision for / learn the workspace of any user | caller must be that user (or service) |
| get_room_member_profiles | anyone could list any room's member names | caller must be a room member |
| lead-queue RPCs (claim/bind/heartbeat/release/cancel/renew) | already service-only | unchanged |
| policy helpers (has_workspace_access, is_org_member, …) | must stay callable (RLS uses them) | unchanged |

Migration 20260929130000 also revokes anon INSERT/UPDATE/DELETE/TRUNCATE on all
workspace-scoped tables, and TRUNCATE for both browser roles on all tables.

## Legacy n8n pages

Retired from routing (redirects) and from the bundle (0 `n8n.prasidha.me` in `dist/`).
**Still open, needs owner access:** the n8n workflows themselves remain live for
anyone holding an old bundle's URLs. Deactivate them, or add webhook auth, on
`n8n.prasidha.me`: `icp-lookalike-engine`, `behavioral-screening`,
`competitor-post-interceptor`, `advanced-firecrawl-search`, and webhook ids
`21eba91f-…`, `4406aa6a-…`, `4e7f4a2b-…`.

## Verification

- Two-workspace isolation: `scripts/security/run-isolation-suite.sh` (throwaway local stack, real JWTs, 47 tables × 5 attacks × both directions + RPCs).
- Production RLS/grants: `scripts/security/verify-rls.sh '<prod db url>' --strict` (READ ONLY). **Not yet run against production — needs a connection string.**
