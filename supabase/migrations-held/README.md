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

## Tests

`tests/infra/` still reads these files — the baseline's structure, the V2
queue's invariants, RLS coverage and schema drift all keep their guarantees.
Holding a file changes where it lives, not what it must satisfy.
