-- THE EVIDENCE FOR ONE ZERO-APIFY REAL-GPT RUN, AS ONE JSON DOCUMENT. Read-only.
-- Run on the TEST project once the run has ended and the authorization is no
-- longer live, then judge it locally:
--
--   psql "$TEST_DB_URL" -X -At -v queue_id='<queue uuid>' \
--     -f scripts/test-project/real-gpt/real-gpt-evidence.sql > evidence.json
--   deno run --allow-read scripts/test-project/real-gpt/judge-real-gpt-run.ts evidence.json
--
-- Ledger rows are tagged `source`: `run` (the queue's task) or `kickoff` (the
-- mission compilation the kickoff transaction recorded under
-- `kickoff:<queue>:…`). Credits and leads are the workspace's since the queue
-- row was created: the TEST workspace is used for nothing else in the window.
with q as (
  select * from public.lead_mission_queue where id = :'queue_id'::uuid
),
a as (
  select au.* from public.discovery_smoke_authorizations au join q on au.queue_id = q.id
),
t as (
  select tk.* from public.tasks tk join q on tk.id = q.task_id
)
select jsonb_build_object(
  'queue', (select jsonb_build_object('id', q.id, 'status', q.status, 'attempts', q.attempts, 'created_at', q.created_at,
                                      'workspace_id', q.workspace_id, 'task_id', q.task_id) from q),
  'authorization', (select jsonb_build_object('status', a.status, 'stop_reason', a.stop_reason, 'deadline_at', a.deadline_at,
                                              'actor_limits', a.actor_limits) from a),
  'lead_mission', (select q.request -> 'lead_mission' from q),
  'execution_plan', (select t.result -> 'capability_execution_state' -> 'execution_plan' from t),
  'terminal', coalesce((select jsonb_agg(x) from t, lateral (select t.result ->> 'terminal_status' as x) s where x is not null), '[]'::jsonb),
  'ledger', coalesce((
    select jsonb_agg(jsonb_build_object(
             'source', case when e.task_id is not distinct from (select task_id from q) then 'run' else 'kickoff' end,
             'record_kind', e.record_kind, 'stage', e.stage, 'actor_id', e.actor_id, 'status', e.status,
             'failure_code', e.failure_code, 'provider_run_id', e.provider_run_id, 'cost_source', e.cost_source,
             'estimated_cost_usd', e.estimated_cost_usd, 'actual_cost_usd', e.actual_cost_usd, 'metadata', e.metadata,
             'logical_call_key', e.logical_call_key, 'started_at', e.started_at) order by e.started_at)
      from public.lead_execution_calls e, q
     where e.workspace_id = q.workspace_id
       and e.record_kind in ('model_call', 'provider_call')
       and (e.task_id = q.task_id or e.logical_call_key like 'kickoff:' || q.id::text || ':%')), '[]'::jsonb),
  'smoke_operations', coalesce((
    select jsonb_agg(jsonb_build_object('kind', o.kind, 'actor', o.actor, 'template_id', o.template_id,
             'committed_microusd', o.committed_microusd, 'reported_microusd', o.reported_microusd,
             'provider_run_id', o.provider_run_id, 'generation', o.generation) order by o.admitted_at)
      from public.discovery_smoke_operations o join a on o.authorization_id = a.id), '[]'::jsonb),
  'credit_transactions', coalesce((
    select jsonb_agg(jsonb_build_object('key', c.idempotency_key, 'status', c.status, 'reserved', c.reserved_credits,
             'actual', c.actual_credits, 'refunded', c.refunded_credits) order by c.created_at)
      from public.credit_transactions c, q
     where c.workspace_id = q.workspace_id and c.created_at >= q.created_at - interval '5 minutes'), '[]'::jsonb),
  'balance', (select jsonb_build_object('balance_credits', b.balance_credits, 'reserved_credits', b.reserved_credits)
                from public.workspace_credit_balances b, q where b.workspace_id = q.workspace_id),
  'leads', (select count(*) from public.lead_candidates l, q where l.workspace_id = q.workspace_id and l.created_at >= q.created_at),
  -- The credit check (smoke-credit-reconciliation.sql), inlined: a run the
  -- admission ledger proves whose credit is not charged. Expected empty.
  'credit_check', coalesce((
    select jsonb_agg(jsonb_build_object('key', ct.idempotency_key, 'status', ct.status, 'run', o.provider_run_id))
      from public.discovery_smoke_operations o
      join a on a.id = o.authorization_id
      join q on true
      join public.lead_execution_calls e on e.task_id = o.task_id and e.workspace_id = q.workspace_id
           and e.record_kind = 'provider_call' and e.provider_id = 'apify'
           and 'apify:' || replace(e.actor_id, '/', '~') = o.actor
      join public.credit_transactions ct on ct.workspace_id = q.workspace_id and ct.idempotency_key = e.logical_call_key
     where o.kind = 'provider' and o.provider_run_id is not null
       and ct.status in ('reserved', 'released', 'not_charged')), '[]'::jsonb)
);
