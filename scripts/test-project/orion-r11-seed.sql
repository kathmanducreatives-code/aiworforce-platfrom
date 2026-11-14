-- ORION R1.1 — EXTRA FICTIONAL RECORDS FOR THE TEST PILOT WORKSPACE ONLY.
-- Makes "ORION Pilot (fictional)" production-SHAPED for the R1.1 acceptance run:
-- 11 accounts that are NOT leads (including rows named Laminar / Epsilon3 /
-- Civilgrid, as in the owner's prompts — fictional rows, invented domains), six
-- hiring signals 31–36 days old with NO event date, and one DISABLED monitoring
-- subject. No Company Brain (the TEST no-Brain guard stays on). Every new id
-- starts with a71a1100- (accounts, monitoring) or dedupe key orion-r11: (signals),
-- so orion-r11-cleanup.sql is exact. Refuses to run twice.
--   psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f scripts/test-project/orion-r11-seed.sql
do $$ begin
  if not exists (select 1 from public.workspaces where id = 'a71a0000-0000-4000-8000-0000000011a1') then
    raise exception 'the ORION pilot workspace is missing — run orion-pilot-seed.sql first';
  end if;
  if exists (select 1 from public.accounts where id::text like 'a71a1100-%') then
    raise exception 'R1.1 records already present — run orion-r11-cleanup.sql first';
  end if;
end $$;

insert into public.accounts (id, workspace_id, name, domain, industry, employee_count, created_at) values
  ('a71a1100-0000-4000-8000-000000000101', 'a71a0000-0000-4000-8000-0000000011a1', 'Laminar', 'laminar.example', 'Software', null, now() - interval '21 days'),
  ('a71a1100-0000-4000-8000-000000000102', 'a71a0000-0000-4000-8000-0000000011a1', 'Epsilon3', 'epsilon3.example', 'Software', null, now() - interval '22 days'),
  ('a71a1100-0000-4000-8000-000000000103', 'a71a0000-0000-4000-8000-0000000011a1', 'Civilgrid', 'civilgrid.example', 'Software', null, now() - interval '23 days'),
  ('a71a1100-0000-4000-8000-000000000104', 'a71a0000-0000-4000-8000-0000000011a1', 'Fictional Northfield 1', 'fictional-northfield-1.example', 'Software', null, now() - interval '24 days'),
  ('a71a1100-0000-4000-8000-000000000105', 'a71a0000-0000-4000-8000-0000000011a1', 'Fictional Northfield 2', 'fictional-northfield-2.example', 'Software', null, now() - interval '25 days'),
  ('a71a1100-0000-4000-8000-000000000106', 'a71a0000-0000-4000-8000-0000000011a1', 'Fictional Northfield 3', 'fictional-northfield-3.example', 'Software', null, now() - interval '26 days'),
  ('a71a1100-0000-4000-8000-000000000107', 'a71a0000-0000-4000-8000-0000000011a1', 'Fictional Northfield 4', 'fictional-northfield-4.example', 'Software', null, now() - interval '27 days'),
  ('a71a1100-0000-4000-8000-000000000108', 'a71a0000-0000-4000-8000-0000000011a1', 'Fictional Northfield 5', 'fictional-northfield-5.example', 'Software', null, now() - interval '28 days'),
  ('a71a1100-0000-4000-8000-000000000109', 'a71a0000-0000-4000-8000-0000000011a1', 'Fictional Northfield 6', 'fictional-northfield-6.example', 'Software', null, now() - interval '29 days'),
  ('a71a1100-0000-4000-8000-000000000110', 'a71a0000-0000-4000-8000-0000000011a1', 'Fictional Northfield 7', 'fictional-northfield-7.example', 'Software', null, now() - interval '30 days'),
  ('a71a1100-0000-4000-8000-000000000111', 'a71a0000-0000-4000-8000-0000000011a1', 'Fictional Northfield 8', 'fictional-northfield-8.example', 'Software', null, now() - interval '31 days');

insert into public.signal_events (workspace_id, signal_type, signal_category, occurred_at, occurred_at_basis, observed_at,
    dedupe_key, origin, subject_type, subject_key, lifecycle_status, verification_status, confidence, source_url, normalized_value) values
  ('a71a0000-0000-4000-8000-0000000011a1', 'sales_hiring', 'growth', null, 'unknown', now() - interval '31 days', 'orion-r11:hiring-1', 'manual_scan', 'company', 'northfield-1', 'active', 'unverified', 'medium', 'https://jobs.example/northfield-1',
     '{"lisa":{"company":{"name":"Fictional Northfield 1","domain":"fictional-northfield-1.example"},"title":"Fictional Northfield 1 is hiring a Sales Development Representative","verification":{"level":"single_source","confidence":"medium"}}}'),
  ('a71a0000-0000-4000-8000-0000000011a1', 'sales_hiring', 'growth', null, 'unknown', now() - interval '32 days', 'orion-r11:hiring-2', 'manual_scan', 'company', 'northfield-2', 'active', 'unverified', 'medium', 'https://jobs.example/northfield-2',
     '{"lisa":{"company":{"name":"Fictional Northfield 2","domain":"fictional-northfield-2.example"},"title":"Fictional Northfield 2 is hiring a Sales Development Representative","verification":{"level":"single_source","confidence":"medium"}}}'),
  ('a71a0000-0000-4000-8000-0000000011a1', 'sales_hiring', 'growth', null, 'unknown', now() - interval '33 days', 'orion-r11:hiring-3', 'manual_scan', 'company', 'northfield-3', 'active', 'unverified', 'medium', 'https://jobs.example/northfield-3',
     '{"lisa":{"company":{"name":"Fictional Northfield 3","domain":"fictional-northfield-3.example"},"title":"Fictional Northfield 3 is hiring a Sales Development Representative","verification":{"level":"single_source","confidence":"medium"}}}'),
  ('a71a0000-0000-4000-8000-0000000011a1', 'sales_hiring', 'growth', null, 'unknown', now() - interval '34 days', 'orion-r11:hiring-4', 'manual_scan', 'company', 'northfield-4', 'active', 'unverified', 'medium', 'https://jobs.example/northfield-4',
     '{"lisa":{"company":{"name":"Fictional Northfield 4","domain":"fictional-northfield-4.example"},"title":"Fictional Northfield 4 is hiring a Sales Development Representative","verification":{"level":"single_source","confidence":"medium"}}}'),
  ('a71a0000-0000-4000-8000-0000000011a1', 'sales_hiring', 'growth', null, 'unknown', now() - interval '35 days', 'orion-r11:hiring-5', 'manual_scan', 'company', 'northfield-5', 'active', 'unverified', 'medium', 'https://jobs.example/northfield-5',
     '{"lisa":{"company":{"name":"Fictional Northfield 5","domain":"fictional-northfield-5.example"},"title":"Fictional Northfield 5 is hiring a Sales Development Representative","verification":{"level":"single_source","confidence":"medium"}}}'),
  ('a71a0000-0000-4000-8000-0000000011a1', 'sales_hiring', 'growth', null, 'unknown', now() - interval '36 days', 'orion-r11:hiring-6', 'manual_scan', 'company', 'northfield-6', 'active', 'unverified', 'medium', 'https://jobs.example/northfield-6',
     '{"lisa":{"company":{"name":"Fictional Northfield 6","domain":"fictional-northfield-6.example"},"title":"Fictional Northfield 6 is hiring a Sales Development Representative","verification":{"level":"single_source","confidence":"medium"}}}');

insert into public.monitoring_subjects (id, workspace_id, subject_kind, identifier, label, signals, enabled) values
  ('a71a1100-0000-4000-8000-000000000201', 'a71a0000-0000-4000-8000-0000000011a1', 'competitor', 'fictional-northfield-1.example', 'Fictional Northfield 1 (paused)',
   '[{"event":"hiring","subject":"company"}]', false);

select 'R1.1 seed: accounts ' || (select count(*) from public.accounts where workspace_id = 'a71a0000-0000-4000-8000-0000000011a1')
  || ', leads ' || (select count(*) from public.lead_candidates where workspace_id = 'a71a0000-0000-4000-8000-0000000011a1')
  || ', signals ' || (select count(*) from public.signal_events where workspace_id = 'a71a0000-0000-4000-8000-0000000011a1')
  || ', monitoring ' || (select count(*) from public.monitoring_subjects where workspace_id = 'a71a0000-0000-4000-8000-0000000011a1') as result;
