-- THE SMOKE'S CREDIT CHECK: a provider purchase the admission ledger proves
-- (it names a run) whose customer credit is NOT charged. Read-only. Run beside
-- smoke-reconciliation.sql, once the authorization is no longer live:
--
--   psql "$TEST_DB_URL" -v queue_id='<queue uuid>' -f scripts/test-project/smoke-credit-reconciliation.sql
--
-- WHY IT EXISTS. A worker that dies after the gate recorded a run but before
-- the execution ledger saved its run id leaves the credit `reserved`. A later
-- slice adopts the run and charges it (PR #154). If none does within the
-- authorization's window, nothing will: the stale reaper confirms purchases
-- from the execution ledger only (held 20261022120000), finds no run id there,
-- and RELEASES the credit after 30 minutes. The USD liability is unaffected
-- (smoke-reconciliation.sql still lists it); only the internal credit is wrong.
--
-- Joined exactly, never by guess: the credit's key is the execution-ledger
-- call's `logical_call_key`; that call's `actor_id` is the admission actor the
-- gate derived from the same request (`apify:<owner>~<actor>`), on the same task.
--
-- `credit_status`:
--   reserved     still held: run this after the reaper window, or correct it now;
--   released     refunded by the reaper although the run exists;
--   not_charged  settled as never started although the run exists.
--
-- CORRECTION (operator, service role, with the held re-arm fix 20261015130000
-- installed): re-arm the key, balance-checked, then charge it:
--   select public.credits_reserve('<workspace>', <reserved_credits>, '<idempotency_key>', 'provider_call', '<task>', null);
--   select public.credits_finalize('<transaction_id>', <reserved_credits>, 'charged',
--     'operator: run <provider_run_id> confirmed by the smoke admission ledger');
-- A still-`reserved` row needs only the finalize. An empty result means every
-- proven purchase of this mission is charged. Exits 0 either way.
select t.id                 as transaction_id,
       t.workspace_id,
       t.task_id,
       t.idempotency_key,
       t.status             as credit_status,
       t.reserved_credits,
       t.actual_credits,
       o.actor,
       o.provider_run_id,
       o.operation_key
  from public.discovery_smoke_operations o
  join public.discovery_smoke_authorizations a on a.id = o.authorization_id
  join public.lead_mission_queue q on q.id = a.queue_id
  join lateral (
        select distinct e.logical_call_key, e.workspace_id
          from public.lead_execution_calls e
         where e.task_id = o.task_id
           and e.workspace_id = q.workspace_id
           and e.record_kind = 'provider_call'
           and e.provider_id = 'apify'
           and 'apify:' || replace(e.actor_id, '/', '~') = o.actor
       ) c on true
  join public.credit_transactions t
    on t.workspace_id = c.workspace_id and t.idempotency_key = c.logical_call_key
 where a.queue_id = :'queue_id'::uuid
   and o.kind = 'provider'
   and o.provider_run_id is not null
   and t.status in ('reserved', 'released', 'not_charged')
 order by o.admitted_at;
