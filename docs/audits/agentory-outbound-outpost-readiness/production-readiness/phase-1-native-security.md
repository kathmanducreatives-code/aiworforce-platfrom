# Phase 1 slice — native identity security

**Private identity foundation: PASS locally. Whole Phase 1/customer readiness:
FAIL. P1–P8 disabled; A7 NO-GO.** No hosted SQL, deployment, merge, paid call,
customer data, outreach or shared worker/Brain implementation change.

## What was fixed

Held migration `supabase/migrations-held/20261022140824_outpost_native_identity_security.sql`
was generated with the CLI, then moved out of the active migration runner. Local
application is now explicitly authorized by the user's production-hardening
request; hosted application is not authorized. It supersedes only the identity
portion of P8's **unapplied** SQL sketch. Do not apply both sketches/migrations.

1. Private `clients`: one immutable client per workspace, unique client binding,
   same-workspace composite parent key, constrained `customer_enabled=false`.
2. Private `task_bindings`: immutable original actor/session, composite client/
   workspace FK and same-client task key; capture the real native parent image,
   membership and session under shared locks. No record can register a different
   task workspace, client, actor, signed-scope metadata or foreign session.
3. Current RLS reads require the existing `workspace_members` owner/admin role,
   authenticated verified JWT subject, live same-user session, unexpired token
   and session deadline. Original-task reads require the original session and
   exact current parent image. Shared admins do not inherit another actor's task.
   User/app metadata cannot confer native membership. Repeatable Read fails
   closed rather than retaining old authorization snapshots.
4. Direct writes, registration/model/approval/export RPCs and service-role
   private access are denied. Private RLS is enabled/forced; effective grants and
   default privileges are tested. SECURITY DEFINER helpers return booleans only,
   use qualified relations/empty search_path, and revoke default EXECUTE.
5. New narrow native trigger on `public.tasks` refuses workspace/actor changes
   only after a private pilot binding exists. Normal non-pilot updates and
   legitimate service-role updates keep working. No executor or worker is added.
   The DB contract was posted to backend #150 **before** implementation; owner
   acceptance remains required before integration. No owner approval is assumed.

P1 HMAC verification remains mandatory before any future trusted registration
adapter. The SQL validates the captured scope/parent but intentionally does not
implement another signature verifier or keep a signing secret. No application
principal currently gets INSERT, and no registration adapter exists in this slice.
These tables do not persist leads, packets, model receipts or review decisions.

## Verified defect and correction

The first native run: **37 passed, 1 failed**. `tasks` ownership could change A→B→A
without changing the captured task image. Relying on `updated_at`, a payload hash
or snapshot equality alone allowed access to revive. No hosted exploit tested.

The scoped owner trigger prevents the initial reassignment; capture's parent
lock also serializes concurrent changes. Removing just that trigger/function
block produces **39 passed, 2 failed, 1 ignored** (rollback reapply intentionally
not run on the mutant): the immutable-owner and registration/concurrency tests
fail. The actual migration passes all **42/0**. P1 signs/verifies through the real
query store/native PostgREST before each binding is registered in the fixture.

## Native proof matrix

| Proof | Result | Practical scope |
| --- | --- | --- |
| owner positive controls / foreign rows / overlapping external IDs | PASS | actual PostgREST + RLS, private identity tables |
| anon/service/viewer/shared-admin private task access | PASS | denies unauthorized task authority; shared admin may select authorized workspace metadata |
| direct POST/PATCH/DELETE, missing model/export/approval RPCs | PASS | no application write/execute path |
| signed tokens with missing/foreign/malformed/replaced session, expiry, anonymous flag, forged metadata | PASS | DB predicate + real PostgREST signature checks |
| role removal/demotion, deleted/expired session, cancellation, payload change | PASS | next native read refuses; no silent resume or context repair |
| two clients racing for one workspace | PASS | one unique enrollment wins; second client refused |
| wrong workspace/client/actor/session or unsigned parent | PASS | native parent constraints and original P1 verifier |
| independent composite FK with inconsistent trusted enrollment | PASS | FK refuses even matching signed claim metadata |
| ownership restore and concurrent registration | PASS after fix | immutable bound owner; not a worker recovery proof |
| open Read Committed transaction sees revocation from another connection | PASS | actual separate native connections |
| old Repeatable Read snapshot | PASS (denied) | supported transaction policy must remain Read Committed |
| immutable UPDATE/DELETE/TRUNCATE / future grants | PASS | app roles cannot mutate identity; privileged owner exceptions documented |
| empty rollback/reapply; populated rollback refusal | PASS | native DDL in disposable cluster only |
| **legacy public task direct API** | **FAIL** | viewer receives task payload despite private binding denial; explicit owner handoff |
| real GoTrue logout/refresh/browser sessions | NOT TESTED | platform session rows/JWT minting are synthetic fixtures |
| native packet/review/approval/financial durability | NOT IMPLEMENTED here | separate persistence and backend-ledger contracts |

### Remaining direct-API bypass — reproducible, not hidden

```sh
OUTPOST_NATIVE_PUBLIC_AUDIT=1 tests/outpost-native/run.sh
# expected current exit status: 1
```

Actual result from native PostgreSQL 17.6/PostgREST 16.4:

```json
{
  "gate": "public_pilot_task_direct_api",
  "expected": "viewer denied bound pilot task",
  "actual_http": 200,
  "visible_rows": 1,
  "private_metadata_visible": 0,
  "verdict": "FAIL",
  "customer_pilot_ready": false
}
```

The baseline's existing public membership policies still expose the bound task
payload to a viewer. Service-backed legacy handlers can also bypass private RLS
through their existing public-table access. Private metadata isolation alone is
not end-to-end client isolation. This is handed to #147/#150 owners with the
native probe. A coordinated restrictive pilot policy/handler guard must consider
every permissive policy, direct public writes and service routes; this slice
does not independently replace shared workspace/Brain permission policies.

CI's dedicated job explicitly says **identity foundation, not pilot acceptance**.
It runs this public-readiness probe separately with a visible nonblocking failed
step and retained log. All 42 private-foundation cases pass, but that failure is
a mandatory readiness blocker; it must become a required acceptance gate after
the owner fix. A green foundation job is not a green customer-pilot verdict.

## Rollback / security implications / limits

[Empty-only rollback SQL](native-security-rollback.sql) takes bounded locks, checks
both tables are empty, removes only the new task trigger/private objects, and
leaves managed auth/public task data intact. Native tests prove it refuses
populated state. Never drop real identity history or use CASCADE as recovery.
The active migration directory is unchanged. The held migration is not added to
the shared baseline/bootstrap or deployed to any project.

Only this new test's labeled PostgreSQL container is used/deleted; the user's
existing local Supabase stack is untouched. The runner does not accept a hosted
URL. The private schema is intentionally exposed **only in the test** to prove
RLS even with that misconfiguration. Keep it outside hosted exposed schemas.

PostgreSQL superusers/owners can disable guards and BYPASSRLS remains privileged;
do not expose their credentials. SECURITY DEFINER ownership, grants, auth catalog
columns and effective production policies require native target preflight before
any hosted approval. The fixture is not GoTrue. Actual sign-out, refresh,
revocation epoch and multi-tab behavior still need the Brain/backend contract.

Whole-parent equality is deliberately conservative: changing task content/state
invalidates native access rather than authorizing a different context. Future
pilot task lifecycle/persistence adapters must agree these version rules before
writing generic task bookkeeping. No automatic rebinding or session substitution.

## Phase status and next work

- Phase 0: PASS, exact stack/overlaps/dependency graph and checklist committed.
- Phase 1: identity foundation passes; full security FAIL on existing public
  task/artifact RLS and owner session/Brain permissions. Handoffs are posted.
- Phase 2: separate persistence PR after agreed original-task/session/write
  contract. Extend this schema, not the older unapplied P8 SQL sketch. Persist
  V2 packets/briefs/revisions/approvals/operations atomically, with native crash
  and multi-connection proofs. No pilot ledger.
- Phases 3–4: separate owner-coordinated containment and existing-ledger durable
  model replay/output acceptance (#145/#149/#150 dependencies). No shared code
  modification or competing execution/accounting system in this slice.
- Phases 5–6: native import-to-CSV browser workflow, exact combined integration
  and hosted TEST proposal only after previous local gates pass. Not claimed here.

Local disposable SQL/tests were authorized and performed. Required next review:
security draft/held SQL and scoped task-trigger contract by owners, then explicit
handoff for shared permissions/execution/ledger changes. Hosted SQL, migrations,
merge/deploy, paid calls or real customer operations still need separate approval.
