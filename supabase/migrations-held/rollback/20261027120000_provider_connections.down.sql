-- Rollback for 20261027120000_provider_connections.sql. HELD, like it.
--
-- REFUSES while any usage-ledger row exists: those rows are the only durable
-- record of what a workspace's provider keys may have been charged for,
-- including uncertain charges nobody has reconciled. Before rolling back after
-- use: turn PROVIDER_DISCOVERY_ENABLED off, reconcile every `uncertain` and
-- `reserved` row against the provider's own usage page, export the table, and
-- get an explicit archival decision. Keeping the inactive schema is the default.
--
-- Connections are removed WITH their Vault secrets, so no orphaned key stays
-- in Vault. Rolling back cannot reopen spending: both edge functions fail
-- closed (503) without these functions, and answer 404 with the flag off.
-- One transaction.
begin;
do $$ begin
  if exists (select 1 from public.provider_usage_ledger) then
    raise exception 'provider usage ledger rows exist: reconcile, export and approve archival before rollback';
  end if;
end $$;
delete from vault.secrets where id in (select vault_secret_id from public.workspace_provider_connections);
drop function public.provider_usage_finish(uuid, text, text, integer, jsonb);
drop function public.provider_usage_reserve(uuid, text, text, text, integer, integer, integer);
drop function public.provider_connection_remove(uuid, text);
drop function public.provider_connection_mark(uuid, text, text, jsonb, text);
drop function public.provider_connection_secret(uuid, text);
drop function public.provider_connection_store(uuid, text, text, text, jsonb, uuid);
drop table public.provider_usage_ledger;
drop table public.workspace_provider_connections;
commit;
