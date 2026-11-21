-- REMOVE THE ORION R1.1 FICTIONAL RECORDS FROM THE TEST PILOT WORKSPACE (exact: fixed ids / dedupe keys).
--   psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f scripts/test-project/orion-r11-cleanup.sql
delete from public.signal_events where workspace_id = 'a71a0000-0000-4000-8000-0000000011a1' and dedupe_key like 'orion-r11:%';
delete from public.monitoring_subjects where id::text like 'a71a1100-%' and workspace_id = 'a71a0000-0000-4000-8000-0000000011a1';
delete from public.accounts where id::text like 'a71a1100-%' and workspace_id = 'a71a0000-0000-4000-8000-0000000011a1';
select 'R1.1 records left: ' || ((select count(*) from public.accounts where id::text like 'a71a1100-%')
  + (select count(*) from public.signal_events where dedupe_key like 'orion-r11:%')
  + (select count(*) from public.monitoring_subjects where id::text like 'a71a1100-%')) as result;
