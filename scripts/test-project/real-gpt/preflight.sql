-- HOSTED TEST PREFLIGHT FOR THE ZERO-APIFY REAL-GPT RUN. Read-only.
--
--   psql "$TEST_DB_URL" -X -v workspace_id='<TEST_WORKSPACE_ID>' -f scripts/test-project/real-gpt/preflight.sql
--
-- One row per check: expected, actual, PASS / FAIL / INFO. Any FAIL: stop.
-- INFO rows record a state that is a decision, not a defect (the billing
-- migrations stay held until separately approved; a zero-Apify run buys
-- nothing, so it does not need them).
with
fn(name) as (select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'),
checks(id, what, expected, actual) as (
  select 'P01', 'held smoke admission tables exist', '3',
         ((to_regclass('public.discovery_smoke_authorizations') is not null)::int + (to_regclass('public.discovery_smoke_operations') is not null)::int
          + (to_regclass('public.discovery_smoke_reconciliations') is not null)::int)::text
  union all
  select 'P02', 'smoke admission functions exist', '5',
         (select count(*) from fn where name in ('admit_discovery_smoke', 'authorize_discovery_smoke', 'reconcile_discovery_smoke_operation',
                                                  'record_discovery_smoke_receipt', 'stop_discovery_smoke'))::text
  union all
  select 'P03', 'service_role may admit/record/stop, never authorize/reconcile; anon/authenticated nothing', 'ok',
         case when has_function_privilege('service_role', 'public.admit_discovery_smoke(uuid,uuid,uuid,integer,text,text,text,text,text,text)', 'execute')
               and has_function_privilege('service_role', 'public.record_discovery_smoke_receipt(uuid,text,uuid,text,text,bigint,text)', 'execute')
               and has_function_privilege('service_role', 'public.stop_discovery_smoke(uuid,text)', 'execute')
               and not has_function_privilege('service_role', 'public.authorize_discovery_smoke(uuid,text,jsonb,jsonb,integer)', 'execute')
               and not has_function_privilege('service_role', 'public.reconcile_discovery_smoke_operation(uuid,text,bigint,text,text)', 'execute')
               and not has_function_privilege('authenticated', 'public.admit_discovery_smoke(uuid,uuid,uuid,integer,text,text,text,text,text,text)', 'execute')
               and not has_function_privilege('anon', 'public.admit_discovery_smoke(uuid,uuid,uuid,integer,text,text,text,text,text,text)', 'execute')
              then 'ok' else 'mismatch' end
  union all
  select 'P04', 'Lead V2 queue: table and claim/bind functions exist', '3',
         ((to_regclass('public.lead_mission_queue') is not null)::int
          + (select count(*) from fn where name in ('claim_next_lead_mission', 'bind_lead_mission_execution')))::text
  union all
  select 'P05', 'credit re-arm fix (held 20261015130000) installed', 'decision',
         case when exists (select 1 from information_schema.columns where table_schema = 'public'
                             and table_name = 'credit_transactions' and column_name = 'rearmed_at') then 'installed' else 'not installed' end
  union all
  select 'P06', 'credit reaper fix (held 20261022120000) installed', 'decision',
         case when position('provider run confirmed' in pg_get_functiondef('public.credits_release_stale(interval)'::regprocedure)) > 0
              then 'installed' else 'not installed' end
  union all
  select 'P07', 'no cron job calls a hosted project', '0',
         (select count(*) from cron.job where command ilike '%net.http_post%' or command ilike '%supabase.co%')::text
  union all
  select 'P08', 'the test workspace exists with the Scout agent', '1',
         (select count(*) from public.agents where workspace_id = :'workspace_id'::uuid and slug = 'scout')::text
  union all
  select 'P09', 'the test workspace holds credits, none reserved', 'balance>=1, reserved=0',
         coalesce((select case when balance_credits >= 1 and reserved_credits = 0 then 'balance>=1, reserved=0'
                               else format('balance=%s, reserved=%s', balance_credits, reserved_credits) end
                     from public.workspace_credit_balances where workspace_id = :'workspace_id'::uuid), 'no balance row')
  union all
  select 'P10', 'the test workspace has no Company Brain (the planner request was measured without one)', '0',
         (select count(*) from public.company_brain where workspace_id = :'workspace_id'::uuid)::text
  union all
  select 'P11', 'zero open provider liability from earlier smokes', '0',
         (select count(*) from public.discovery_smoke_operations o where o.kind = 'provider'
             and not exists (select 1 from public.discovery_smoke_reconciliations r
                              where r.authorization_id = o.authorization_id and r.operation_key = o.operation_key
                                and r.vendor_microusd <= o.committed_microusd))::text
  union all
  select 'P12', 'no live smoke authorization', '0',
         (select count(*) from public.discovery_smoke_authorizations where status = 'active' and deadline_at > now())::text
  union all
  select 'P13', 'nothing in the V2 queue a worker could claim (queued / running / resumable)', '0',
         (select count(*) from public.lead_mission_queue where status in ('queued', 'running', 'resumable'))::text
  union all
  select 'P14', 'model calls must name their model (the evidence relies on it)', '1',
         (select count(*) from pg_constraint where conname = 'lead_execution_calls_model_call_names_model')::text
)
select id, what, expected, actual,
       case when expected = 'decision' then 'INFO'
            when expected = actual then 'PASS' else 'FAIL' end as result
  from checks order by id;
