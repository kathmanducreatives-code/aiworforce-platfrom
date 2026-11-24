-- THE CANARY SESSION'S FULL REPORT: every company, its decision and its evidence. Read-only.
--
--   psql "$TEST_DB_URL" -X -v queue_id='<queue uuid>' -f scripts/test-project/canary/session-report.sql
--
-- Company names and evidence: run it against the isolated project and keep the
-- output out of public logs and artifacts (session-summary.sql is the public half).
with q as (select id, task_id from public.lead_mission_queue where id = :'queue_id'::uuid),
t as (select x.result from public.tasks x join q on x.id = q.task_id)
select l->'company'->>'name' as company,
       l->'company'->>'domain' as domain,
       coalesce(l->>'label', '') as label,
       l->>'bucket' as decision,
       l->'hard_checks' as hard_checks,
       (select string_agg(c->>'dimension' || ': ' || (c->>'result') || ' — ' || (c->>'reason'), E'\n')
          from jsonb_array_elements(coalesce(l->'hard_check_details', '[]'::jsonb)) c) as evidence,
       l->'caveats' as caveats,
       (select string_agg(g->>'claim' || ' → ' || coalesce(g->'route'->>'actor', 'no route'), '; ')
          from jsonb_array_elements(coalesce(l->'evidence_gaps', '[]'::jsonb)) g) as open_gaps
  from t, jsonb_array_elements(coalesce(t.result->'workbench_mission_view'->'leads', '[]'::jsonb)) l
 order by (l->>'label') is null, l->'company'->>'name';
