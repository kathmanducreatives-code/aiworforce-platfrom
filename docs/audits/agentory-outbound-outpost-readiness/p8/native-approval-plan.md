# Native changes requiring separate approval

**NOT APPLIED. P1–P8 disabled. Customer-pilot readiness FAIL.**

`proposed-storage.sql` is review-only SQL outside `supabase/migrations`. It creates
an inaccessible private scaffold, not a working persistence feature. No RLS,
ownership, transaction or process-crash claim follows from its presence. No local
or hosted SQL was executed. After approval, use `supabase migration new` to create
the actual migration; do not install this file directly.

## Security implications and prerequisites

1. Inventory the actual approved target catalog and grants, security-definer
   routines, views, triggers and effective policies. Baseline SQL is evidence of
   intended schema, not evidence of deployed state. Confirm all involved parent
   keys, role types, extensions and ledger attempt identities before final DDL.
2. RLS ORs permissive policies. Adding an owner policy does not narrow an existing
   membership policy. For Company Brain #147, either review replacement of all
   write policies or add a correctly scoped restrictive policy; preserve reads
   for legitimate members. Include current session/revocation checks. Coordinate
   this separately with the Brain owner; it is not in P8's applied code.
3. A private schema with no grants/policies denies every application role in this
   proposal, including service_role grants. FORCE RLS **does not constrain** a
   BYPASSRLS role or superuser. PostgreSQL owners/superusers can disable triggers.
   Keep the schema outside PostgREST's exposed schemas; do not expose owner keys.
4. The task-binding row must be registered only after P1 verifies the signed task,
   current membership/role, seller identity, client enrollment, native task
   workspace/actor/status and live session. An id-only task FK is insufficient.
   Lock both parent task and membership/authorization-epoch row. A native
   composite workspace/actor task ownership constraint is a separate migration
   decision after existing data preflight, not silently added by this scaffold.
5. Canonical TS bytes and JSONB presentation differ. Recompute hashes from the
   existing TS canonical contract; never use jsonb::text as a replacement. Test
   Unicode, number rendering, key order and nested arrays. Versioned V2 sorts
   facts; V1 must not be silently converted. Existing signed task payloads cannot
   be rewritten without a fresh explicit authorization/approval.
6. New private snapshots contain sensitive context/source copies. Apply existing
   encryption/backup/retention standards; avoid logging packet bodies or keys.
   Approval/CSV is not evidence verification, qualification or send consent.

## Transaction interface still to implement and approve

No writer RPC is shipped; do not grant direct INSERT as a shortcut. Prefer a
dedicated minimal writer with SECURITY INVOKER and a locked-down backend-only
connection role. If a SECURITY DEFINER wrapper is needed, it needs separate
review, fixed empty search_path, qualified relations, explicit EXECUTE revocation,
and no reliance on service_role, user_metadata or caller-supplied authorized=true.

The single review transaction must:

1. Authenticate the current JWT server-side, derive actor/session, require a live
   `auth.sessions` row and validate current member role + authorization epoch.
   Session existence alone does not prove all refresh-token revocation cases;
   define and test the sign-out/revocation contract. No JWT/user_metadata client
   selector is authorization. Recheck under the same transaction as the write.
2. Lock enrollment/role/session fence and task rows in deterministic order, then
   verify original P1 signature, ownership, task status, model/review policy,
   source/packet/draft identities, latest event head and exact approval expiry.
   Role/session revoke paths must take compatible locks/epoch increments.
3. Lock global operation identity; exact request returns first durable receipt;
   conflicting task set/body refuses. Lock every batch task before appending any
   event. Unique sequence alone cannot prove chain ancestry or legal transitions.
4. Validate revision/approval/source references through P5/P6/P7, recompute hashes,
   use trusted database time, insert events and operation receipt in one commit.
   Never release CSV before commit and post-commit current authorization check.
   Retry/rollback/crash must not produce partial batches or revive stale approvals.
5. Serialize snapshot insert-once and initial briefing acceptance. Reuse the
   existing model ledger, attempt ceilings, purchase reservations and fencing.
   Store accepted output and usage settlement/recovery identity atomically or use
   a proven existing recovery receipt. Do not create a second financial ledger.
   Pending/uncertain spend remains held; losing output is not permission to rebuy.

Legacy containment also needs separate approved integration: detect enrolled
pilot workspace/task **before** any run-agent/orchestrate/worker resume, provider
purchase or shared-memory loading. Pilot-bound work must use its signed P1 route
or refuse. Test direct user, verified service, plan kickoff, continuation,
checkpoint, cron and repair entry points. Do not globally break service jobs or
mistake existing membership authorization for pilot authorization.

## Native acceptance plan (NOT RUN)

Run only after SQL/test-database approval, against disposable PostgreSQL+PostgREST:

| Test | Required result |
| --- | --- |
| anon, ordinary authenticated, member/viewer, shared admin direct API | No private writes/foreign reads; declared owner workflows only via authorized interface |
| public Brain member write + every permissive policy/view/RPC | Role-aware protection cannot be bypassed through another writer |
| B actor/source/packet on A task, same Apollo IDs | Composite constraint/transaction refuses before content/ledger release |
| public task workspace/owner reassignment | Native containment refuses or permanently invalidates existing binding |
| expired/revoked/deleted session, stale JWT, demoted role | Next read/write/export refuses, including service execution for revoked initiator |
| two connections editing same head | One legal version; loser gets conflict, never overwritten revision |
| identical ops on parallel connections/restart | Same durable event/time/CSV; one global operation |
| same op different request or task sets | Conflict; zero partial append |
| two-task export with one stale row | Entire transaction rolls back; no CSV released |
| crash before commit/after commit before acknowledgement | No partial data; exact durable retry or explicit held recovery |
| model reservation/dispatch/usage/output crash at every boundary | <=4 shared attempts; <=$0.05 model/$0.20 provider/$0.25 total; no rebuy on uncertain outcome |
| JSONB roundtrip of V2 + old V1 and tampered sources | V2 exact replay; old/tampered incompatible state fails closed |
| UPDATE/DELETE/TRUNCATE, grants/default grants, owner/BYPASSRLS | App roles cannot mutate history; privileged exceptions explicitly documented |
| combined browser workflow with real JWT/native storage | Import ownership -> snapshot -> selected mocked model -> exact approval -> CSV; no cross-client cache |

Native tests must use independent DB connections and actual role/JWT/PostgREST;
a Map, mock, SQL source scan or green existing db-contract suite is insufficient.

## Rollback

Before any grant/enablement: leave feature flags false; roll back the DDL in its
transaction if it fails. This scaffold changes no existing public table/policy.
For an installed empty scaffold, separately approved rollback can drop these six
tables in reverse FK order, then the trigger function/schema. Confirm emptiness
and dependencies first; never use CASCADE blindly.

After any real records: disable entry points/revoke writer grants, hold pending
spend, stop workers through existing controls, export an encrypted audit backup
and reconcile receipts. **Do not drop immutable history or restore a stale
approved state.** Retention/deletion requires an approved audited procedure. Any
future public-policy/ownership migration needs its exact reverse SQL and data
preflight in its own review; this proposal cannot promise rollback for it.
