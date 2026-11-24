-- Company Brain V1 — TEST PREFLIGHT. READ-ONLY: selects from catalogs only.
-- Every row must say ok=true before any migration in manifest.json is applied.
-- WHICH project this runs on is not knowable from inside the database: the
-- target ref is checked by check-manifest.mjs against the connection URL first.
select 'P1 no no-Brain guard' as check, 'discovery_test_no_company_brain' as detail,
       not exists (select 1 from pg_trigger where tgname = 'discovery_test_no_company_brain') as ok
union all
select 'P2 auth.sessions exists', 'needed by the authorized writers',
       exists (select 1 from information_schema.tables where table_schema = 'auth' and table_name = 'sessions')
union all
select 'P3 has_workspace_access exists', 'RLS helper',
       exists (select 1 from pg_proc where proname = 'has_workspace_access')
union all
select 'P4 memory tables not yet present', 'held migration not applied twice',
       not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'company_brain_memory')
union all
select 'P5 no cron calls a hosted URL', 'cron.job',
       not exists (select 1 from cron.job where command ilike '%supabase.co/functions%');
