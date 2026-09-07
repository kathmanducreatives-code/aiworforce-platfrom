-- AN OPS TABLE THAT NEVER ENTERED THE MIGRATION PATH, AND SO NEVER GOT RLS.
--
-- ── WHAT WAS EXPOSED ───────────────────────────────────────────────────────
--
-- `ops_stuck_run_archive` holds `to_jsonb(t)` of a whole `tasks` row — so
-- `workspace_id`, `user_id`, `input`, `output`, `result`, `payload` and
-- `error_message` for a killed run. One archived row is 160 kB of a complete
-- lead mission: the companies, the evidence, the lot.
--
-- It was the ONLY table in `public` with `relrowsecurity = false`. The other
-- 119 have it on. Supabase grants `anon` and `authenticated` full DML on every
-- table by default, so RLS is the whole of what stands between those grants
-- and the data; without it, the default grant was simply live. The anon key
-- ships inside the frontend bundle, so any visitor could read another
-- workspace's prospects with one request.
--
-- ── WHY THIS ONE AND NOT THE OTHER 119 ─────────────────────────────────────
--
-- Because it was created by hand. `20260826100000_sweep_stuck_runs.sql`
-- INSERTS into this table and never creates it, and no migration in
-- `migrations/` or `migrations-archive/` creates it either. The baseline
-- carries 111 `CREATE TABLE` and 111 `ENABLE ROW LEVEL SECURITY`, and every
-- forward migration that adds a table adds its RLS in the same file. The
-- convention held everywhere it was applied. This table was outside it.
--
-- So the fix is not only to enable RLS — it is to put the table under
-- migration control, where `tests/infra/rlsCoversEveryTable.test.ts` can see
-- it and keep seeing it.
--
-- ── WHY GRANTS ARE REVOKED AND NOT LEFT TO RLS ─────────────────────────────
--
-- RLS filters SELECT, INSERT, UPDATE and DELETE. It does NOT filter TRUNCATE —
-- that is a table privilege and is not row-level, so an `anon` caller holding
-- the default TRUNCATE grant could still destroy the archive with RLS fully
-- enabled. The archive is forensic evidence about runs the platform killed;
-- losing it silently is its own incident. Revoking is therefore load-bearing
-- here, not belt-and-braces.
--
-- ── NO POLICY IS ADDED, DELIBERATELY ───────────────────────────────────────
--
-- RLS on with zero policies denies every non-owner role. That is the correct
-- end state: nothing reads this table from a client. It appears nowhere in
-- `src/`, and it is absent from the generated `src/integrations/supabase/
-- types.ts`, so the frontend cannot even name it in a query. Its only writer
-- is `public.tasks_sweep_stuck_runs`, which is `SECURITY DEFINER` and owned by
-- `postgres` — the table's own owner — so it bypasses RLS and is untouched by
-- any of this. `service_role` keeps its grants for the same reason.
--
-- Adding a permissive policy to make something pass would reopen exactly what
-- this closes.

create table if not exists public.ops_stuck_run_archive (
  archived_at timestamptz not null default now(),
  kind        text        not null,
  id          uuid        not null,
  snapshot    jsonb       not null
);

alter table public.ops_stuck_run_archive enable row level security;

revoke all on table public.ops_stuck_run_archive from anon;
revoke all on table public.ops_stuck_run_archive from authenticated;

comment on table public.ops_stuck_run_archive is
  'Forensic snapshots of platform-killed task rows, written by '
  'tasks_sweep_stuck_runs (SECURITY DEFINER). Service-role/owner only: RLS is '
  'enabled with NO policies and the anon/authenticated grants are revoked. It '
  'has no client reader and must not acquire one.';
