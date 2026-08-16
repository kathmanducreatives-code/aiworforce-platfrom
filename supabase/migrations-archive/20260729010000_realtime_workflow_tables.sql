-- WORKFLOW TABLES MUST BE REPLICATED FOR THE UI TO SEE THEM.
--
-- src/lib/orchestration.ts `subscribePlan` subscribes to postgres_changes on
-- five tables. Only `conversations` and `messages` were members of the
-- `supabase_realtime` publication, so the plan channel could never deliver an
-- event — the callback simply never fired.
--
-- Production run 3d54e4fe-b6b6-47a6-9dca-ee032785ea59 (2026-07-29): the backend
-- finished in 83s and wrote a task row, five activity rows, two tool_calls and a
-- checkpointed partial. The client had fetched once at 00:09:11 — before the
-- task row existed — and showed that snapshot for the next six minutes.
--
-- SCOPE. This adds REPLICATION only. It does not create, alter or drop any
-- table, and it does not touch a single RLS policy: realtime still applies the
-- same row-level rules to every subscriber, so a client receives exactly the
-- rows it could already SELECT. Adding a table to a publication cannot widen
-- access.
--
-- IDEMPOTENT. Each table is checked against pg_publication_tables first, so
-- re-applying this migration is a no-op rather than a
-- "relation is already member of publication" error.

do $$
declare
  t text;
  workflow_tables constant text[] := array[
    'task_plans',
    'tasks',
    'activity_feed',
    'approvals',
    'tool_calls'
  ];
begin
  -- Nothing to add to a publication that does not exist. Fail loudly rather
  -- than silently skipping: on a Supabase project it always exists, so its
  -- absence means this is not the database we think it is.
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'publication supabase_realtime does not exist';
  end if;

  foreach t in array workflow_tables loop
    -- The table itself must exist. A missing one is a real problem worth
    -- surfacing, not something to paper over.
    if not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relkind = 'r'
    ) then
      raise exception 'table public.% does not exist', t;
    end if;

    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      raise notice 'public.% is already published; skipping', t;
    else
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice 'added public.% to supabase_realtime', t;
    end if;
  end loop;
end $$;

-- REPLICA IDENTITY is deliberately left alone. Realtime evaluates both RLS and
-- the client's `plan_id=eq.…` filter against the NEW record, which the WAL
-- carries in full for INSERT and UPDATE regardless of replica identity. Setting
-- it to FULL would only populate `old_record` and DELETE payloads, neither of
-- which this UI reads — at the cost of writing every column of every update to
-- the WAL for five hot tables.
