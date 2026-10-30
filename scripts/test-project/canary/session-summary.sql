-- THE CANARY SESSION'S PUBLIC-SAFE SUMMARY. Read-only.
--
--   psql "$TEST_DB_URL" -X -v queue_id='<queue uuid>' -f scripts/test-project/canary/session-summary.sql
--
-- Counts, decisions and money only: no company name, domain or evidence text,
-- because the workflow's artifacts and logs are public. The full report, with
-- the companies and their evidence, is scripts/test-project/canary/session-report.sql,
-- run by the operator against the isolated project.
with q as (select id, task_id, status, created_at from public.lead_mission_queue where id = :'queue_id'::uuid),
a as (select x.* from public.discovery_smoke_authorizations x join q on x.queue_id = q.id),
ops as (select o.*, r.vendor_microusd, r.vendor_status from public.discovery_smoke_operations o join a on a.id = o.authorization_id
          left join public.discovery_smoke_reconciliations r on r.authorization_id = o.authorization_id and r.operation_key = o.operation_key),
t as (select x.status, x.result from public.tasks x join q on x.id = q.task_id),
leads as (select l.raw->'canonical_decision' as d from public.lead_candidates l, q
           where l.workspace_id = '40e2512f-09b6-433e-97fe-f9999a1f1897'::uuid and l.created_at >= q.created_at),
ledger as (select c.record_kind, c.estimated_cost_usd from public.lead_execution_calls c, q
            where c.task_id = q.task_id or c.logical_call_key like 'kickoff:' || q.id::text || '%'),
rows(k, v) as (
  select 'queue', (select id::text || ' ' || status from q)
  union all select 'task', (select coalesce(status, 'none') from t)
  union all select 'terminal', (select coalesce(result->>'terminal_status', result->'run_outcome'->>'state', 'unknown') from t)
  union all select 'authorization', (select status || ', deadline ' || deadline_at::text from a)
  union all select 'discovered companies', (select coalesce(result->'run_outcome'->'qualification'->'canonical'->>'discovered', '0') from t)
  union all select 'qualified companies', (select count(*)::text from leads where (d->>'qualified')::boolean is true)
  union all select 'pending companies', (select coalesce(result->'run_outcome'->'qualification'->'canonical'->>'pending', '0') from t)
  union all select 'ineligible companies', (select coalesce(result->'run_outcome'->'qualification'->'canonical'->>'ineligible', '0') from t)
  union all select 'provider starts', (select count(*)::text || ' (' || coalesce(string_agg(actor || '=' || coalesce(vendor_status, 'UNRECONCILED'), ', '), '') || ')' from ops where kind = 'provider')
  union all select 'provider committed (worst case)', (select '$' || to_char(coalesce(sum(committed_microusd), 0) / 1e6, 'FM0.000000') from ops where kind = 'provider')
  union all select 'provider charged (Apify receipts)', (select '$' || to_char(coalesce(sum(vendor_microusd), 0) / 1e6, 'FM0.000000') ||
      case when bool_or(vendor_microusd is null) then ' + UNRECONCILED' else '' end from ops where kind = 'provider')
  union all select 'model attempts admitted', (select count(*)::text || ' ($' || to_char(coalesce(sum(committed_microusd), 0) / 1e6, 'FM0.000000') || ' reserved)' from ops where kind = 'model')
  union all select 'model spend (recorded usage)', (select '$' || to_char(coalesce(sum(estimated_cost_usd), 0), 'FM0.000000') || ' over ' || count(*)::text || ' call(s), compile included' from ledger where record_kind = 'model_call')
  union all select 'Apify reads', (select count(*)::text from ops where kind = 'poll')
)
select k, coalesce(v, '—') from rows;
