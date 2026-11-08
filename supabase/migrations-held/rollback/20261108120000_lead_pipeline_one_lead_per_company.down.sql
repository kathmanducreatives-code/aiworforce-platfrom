-- Rollback of 20261108120000_lead_pipeline_one_lead_per_company.sql. Data is untouched.
drop function if exists public.lead_pipeline_persist_lead(uuid, jsonb, jsonb, jsonb, uuid);
drop index if exists public.lead_candidates_pipeline_account_uniq;
