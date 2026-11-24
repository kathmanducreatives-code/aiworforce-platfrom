-- Run after assertions.sql on the same disposable database: the rollback must
-- refuse while ledger rows exist, and succeed (removing Vault secrets) once
-- they are archived.
\set ON_ERROR_STOP off
\i supabase/migrations-held/rollback/20261027120000_provider_connections.down.sql
\set ON_ERROR_STOP on
do $$ begin
  if to_regclass('public.provider_usage_ledger') is null then raise exception 'rollback ran despite ledger rows'; end if;
end $$;
delete from public.provider_usage_ledger;  -- stands in for the archival decision
\i supabase/migrations-held/rollback/20261027120000_provider_connections.down.sql
do $$ begin
  if to_regclass('public.workspace_provider_connections') is not null then raise exception 'rollback left the table'; end if;
  if exists (select 1 from vault.secrets where name like 'provider:%') then raise exception 'rollback left a Vault secret'; end if;
end $$;
select 'provider_connections rollback: refused with ledger rows, clean without' as result;
