# Held migrations — NOT applied, and never to be applied to production as-is

These files are kept out of `supabase/migrations/` on purpose. That directory
is synced to the production-connected repository (Lovable builds from its
`main`), and nothing here may be picked up and run against the live project
(`ohsdatpvfdjdemstoiuj`) by any tool.

Migrations are applied to production one at a time, deliberately — see
`docs/SUPABASE_TARGETING.md`.

## `20260816120000_baseline_schema.sql`

The schema baseline: a `pg_dump` of the live schema taken 2026-08-16 (111
tables, 271 policies). It is what a **fresh, empty** database needs, and it is
correct for that.

It must never run against production. Production already has this schema, and
later hardening migrations dropped permissive policies and revoked grants that
this dump still contains — replaying it could quietly restore them.

To build a fresh database (local or a new project), apply this file first, then
everything in `supabase/migrations/` in order.

## `20260910140000_lead_mission_v2_claim.sql`

The LeadMission V2 queue: `lead_mission_queue`, the atomic claim, the heartbeat
that renews what a run holds, bind/release/cancel, and `renew_lineage_lease`.

**Not approved for production.** LeadMission V2 is disabled (the
`LEAD_V2_WORKER_WORKSPACES` allowlist is empty) and this migration has never
been reviewed for the live project. `enqueue-lead-mission` and
`resume-stalled-leads` reference `lead_mission_queue`; both tolerate its
absence.

To enable V2: review this file, apply it to production deliberately, move it
back into `supabase/migrations/`, then follow the enablement steps (allowlist a
single internal workspace, deploy the worker, add the orchestrate diversion).

## `20260912160000_content_format_model.sql`

Generated columns `content_item.platform` and `content_item.content_format`,
derived from `metadata` (where Scribe's writer records the format it chose),
with CHECKs on their values and the post-vs-reply coherence rule.

**Additive and safe, but not yet applied.** No code writes these columns, so
the Content format model works identically with or without them; applying
this only adds queryable, constraint-checked columns. Apply it deliberately,
then move it back into `supabase/migrations/`.

## `20260915120000_sweep_skips_v2_queue_tasks.sql`

Lead V2 P0. Redefines `tasks_sweep_stuck_runs` so it never flips a task an
active `lead_mission_queue` row owns (`queued`/`running`/`resumable`) from
`running` to `ready` — the queue recovers those through its own lease expiry.
Nothing else in the function changes.

**Depends on `20260910140000_lead_mission_v2_claim.sql`** (the table it reads).
Apply only after that one, deliberately. Until then the live sweeper is
unchanged; the V2 heartbeat keeps `tasks.updated_at` fresh, which is what keeps
a live V2 run out of the sweeper today.

## `20261003120000_lead_mission_v2_continuations_not_retries.sql`

Lead V2: a clean continuation slice no longer spends a queue retry. Adds
`lead_mission_queue.continuations` (default 0; no row rewritten), gives
`release_lead_mission` a defaulted `p_lineage_slices` argument that refunds the
claim when the lineage's own slice counter moved, and adds a 25-slice backstop
to claim and release. Retries stay capped at 5 and keep counting errors,
aborts, crashes, lease expiries and runs that complete no slice. Canary
53784493 was stopped before page 3 by five clean slices spending the 5 retries.

**Depends on `20260910140000_lead_mission_v2_claim.sql`.** Either deploy order
works: an old worker against the new function gets the old behaviour (no slice
count, no refund); a new worker against the old function falls back to the
4-argument call. Rollback, verbatim to the original functions:
`rollback/20261003120000_lead_mission_v2_continuations_not_retries.down.sql`.
Replayed against real Postgres (PGlite) in
`tests/infra/leadMissionV2ContinuationsNotRetries.test.ts`.

## `20261011120000_lead_mission_v2_productive_continuation_no_backoff.sql`

Lead V2: a PRODUCTIVE continuation is released with no backoff. Redefines
`release_lead_mission` (same signature) so `not_before` is cleared — instead
of `now() + 2 minutes` — only when the lineage's slice counter moved (the
claim-refund test of 20261003120000) AND the worker states the run's own
continuation decision was immediate (`p_outcome->>'dispatch' = 'immediate'`).
Retries, no-op runs, runs waiting on a provider (`awaiting_provider_run`) and
unknown decisions keep the 2-minute hold. Query B rerun 255c333f spent 1,054 s
(36% of 48.2 min) in that hold between clean slices.

**HELD — NOT APPLIED, and not approved for production.** Depends on
`20260910140000` and `20261003120000`. Either deploy order is safe: an old
worker states no `dispatch` (hold kept); a new worker against a database
without this migration has its `dispatch` key stored in `last_outcome` and
ignored (hold kept). Rollback, verbatim to 20261003120000's function:
`rollback/20261011120000_lead_mission_v2_productive_continuation_no_backoff.down.sql`.
Replayed against real Postgres (PGlite) in
`tests/infra/leadMissionV2ProductiveContinuationNoBackoff.test.ts`.

## `20261019120000_lead_mission_v2_exhausted_lease_terminal.sql`

Lead V2: a mission whose FINAL lease lapses is ended, not stranded. Redefines
`claim_next_lead_mission` (same signature) as 20261003120000's function plus one
step: before selecting, every `running` row with a lapsed lease and no retry
(`attempts >= 5`) or slice (`continuations >= 25`) left is set `failed`, with
`last_outcome.lease_lapsed = true` and its reason. Before this, a worker that
died holding the fifth claim left the queue row, task and lineage `running` for
ever (the claim requires `attempts < 5`; the stuck-run sweeper skips a task an
active queue row owns). No attempt is granted, nothing is refunded, and provider
liabilities are untouched. The worker's idle sweep
(`leadMissionCancellation.ts` `sweepLapsedMissions`) then ends the task, lineage
and plan with the release's own reconciliation, visiting only rows this function
marked.

**HELD — NOT APPLIED, and not approved for production or the test project.**
Depends on the queue chain (20260910140000, 20260915120000, 20261003120000,
20261011120000). Either deploy order is safe. Rollback, verbatim to
20261003120000's function:
`rollback/20261019120000_lead_mission_v2_exhausted_lease_terminal.down.sql`.
Tested against real Postgres + PostgREST in
`tests/db-contract/leadMissionExhaustedLease.contract.test.ts` (unit:
`tests/edge-functions/_shared/leadMissionLapsedLease.test.ts`).

## `20261025120000_lead_graph_same_workspace_parents.sql`

**OWN-01. Not approved for any hosted project.** Every parent reference in the
Lead Discovery graph (26 foreign keys into `accounts`, `contacts`,
`lead_candidates`, `lead_evidence` and `signals`) becomes a composite key on
`(workspace_id, <col>)` → parent `(workspace_id, id)`, so a row can only point
at a parent in its own workspace, whoever writes it. Before it, a member who
could not read another workspace's account could still store a contact under
it (201; #173's native reproduction). Constraint names, optional parents,
`SET NULL` (now `SET NULL (<col>)`) and `CASCADE` are preserved, so PostgREST
embeds and hints are unchanged. The migration counts existing mismatches first
and **aborts without changing anything** if there are any; it never reassigns a
parent. Run `scripts/test-project/own01-parent-preflight.sql` (read-only) on the
target first. Needs PostgreSQL 15+. Independent of every other held migration.
`tests/db-contract/leadGraphSameWorkspaceParents.contract.test.ts` proves the
behaviour; `tests/db-contract/mutation.sh` proves it fails without the
migration, with plain `SET NULL`, with a reference left out, and without the
preflight abort. Rollback (restores the ID-only keys under the same names):
`rollback/20261025120000_lead_graph_same_workspace_parents.down.sql`.
## `20261025130000_tasks_commit_boundary.sql`

**Not approved for any hosted project.** The database half of #179's
pre-effect guard. For the application roles (every PostgREST writer), a task
is authorized in the transaction that writes it:
- its plan (`plan_id`, `task_plan_id`) must exist in the task's workspace;
- a new task's principal must be a current member, read under a `FOR KEY SHARE`
  lock, so a concurrent membership `DELETE` either commits first (the task is
  refused) or waits for the task's transaction.

This closes Codex's EXEC-PLAN and EXEC-REVOKE findings. Codex's own
reproduction passes unchanged. Status and result writes do not fire it, so
authorized work keeps settling. Administrative SQL (role `postgres`) is not
checked. Independent of every other held migration.
`tests/db-contract/taskCommitBoundary.contract.test.ts` proves it, including
the two-session race; `mutation.sh` proves it fails without the migration,
without the lock, and without the plan-workspace comparison. Rollback:
`rollback/20261025130000_tasks_commit_boundary.down.sql` (round trip verified: rolled back equals never applied, privileges included). Before applying on a hosted project, run `scripts/test-project/tasks-commit-boundary-preflight.sql` (read-only); it must end in `OK`.


## `20261025150000_task_plans_parent_identity.sql`

**Not approved for any hosted project.** This is the parent side of `20261025130000` and closes Codex's PLAN-PARENT finding. For application roles:
- a plan's `id` and `workspace_id` are fixed once it exists (`42501`). No application code changes them; every writer updates status only.
- a deleted plan's id cannot be re-created in another workspace while tasks still point at it (`23503`). `tasks.plan_id` has no foreign key, so it can outlive its plan.

A plan is never moved, so a task is never left under a foreign plan or silently re-homed. Status writes, new plans and administrative SQL are unchanged.

- **Proof:** `tests/db-contract/taskPlanParentIdentity.contract.test.ts`. Codex's `task-parent-membership-audit.test.ts` PLAN-PARENT case passes unchanged. `mutation.sh` covers it with the migration omitted, the workspace comparison removed and the re-creation check removed.
- **Rollback:** `rollback/20261025150000_task_plans_parent_identity.down.sql`.
## `20261015120000_provider_purchase_claims.sql`

**PROPOSED — NOT APPLIED, NOT WIRED, NOT APPROVED.** One buyer per provider-call
idempotency key, decided in the database before the start POST, under D1's
generation token (`tasks.checkpoint_version`). Closes the one purchase race
nothing else covers: a stalled worker and the worker that reclaimed its mission
both POSTing the same Actor run (the execution ledger's key index is not
unique, and `credits_reserve` replays a repeated key). See
`docs/launch/lead-v2-reliability-proposals.md` §1 for the wiring, which is a
separate change. Additive and service-role only; a database without it answers
PGRST202 and every caller keeps today's behaviour. Rollback:
`rollback/20261015120000_provider_purchase_claims.down.sql`. Replayed against
real Postgres (PGlite) in `tests/infra/providerPurchaseClaims.test.ts`.

## Tests

`tests/infra/` still reads these files — the baseline's structure, the V2
queue's invariants, RLS coverage and schema drift all keep their guarantees.
Holding a file changes where it lives, not what it must satisfy.

## `20261015130000_credits_rearm_settled_key.sql`

Billing. `credits_reserve` replayed a key whose reservation had been
**refunded**, either settled `not_charged` (the call did not start) or
`released` by the stale reaper. A later attempt under that key was allowed
with no balance check, and settling it charged 0, so a real purchase went
uncharged.

This migration **re-arms** such a key in place: the same conditional debit as
a new reservation, the row locked first so concurrent attempts re-arm once,
and the reaper's 30-minute window counted from the re-arm (`rearmed_at`,
`rearm_count`, both additive). A key that is `reserved`, `charged`, `partial`
or `granted` is still a replay. `credits_finalize` is untouched.

**Not approved for any hosted project.** It needs billing sign-off. Applied
only by `tests/db-contract/bootstrap.sh` to the lane's throwaway database.
`tests/db-contract/creditRearm.contract.test.ts` proves the behaviour, and
`tests/db-contract/mutation.sh` proves those tests fail without it. It is
independent of the Lead V2 queue chain and of `20261015120000` (purchase
claims, concurrency): either can be applied without the others.

Rollback, verbatim to the baseline functions:
`rollback/20261015130000_credits_rearm_settled_key.down.sql`.

## `20261015140000_discovery_smoke_admission.sql`

Durable admission for **one** controlled Discovery smoke mission (at most
$0.25: $0.20 provider + $0.05 model). Derived from Codex's proposal on
`codex/smoke-durable-admission-proposal`; the changes from it are listed in
`docs/launch/discovery-smoke-admission.md`.

Two tables (`discovery_smoke_authorizations`, one per queue row, and
`discovery_smoke_operations`, one per admitted transport) and four RPCs:
`authorize_discovery_smoke` (administrators only; never granted to
`service_role`), `admit_discovery_smoke` (the only way the worker gets
permission for a billable request), `record_discovery_smoke_receipt` (run ids
and reported charges, immutable) and `stop_discovery_smoke` (one-way). The
worker can read both tables and nothing else: it cannot create, widen, reset
or extend an authorization. Nothing is refunded.

**Not approved for any hosted project.** Depends on the held Lead V2 chain.
Applied only by `tests/db-contract/bootstrap.sh` to the lane's throwaway
database, and, opt-in, by `scripts/test-project/build-test-schema.sh
--with-held-admission` to a new non-production project.
`tests/db-contract/smokeAdmission.contract.test.ts` proves the behaviour and
`tests/db-contract/mutation.sh` proves those tests fail without it. Inert until
a worker runs with `DISCOVERY_SMOKE_ADMISSION` enforced (it is unset by
default).

Rollback (refuses while any authorization or operation row exists):
`rollback/20261015140000_discovery_smoke_admission.down.sql`.

## `20261024160000_client_company_brain.sql`

Company Brain **Phase 3c**: canonical client accounts, append-only client
access grants (generations), one Company Brain per client, and a
`permission_revision` on every membership (one global sequence, renewed on
each role change and each new membership). Writes go only through the
service-role SECURITY DEFINER functions in the file, which re-authorize under
the lock order session → membership → client → grant → data. The agency Brain
(`company_brain`) and its writers are untouched.

**Not approved.** It implements the contract proposed in #174
(`docs/plans/company-brain/CLIENT_BRAIN_CONTRACT.md`); O3 (the membership
writer) needs Backend's confirmation and the whole contract needs owner
approval before this moves to `supabase/migrations/`. Applied only by
`tests/db-contract/bootstrap.sh` to the lane's throwaway database.
`tests/db-contract/clientCompanyBrain.contract.test.ts` proves the behaviour;
`tests/db-contract/mutation.sh` proves those tests fail without its locks and
rules. Nothing reads or writes these tables yet outside tests and the
switched-off `_shared/clientBrain.ts`.

Rollback: the statements listed in the file's header (drops only the new
objects and the new column).

## `20261025140000_workspace_member_writers.sql`

**Backend. Not approved for any hosted project; needs #176 and approval of the #174 contract first.** These are the canonical membership writers from contract §8 O3 option A and §9.4: `workspace_member_remove(ws, target, actor, session)` and `workspace_member_set_role(ws, target, role, actor, session)`. Both are service-role only and return an outcome. Any refusal changes nothing.

- **Lock order (§5):** the actor's session (L1, `FOR SHARE`), then the actor, the target and **every owner** row in one `FOR UPDATE` statement, in `user_id` order (L2). Locking every owner row serializes concurrent last-owner changes, which Codex required. #176's triggers then revoke grants (`membership_removed`) or renew `permission_revision` in the same transaction.
- **Policy (agreed on #174):**
  - owners and admins may remove or demote;
  - an admin may not touch an owner;
  - the last owner can be neither removed nor demoted;
  - anyone may remove themself, except the last owner.
- **Refused, because it is not decided:** promotion (`promotion_unsupported`), and roles outside owner/admin/editor/viewer.
- **Proof:** `tests/db-contract/workspaceMemberWriters.contract.test.ts` and `mutation.sh`.
- **Rollback:** `rollback/20261025140000_workspace_member_writers.down.sql`. It removes the writers only; memberships, grants and #176's triggers are untouched.
