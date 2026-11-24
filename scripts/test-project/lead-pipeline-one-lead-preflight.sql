-- ONE-LEAD-PER-COMPANY PREFLIGHT (read-only). Run before applying
-- supabase/migrations-held/20261108120000_lead_pipeline_one_lead_per_company.sql:
--   psql "$DB_URL" -X -At -F ' ' -f scripts/test-project/lead-pipeline-one-lead-preflight.sql
-- Lists every (workspace, account) that already holds more than one 'lead_pipeline' lead.
-- The migration refuses to apply while any exist; it never deletes or merges a lead. Each
-- listed pair needs a human decision (which lead is kept), recorded before the migration is
-- approved. It also counts pipeline leads with no account, which the index does not constrain.
-- Clean project: a first line "OK 0 duplicate pairs".
begin transaction read only;
with dup as (
  select workspace_id, account_id, count(*) as leads, array_agg(id order by created_at) as lead_ids
    from public.lead_candidates
   where lead_type = 'lead_pipeline' and account_id is not null
   group by workspace_id, account_id having count(*) > 1
)
select case when count(*) = 0 then 'OK' else 'DUPLICATES' end, count(*), 'duplicate pairs' from dup
union all
select 'PAIR', leads, workspace_id::text || ' ' || account_id::text || ' ' || lead_ids::text from dup;

-- Informational: pipeline leads with no account (the unique index ignores them).
select 'INFO', count(*), 'lead_pipeline leads with no account_id (not constrained)'
  from public.lead_candidates where lead_type = 'lead_pipeline' and account_id is null;
rollback;
