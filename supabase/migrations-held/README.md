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

## `20260916120000_lead_v2_p2_execution_spine.sql`

Lead V2 P2. Adds `lead_plan_versions` (immutable RetrievalPlan versions),
`lead_mission_events` (append-only mission trace), and ProviderCallSpec identity
and settlement columns on `lead_execution_calls` (`provider_call_id`,
`idempotency_key`, `plan_version`, `route_id`, `settled_usd`,
`settlement_source`, `variance_usd`) with a partial unique index that allows one
successful execution per idempotency key in a lineage. Additive.

**Not required for P2 to run.** Until it is applied the engine carries plan
versions, the spend ledger and the trace in the execution state, and the full
spec is persisted in the call envelope (`request_input.provider_call_spec`).
Apply with the P2 release, after `lead_mission_queue` exists.

## Tests

`tests/infra/` still reads these files — the baseline's structure, the V2
queue's invariants, RLS coverage and schema drift all keep their guarantees.
Holding a file changes where it lives, not what it must satisfy.
