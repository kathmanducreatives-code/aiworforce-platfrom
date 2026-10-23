# Native pilot identity foundation — not customer acceptance

```sh
tests/outpost-native/run.sh
OUTPOST_NATIVE_OMIT_OWNER_GUARD=1 tests/outpost-native/run.sh  # must fail 2 targeted contracts
OUTPOST_NATIVE_PUBLIC_AUDIT=1 tests/outpost-native/run.sh     # known public-policy blocker: currently FAIL/exit 1
```

Requires Docker, psql, Deno and PostgREST. `POSTGREST_BIN` can select the installed
binary. CI pins PostgreSQL 17.6, PostgREST 12.2.3/SHA256 and Deno 2.8.2. Local
receipt used PostgREST 16.4. The existing 12-vs-16 query-quirk contract is not
changed. No Supabase CLI deployment, external database URL or real API key used.

The runner ALWAYS creates and deletes its own labeled PostgreSQL container,
bound only on a random loopback port. It never uses the user's existing Supabase
stack or a supplied `PG_ADMIN_URL`. It builds the repository's real baseline and
held DB-contract prerequisites, then applies the new held migration **only to
that fresh disposable database**. Trap cleanup stops only its PostgREST PID and
container ID. A second concurrent run has its own cluster, roles, credentials,
ports and data. Deno runtime network permissions allow only loopback.

These are actual PostgreSQL RLS/grants/FKs/triggers/locks and real PostgREST JWT
signature/direct-API tests. P1's actual `PilotAccess` and Supabase query store sign
and verify tasks against native data. No mocked SQL/RLS/provider behavior.

Platform fixture limitation: the baseline shim has no GoTrue. We create only the
`auth.sessions(id,user_id,not_after)` columns needed by the migration and mint
synthetic JWTs with the per-run secret. This proves DB predicates over current
session rows, not actual GoTrue logout/refresh/browser session behavior. That
remains a separate integration gate. Do not install the fixture SQL anywhere.

PostgREST deliberately exposes `outpost_private` IN THIS TEST ONLY to prove RLS
survives that configuration mistake. Hosted configuration must not expose it.
Native predicate functions are narrowly scoped boolean SECURITY DEFINER helpers
with empty search_path and explicit EXECUTE grants. App roles cannot read the
managed session catalog or register/modify pilot identities. No writer, model,
approval or export RPC exists. Customer enablement is constrained false.

The immutable-owner mutation removes only the explicitly marked guard block
from a temporary SQL copy. Source migration is untouched. Empty rollback/reapply
is ignored for that mutant only, since it would reintroduce the removed guard;
the real migration runs all 42 tests. Both targeted owner/registration race tests
must fail for the mutant; failures for unrelated setup/type errors are not proof.

The separate `public-task-audit.ts` intentionally exits 1 until a coordinated
public-table permission gap closes: an authorized viewer cannot read private
bindings but can read the legacy public task payload. CI exposes its failed step
and log with `continue-on-error`; the **identity foundation** job can pass while
the customer readiness gate stays FAIL. It is not silently counted as a passing
security test and must become a required acceptance proof before enablement.

Rollback SQL is in the production-readiness report. The suite proves empty-only
rollback/reapply and refusal when identity records exist. No mutable audit data
is purged except destruction of the wholly disposable test cluster.

## Phase 1 extensions (still not customer acceptance)

- `OUTPOST_NATIVE_AUTH=1 tests/outpost-native/run.sh` starts a separately owned,
  digest-pinned GoTrue v2.197.0 container and uses its real migrations, issued
  sessions/JWTs, refresh and logout. It does **not** install the synthetic
  auth.sessions fixture in this mode. Tests assert the owner/session exists before
  registration instead of manufacturing missing GoTrue rows. Four behavioral
  tests plus harness cleanup verify the private predicate. This is not a full
  application/session/permission PASS while public paths remain open.
- GoTrue connects only to the fresh owned database on its own Docker network;
  host APIs bind loopback. Auto-confirm/no-op mail, phone/provider integrations
  disabled, no paid keys or customer data. Its local DB migration connection is
  privileged for disposable setup; that does not prove production migration-role
  privileges. The bridge is not an outbound network firewall; no paid/provider
  client is loaded. Full egress containment remains a later integration gate.
- `OUTPOST_NATIVE_SURFACE_AUDIT=1 tests/outpost-native/run.sh` emits real catalog
  policies/constraints/grants and synthetic direct-API probes. Current exit **1**
  proves task SELECT/PATCH, foreign membership self-insert and Brain PATCH defects.
  Positive owner controls prevent an unavailable/deny-all API from counting as a
  fix. Catalog function source matching is a candidate inventory, not proof of
  complete dynamic-SQL/Edge containment.
- New RLS scanner adversaries live in `tests/infra/rlsRelations.test.ts`; qualified
  schema names remain distinct, and missing RLS in public or private still fails.

No shared schema/policy correction or multi-client support is implied by these
extensions. See the current Phase 1 receipt and client contract under
`docs/audits/agentory-outbound-outpost-readiness/production-readiness/phase-1/`.
- `OUTPOST_NATIVE_CONTEXT_AUDIT=1 tests/outpost-native/run.sh` runs actual
  `handlePilotContext` with real GoTrue authentication and native P1 store, adapting
  only the local gateway URL. Current expected exit 1: a different login session
  for the original actor resumes successfully (200), even though private native
  binding RLS denies it. Revoked original session is 401, foreign workspace 403.
  Successful denial must be an explicit authorization status, not arbitrary 5xx.
