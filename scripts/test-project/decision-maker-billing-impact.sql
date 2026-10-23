-- WHAT THE DECISION-MAKER PRICING FIXES WOULD HAVE CHARGED, MEASURED FROM HISTORY.
-- Read-only. Safe on TEST or production:
--
--   psql "$DB_URL" -v days=90 -f scripts/test-project/decision-maker-billing-impact.sql
--
-- Before the fixes every people search in one lead action shares one credit
-- key, `<task>:person_resolution:no-hash`, and the execution ledger records
-- each search under that same `logical_call_key`. So, per action:
--   charged_today   what the transaction actually took (1 credit if any search started);
--   with_quote_fix  #156 alone: the quoted price, once per action;
--   with_per_row    #156 + per-row billing: the quoted price per row whose search started.
-- A "row" is a distinct company (LinkedIn URL, else domain, else name) with a
-- started search (a provider run id). The quoted price is passed in:
--   -v price=2   (creditPricing.ts `find_decision_makers`)
with params as (select make_interval(days => :days) as win, :price::int as price),
actions as (
  select t.id, t.workspace_id, t.task_id, t.idempotency_key, t.status, t.actual_credits, t.created_at
    from public.credit_transactions t, params
   where t.kind = 'provider_call'
     and t.idempotency_key like '%:person_resolution:no-hash'
     and t.created_at >= now() - params.win
),
per_action as (
  select a.*,
         (select count(distinct coalesce(e.request_input->>'company_linkedin_url', e.request_input->>'domain',
                                         e.request_input->>'company_name'))
            from public.lead_execution_calls e
           where e.workspace_id = a.workspace_id and e.logical_call_key = a.idempotency_key
             and e.record_kind = 'provider_call'
             and length(btrim(coalesce(e.provider_run_id, ''))) > 0) as started_rows
    from actions a
)
select count(*)                                                     as actions,
       coalesce(sum(started_rows), 0)                               as started_rows,
       count(*) filter (where started_rows > 1)                     as multi_row_actions,
       coalesce(sum(actual_credits), 0)                             as charged_today,
       coalesce(sum(case when started_rows > 0 then (select price from params) else 0 end), 0) as with_quote_fix,
       coalesce(sum(started_rows * (select price from params)), 0)  as with_per_row,
       count(distinct workspace_id)                                 as workspaces
  from per_action;
