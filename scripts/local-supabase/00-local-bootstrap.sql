-- EXTENSIONS THE HOSTED PROJECT ALREADY HAD WHEN THE BASELINE WAS DUMPED.
--
-- `20260816120000_baseline_schema.sql` is a pg_dump of the live schema and
-- creates no extensions — production had them first. A fresh local database
-- has to enable them before the dump's defaults and the cron migrations can
-- resolve. Everything here is `if not exists` and local-only; production is
-- untouched by this file (it lives outside supabase/migrations/).
--
-- `pg_cron` and `pg_net` are enabled if this image ships them. They are what
-- the three hosted cron migrations need; when they are unavailable the rebuild
-- script skips those migrations and says so. Nothing in local development
-- depends on a schedule: the sweeper and the monitoring tick are invoked
-- directly.

create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

do $$
begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pg_net unavailable locally (%), hosted cron migrations will be skipped', sqlerrm;
end $$;

do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron unavailable locally (%), hosted cron migrations will be skipped', sqlerrm;
end $$;
