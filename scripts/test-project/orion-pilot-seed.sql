-- ORION EVIDENCE PILOT — FICTIONAL SEED FOR THE TEST PROJECT ONLY. NEEDS APPROVAL. NOT RUN.
--
--   psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 --single-transaction \
--     -v owner="'<owner auth.users id on TEST>'" -v editor="'<editor id>'" -v viewer="'<viewer id>'" \
--     -v outsider="'<a 4th user, member of the isolation workspace only>'" \
--     -f scripts/test-project/orion-pilot-seed.sql
--
-- Creates TWO fictional workspaces with fixed ids (so cleanup is exact):
--   a71a0000-0000-4000-8000-0000000011a1  "ORION Pilot (fictional)"      ← the pilot
--   a71a0000-0000-4000-8000-0000000011a2  "ORION Isolation (fictional)"  ← must never leak into the pilot
-- Respects the TEST no-Brain guard: NO company_brain row is written (the guard
-- would refuse it). Brain-dependent behaviour (ICP fit, exclusions) is verified
-- in the loopback DB lane instead (tests/db-contract/orionEvidence.contract.test.ts).
-- Every company, domain and event below is invented. Re-runnable: it refuses if
-- the pilot workspaces already exist (run the cleanup first).
do $$ begin
  if exists (select 1 from public.workspaces where id in ('a71a0000-0000-4000-8000-0000000011a1','a71a0000-0000-4000-8000-0000000011a2')) then
    raise exception 'orion pilot workspaces already exist — run orion-pilot-cleanup.sql first';
  end if;
end $$;

insert into public.workspaces (id, name, slug) values
  ('a71a0000-0000-4000-8000-0000000011a1', 'ORION Pilot (fictional)', 'orion-pilot-fictional'),
  ('a71a0000-0000-4000-8000-0000000011a2', 'ORION Isolation (fictional)', 'orion-isolation-fictional');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('a71a0000-0000-4000-8000-0000000011a1', :owner, 'owner'),
  ('a71a0000-0000-4000-8000-0000000011a1', :editor, 'editor'),
  ('a71a0000-0000-4000-8000-0000000011a1', :viewer, 'viewer'),
  ('a71a0000-0000-4000-8000-0000000011a2', :outsider, 'owner');

-- Accounts + leads (ATLAS records): one rejected, two qualified, one new.
insert into public.accounts (id, workspace_id, name, domain, industry, employee_count, location) values
  ('a71a0000-0000-4000-8000-0000000021a1', 'a71a0000-0000-4000-8000-0000000011a1', 'Kestrel Fabrication', 'kestrel-fab.example', 'Manufacturing', '140', 'Dayton, OH'),
  ('a71a0000-0000-4000-8000-0000000021a2', 'a71a0000-0000-4000-8000-0000000011a1', 'Harbor Valve Works', 'harborvalve.example', 'Manufacturing', '85', 'Houston, TX'),
  ('a71a0000-0000-4000-8000-0000000021a3', 'a71a0000-0000-4000-8000-0000000011a1', 'Cloudnova Software', 'cloudnova.example', 'Software', '300', 'Austin, TX'),
  ('a71a0000-0000-4000-8000-0000000021a4', 'a71a0000-0000-4000-8000-0000000011a1', 'Summit Robotics', 'summit-robotics.example', 'Manufacturing', '400', 'Plano, TX'),
  ('a71a0000-0000-4000-8000-0000000021a9', 'a71a0000-0000-4000-8000-0000000011a2', 'Zephyr Industries', 'zephyr.example', 'Manufacturing', '120', 'Reno, NV');

insert into public.lead_candidates (workspace_id, account_id, status, fit_score, priority, reason, created_at) values
  ('a71a0000-0000-4000-8000-0000000011a1', 'a71a0000-0000-4000-8000-0000000021a1', 'qualified', 86, 'high',
     'US manufacturer, 140 employees, second plant announced — inside ICP', now() - interval '5 days'),
  ('a71a0000-0000-4000-8000-0000000011a1', 'a71a0000-0000-4000-8000-0000000021a2', 'qualified', 71, 'medium',
     'US manufacturer, 85 employees, hiring machinists', now() - interval '8 days'),
  ('a71a0000-0000-4000-8000-0000000011a1', 'a71a0000-0000-4000-8000-0000000021a3', 'rejected', 18, 'low',
     'Software company — outside the manufacturing ICP', now() - interval '10 days'),
  ('a71a0000-0000-4000-8000-0000000011a1', 'a71a0000-0000-4000-8000-0000000021a4', 'rejected', 35, 'low',
     '400 employees — above the 20–200 size band', now() - interval '6 days'),
  ('a71a0000-0000-4000-8000-0000000011a2', 'a71a0000-0000-4000-8000-0000000021a9', 'qualified', 90, 'high',
     'ISOLATION CANARY — must never appear in the pilot workspace', now() - interval '2 days');

-- LISA signals: verified, single-source, stale, contradicted, plus an isolation canary.
insert into public.signal_events (workspace_id, account_id, signal_type, signal_category, occurred_at, occurred_at_basis, observed_at,
    dedupe_key, origin, subject_type, subject_key, lifecycle_status, verification_status, confidence, source_url, normalized_value) values
  ('a71a0000-0000-4000-8000-0000000011a1', 'a71a0000-0000-4000-8000-0000000021a1', 'geographic_expansion', 'growth', now() - interval '6 days', 'source_reported', now() - interval '5 days',
     'orion-pilot:kestrel-plant', 'manual_scan', 'company', 'kestrel-fab', 'active', 'provider_verified', 'high', 'https://plant-news.example/kestrel',
     '{"lisa":{"company":{"name":"Kestrel Fabrication","domain":"kestrel-fab.example"},"title":"Kestrel Fabrication opens a second plant in Dayton, Ohio","verification":{"level":"corroborated","confidence":"high"}}}'),
  ('a71a0000-0000-4000-8000-0000000011a1', 'a71a0000-0000-4000-8000-0000000021a2', 'growth_hiring', 'growth', now() - interval '9 days', 'source_reported', now() - interval '8 days',
     'orion-pilot:harbor-hiring', 'manual_scan', 'company', 'harborvalve', 'active', 'unverified', 'medium', 'https://jobs.example/harbor',
     '{"lisa":{"company":{"name":"Harbor Valve Works","domain":"harborvalve.example"},"title":"Harbor Valve Works is hiring 12 machinists","verification":{"level":"single_source","confidence":"medium"}}}'),
  ('a71a0000-0000-4000-8000-0000000011a1', null, 'market_expansion', 'growth', now() - interval '130 days', 'source_reported', now() - interval '128 days',
     'orion-pilot:pinecrest-cnc', 'manual_scan', 'company', 'pinecrest', 'active', 'unverified', 'low', 'https://forum.example/pinecrest',
     '{"lisa":{"company":{"name":"Pinecrest Tooling","domain":"pinecrest.example"},"title":"Pinecrest Tooling adds a CNC line (forum post)","verification":{"level":"single_source","confidence":"low"}}}'),
  ('a71a0000-0000-4000-8000-0000000011a1', null, 'geographic_expansion', 'growth', now() - interval '8 days', 'source_reported', now() - interval '6 days',
     'orion-pilot:ridgeway-denied', 'manual_scan', 'company', 'ridgeway', 'contradicted', 'unverified', 'low', 'https://trade-blog.example/ridgeway',
     '{"lisa":{"company":{"name":"Ridgeway Castings","domain":"ridgeway.example"},"title":"Ridgeway Castings expansion — denied by the company press office","verification":{"level":"contradicted","confidence":"low"}}}'),
  ('a71a0000-0000-4000-8000-0000000011a2', 'a71a0000-0000-4000-8000-0000000021a9', 'geographic_expansion', 'growth', now() - interval '3 days', 'source_reported', now() - interval '2 days',
     'orion-pilot:zephyr-canary', 'manual_scan', 'company', 'zephyr', 'active', 'provider_verified', 'high', 'https://news.example/zephyr',
     '{"lisa":{"company":{"name":"Zephyr Industries","domain":"zephyr.example"},"title":"ISOLATION CANARY — Zephyr Industries opens a plant","verification":{"level":"corroborated","confidence":"high"}}}');

select 'seeded ORION pilot: ' || (select count(*) from public.signal_events where workspace_id = 'a71a0000-0000-4000-8000-0000000011a1') || ' pilot signals, '
  || (select count(*) from public.lead_candidates where workspace_id = 'a71a0000-0000-4000-8000-0000000011a1') || ' pilot leads';
