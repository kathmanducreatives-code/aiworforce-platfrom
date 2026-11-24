-- THE FIRST REAL-APIFY CANARY, VERIFIED AFTER THE RUN. Read-only.
--
--   psql "$TEST_DB_URL" -X -v workspace_id='<TEST_WORKSPACE_ID>' -v queue_id='<queue uuid>' \
--     -f scripts/test-project/canary-funding-verify.sql
--
-- One row per check: expected, actual, PASS / FAIL / INFO. Any FAIL: the canary
-- is not a success, whatever the task says. Then reconcile every provider
-- purchase against Apify's run history (scripts/test-project/smoke-reconciliation.sql
-- and `apify-account-check.ts --runs …`).
--
-- "No company qualified" is a valid, honest outcome (C05 INFO): three postings
-- may hold no company funded in the last six months. It is never reported as a find.
with
auth as (select a.* from public.discovery_smoke_authorizations a where a.queue_id = :'queue_id'::uuid),
ops as (select o.* from public.discovery_smoke_operations o join auth a on a.id = o.authorization_id),
leads as (select l.*, l.raw->'canonical_decision' as d from public.lead_candidates l where l.workspace_id = :'workspace_id'::uuid
            and l.created_at >= (select created_at from public.lead_mission_queue where id = :'queue_id'::uuid)),
qualified as (select * from leads where (d->>'qualified')::boolean is true),
funding as (select q.raw->>'company_name' as company, e as ev from qualified q,
              jsonb_array_elements(coalesce(q.d->'hard_evidence', '[]'::jsonb)) e where e->>'dimension' = 'funding'),
checks(id, what, expected, actual) as (
  select 'C01', 'the queue row belongs to the canary workspace', '1',
         (select count(*) from public.lead_mission_queue where id = :'queue_id'::uuid and workspace_id = :'workspace_id'::uuid)::text
  union all
  select 'C02', 'only approved actors were purchased (jobs, details, Atomus — never Pvalyou)', '0',
         (select count(*) from ops where kind = 'provider' and actor not in
           ('apify:harvestapi~linkedin-job-search', 'apify:harvestapi~linkedin-company', 'apify:atomus~linkedin-company-scraper'))::text
  union all
  select 'C03', 'at most one start per actor', '0',
         (select count(*) from (select actor from ops where kind = 'provider' group by actor having count(*) > 1) x)::text
  union all
  select 'C04', 'committed provider ≤ 18600 µ$ and model ≤ 50000 µ$', 'true',
         ((select coalesce(sum(committed_microusd), 0) from ops where kind = 'provider') <= 18600
          and (select coalesce(sum(committed_microusd), 0) from ops where kind = 'model') <= 50000)::text
  union all
  select 'C05', 'qualified companies (requested 1)', '0 or 1', (select count(*) from qualified)::text
  union all
  select 'C06', 'every qualified company carries funding evidence from a funding provider', 'true',
         (not exists (select 1 from qualified q where not exists (select 1 from funding f where f.company = q.raw->>'company_name'
            and f.ev->>'result' = 'pass' and f.ev->>'source' in ('apify_funding_atomus', 'apify_funding_pvalyou'))))::text
  union all
  select 'C07', 'every qualified company passed hiring, funding and geography', 'true',
         (not exists (select 1 from qualified q where not (q.d->'hard_checks' @> '{"hiring":"pass","funding":"pass","geography":"pass"}')))::text
  union all
  select 'C08', 'one lead row per company (no duplicate domain in the workspace)', '0',
         (select count(*) from (select lower(domain) from public.accounts where workspace_id = :'workspace_id'::uuid and domain is not null
            group by lower(domain) having count(*) > 1) x)::text
  union all
  select 'C09', 'nothing written outside the canary workspace by this mission', '0',
         (select count(*) from public.lead_candidates l where l.workspace_id <> :'workspace_id'::uuid
            and l.plan_id = (select (request->>'plan_id')::uuid from public.lead_mission_queue where id = :'queue_id'::uuid))::text
  union all
  select 'C10', 'no claimable mission left in the project', '0',
         (select count(*) from public.lead_mission_queue where status in ('queued', 'resumable'))::text
)
select id, what, expected, actual,
       case when id = 'C05' then 'INFO'
            when actual = expected then 'PASS' else 'FAIL' end as result
  from checks order by id;

-- The funding record each qualified company rests on, for the report.
select company, ev->>'source' as source, ev->>'reason' as reason, ev->>'corroborated' as corroborated from (
  select l.raw->>'company_name' as company, e as ev
    from public.lead_candidates l, jsonb_array_elements(coalesce(l.raw->'canonical_decision'->'hard_evidence', '[]'::jsonb)) e
   where l.workspace_id = :'workspace_id'::uuid and (l.raw->'canonical_decision'->>'qualified')::boolean is true
     and e->>'dimension' = 'funding') f;
