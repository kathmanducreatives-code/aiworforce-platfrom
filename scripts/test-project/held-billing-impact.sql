-- WHAT THE TWO HELD BILLING FIXES WOULD CHANGE, MEASURED BEFORE THEY ARE INSTALLED.
-- Read-only. Safe on TEST or production; it references no column either
-- migration adds. Run by the database owner as part of the approval:
--
--   psql "$DB_URL" -v days=30 -f scripts/test-project/held-billing-impact.sql
--
--   20261015130000 credits_rearm_settled_key: a refunded key really bought again is charged.
--   20261022120000 credits_reaper_charges_confirmed_purchase: a stale reservation whose
--                  provider call names a run id is charged, not released.
--
-- Each row: the effect, how many transactions, how many credits, and the
-- distinct workspaces affected. Zero rows of evidence is a valid answer.
with params as (select make_interval(days => :days) as win),
-- A provider-call ledger row that names a run, per (workspace, task, logical call).
confirmed as (
  select distinct e.workspace_id, e.task_id, e.logical_call_key
    from public.lead_execution_calls e
   where e.record_kind = 'provider_call'
     and length(btrim(coalesce(e.provider_run_id, ''))) > 0
),
-- 1. Past reaper releases that the reaper fix would have CHARGED instead.
reaped_confirmed as (
  select t.* from public.credit_transactions t, params
   where t.status = 'released' and t.reason = 'stale reservation released by reaper'
     and t.kind in ('provider_call', 'monitoring_call')
     and t.finalized_at >= now() - params.win
     and exists (select 1 from confirmed c where c.workspace_id = t.workspace_id
                   and c.logical_call_key = t.idempotency_key and c.task_id is not distinct from t.task_id)
),
-- 2. Reservations the FIRST reaper tick after install would charge (stale now, run confirmed).
stale_confirmed as (
  select t.* from public.credit_transactions t
   where t.status = 'reserved' and t.created_at < now() - interval '30 minutes'
     and t.kind in ('provider_call', 'monitoring_call')
     and exists (select 1 from confirmed c where c.workspace_id = t.workspace_id
                   and c.logical_call_key = t.idempotency_key and c.task_id is not distinct from t.task_id)
),
-- 3. Stale reservations it would still RELEASE (no run id: uncertain or unused).
stale_released as (
  select t.* from public.credit_transactions t
   where t.status = 'reserved' and t.created_at < now() - interval '30 minutes'
     and not exists (select 1 from stale_confirmed s where s.id = t.id)
),
-- 4. Refunded keys whose call later ran (a ledger attempt named a run after the refund):
--    the re-arm fix would have charged these purchases; today they replay at 0.
refunded_then_bought as (
  select t.* from public.credit_transactions t, params
   where t.status in ('not_charged', 'released')
     and t.kind in ('provider_call', 'monitoring_call')
     and t.finalized_at >= now() - params.win
     and exists (select 1 from public.lead_execution_calls e
                  where e.workspace_id = t.workspace_id and e.logical_call_key = t.idempotency_key
                    and e.record_kind = 'provider_call' and e.started_at > t.finalized_at
                    and length(btrim(coalesce(e.provider_run_id, ''))) > 0)
)
select 'reaper: past releases that would have been charged' as effect, count(*) as transactions,
       coalesce(sum(reserved_credits), 0) as credits, count(distinct workspace_id) as workspaces from reaped_confirmed
union all
select 'reaper: charged at the first tick after install', count(*), coalesce(sum(reserved_credits), 0), count(distinct workspace_id) from stale_confirmed
union all
select 'reaper: still released at the first tick (unchanged)', count(*), coalesce(sum(reserved_credits), 0), count(distinct workspace_id) from stale_released
union all
select 're-arm: refunded keys later bought (charged going forward)', count(*), coalesce(sum(reserved_credits), 0), count(distinct workspace_id) from refunded_then_bought;
