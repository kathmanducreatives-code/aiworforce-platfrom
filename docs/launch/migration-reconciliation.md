# Migration reconciliation — plan (Phase 2C)

**Status: PLAN. Nothing here has been applied to production.** Production's actual
migration state is unknown to this session (no production database credentials);
the tool below answers it read-only.

## What is known

- `supabase/migrations/` — 44 files (+2 new from launch hardening).
- `supabase/migrations-held/` — 4 files kept out of the synced directory on purpose (README there).
- `supabase/migrations-archive/` — history only; never applied.
- Production history was written **through the MCP channel**, which assigns its own
  version string and keeps the file's NAME, so local versions do not match remote
  ones (docs/SUPABASE_TARGETING.md). `db push`, `db pull` and `db reset` are refused.
- A fresh database CAN be built from this repo, in timestamp order across
  `migrations-held/` and `migrations/` — proven by `scripts/security/isolation-stack.sh`,
  which builds one and runs the isolation suite against it — **with two gaps a fresh
  build must work around** (both found while building it):
  1. The held baseline is raw `pg_dump` output with psql meta-commands
     (`\restrict`/`\unrestrict`) that the migration runner cannot execute.
  2. `pg_cron` and `pg_net` are assumed by the cron migrations but created by no migration.

## The read-only tool

```
python3 scripts/deploy/migration-probes.py > /tmp/migration-status.sql
psql "$PROD_DB_URL_READONLY" -At -f /tmp/migration-status.sql
```

For each of the 48 files it reports `recorded` (by version), `recorded_by_name`,
and whether each object the file creates exists (125 probes: tables, functions,
indexes, views, policies, added columns). It runs in a `READ ONLY` transaction.
On the local stack every file is recorded and every probe present.

Resolve each file into one of:

| State | Meaning | Action |
|---|---|---|
| APPLIED | recorded (by name) and objects present | none |
| OUT-OF-BAND | objects present, not recorded | verify the objects match the file, then `supabase migration repair --status applied <remote-style version>` via the TEST-pinned channel **only if** the name/version correspondence is certain; otherwise leave unrecorded and document |
| MISSING | not recorded, objects absent | review, then apply **exactly that SQL**, one at a time, through the MCP channel |
| DRIFT | recorded, objects absent | investigate before anything else — something removed them |

## Per-file expectations

| File(s) | Expected in production | Notes |
|---|---|---|
| held `20260816120000_baseline_schema` | objects present, not recorded | **NEVER apply to production** — replaying it would restore permissive policies and grants later migrations removed. |
| held `20260910140000_lead_mission_v2_claim` | **objects likely present** (the launch audit found production using `claim_next_lead_mission`/`cancel_lead_mission`) | The held README still says "never reviewed for the live project" — out of date or production diverged. Probe, then either repair-record it and move the file into `migrations/`, or document why not. |
| held `20260912160000_content_format_model` | probably absent | additive, safe; apply deliberately or keep held |
| held `20260915120000_sweep_skips_v2_queue_tasks` | unknown | depends on the V2 claim migration; apply only after it |
| `20260824190000_backfill_…`, `20260829150000_lead_lineages_backfill`, `20260829170000_hiring_…_backfill`, `20260903130000_…_soft_404_correction`, `20260825170000_canonical_dedupe_keys` | data already rewritten | **dangerous to replay by hand** — they UPDATE data; never re-run |
| `20260826100000_sweep_stuck_runs` | cron job present | **dangerous to replay** — `cron.schedule` without `cron.unschedule` would add a duplicate job |
| `20260825140000_monitoring_cron`, `20260826170000_resume_stalled_leads_cron` | cron jobs present | unschedule-then-schedule; read secrets via settings/vault — check the settings exist before any re-run |
| `20260907120000_drop_permissive_policies`, `20260907150000_drop_fake_token_policies` | applied | idempotent drops; `verify-rls.sh` confirms the outcome |
| **NEW** `20260929120000_lock_down_definer_rpcs` | MISSING | **apply in Phase 9** — closes anon credit minting |
| **NEW** `20260929130000_revoke_anon_writes_on_workspace_tables` | MISSING | **apply in Phase 9** — defence in depth |

## Order for Phase 9

1. Run the probe and `scripts/security/verify-rls.sh "$PROD_DB_URL_READONLY"` (both read-only); save the output.
2. Apply `20260929120000_lock_down_definer_rpcs.sql`, then re-run `verify-rls.sh --strict`
   (the definer and service-only checks must turn green).
3. Apply `20260929130000_revoke_anon_writes_on_workspace_tables.sql`; `verify-rls.sh --strict` must be all green.
4. Resolve the held V2 claim migration's recorded state (no DDL re-run).

Rollback for 2–3: re-`grant execute … to anon, authenticated` / re-`grant insert, update, delete … to anon`
restores the prior grants exactly; neither migration changes data.
