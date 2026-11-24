-- TEST ACCEPTANCE, STEP 5: RETRY / RESUME EVIDENCE for one queue row. Read-only.
--
--   psql "$TEST_DB_URL" -X -v queue_id='<QUEUE_ID>' -f scripts/test-project/acceptance/retry-resume-evidence.sql
--
-- One row per check; the procedure (docs/launch/test-acceptance-pack.md §5) says
-- which result each scenario must show. Any FAIL: stop.
begin transaction read only;
with
q as (select * from public.lead_mission_queue where id = :'queue_id'::uuid),
t as (select t.* from public.tasks t join q on t.id = q.task_id),
calls as (select e.* from public.lead_execution_calls e join t on e.task_id = t.id),
checks(id, what, expected, actual) as (
  select 'R01', 'the queue row exists and ended (complete / failed / cancelled)', '1',
         (select count(*) from q where status in ('complete', 'failed', 'cancelled'))::text
  union all
  select 'R02', 'one task for the mission, whatever the number of claims', '1',
         (select count(distinct task_id) from q where task_id is not null)::text
  union all
  -- A replay re-uses its logical call key; two rows naming a run under one key = a second purchase.
  select 'R03', 'no logical call bought twice (provider rows with a run id per key <= 1)', '0',
         (select count(*) from (select logical_call_key from calls where record_kind = 'provider_call'
            and length(btrim(coalesce(provider_run_id, ''))) > 0 group by logical_call_key having count(*) > 1) d)::text
  union all
  select 'R04', 'zero-Apify: no provider call names a run', '0',
         (select count(*) from calls where record_kind = 'provider_call' and length(btrim(coalesce(provider_run_id, ''))) > 0)::text
  union all
  select 'R05', 'model calls recorded (<= 4 admitted per authorization)', '<=4',
         (select count(*) from calls where record_kind = 'model_call')::text
  union all
  select 'R06', 'no credit left reserved for this task', '0',
         (select count(*) from public.credit_transactions c join t on c.task_id = t.id where c.status = 'reserved')::text
  union all
  select 'R07', 'exactly one terminal verdict on the task', '1',
         (select count(*) from t where t.result ? 'terminal_status')::text
  union all
  -- Scenario 5b: a claim after the requester lost membership ends at the guard, before any effect.
  select 'R08', 'refused at the pre-effect guard (scenario 5b only; else 0)', 'info',
         (select count(*) from q where coalesce(q.last_outcome::text, '') like '%pre_effect_guard:%')::text
)
select id, what, expected, actual,
       case when expected in ('info') then 'INFO'
            when expected = '<=4' then case when actual::int <= 4 then 'PASS' else 'FAIL' end
            when expected = actual then 'PASS' else 'FAIL' end as result
  from checks order by id;
rollback;
