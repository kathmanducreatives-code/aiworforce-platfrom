-- Assertions for the held migration 20261027120000_provider_connections.sql.
-- Run by check.sh on a disposable database. Each block raises on failure.
\set ON_ERROR_STOP on
set client_min_messages = warning;

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'owner-a@test.invalid'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'owner-b@test.invalid');
insert into public.workspaces (id, name) values
  ('11111111-1111-4111-8111-111111111111', 'A'), ('22222222-2222-4222-8222-222222222222', 'B');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner'),
  ('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-0000-4000-8000-000000000002', 'owner');

-- 1. The service role stores a key; it lands in Vault, not in the row.
set role service_role;
select public.provider_connection_store('11111111-1111-4111-8111-111111111111', 'leadocean', 'lo_live_SECRET_123456', 'abcdef012345', '{"remaining":900}', 'aaaaaaaa-0000-4000-8000-000000000001');
select public.provider_connection_store('11111111-1111-4111-8111-111111111111', 'leadocean', 'lo_live_ROTATED_654321', 'fedcba543210', '{"remaining":800}', 'aaaaaaaa-0000-4000-8000-000000000001');
do $$ begin
  if public.provider_connection_secret('11111111-1111-4111-8111-111111111111', 'leadocean') <> 'lo_live_ROTATED_654321' then raise exception 'rotation did not replace the key'; end if;
  if public.provider_connection_secret('22222222-2222-4222-8222-222222222222', 'leadocean') is not null then raise exception 'another workspace reads the key'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from vault.secrets) <> 1 then raise exception 'rotation leaked a second Vault secret'; end if;
  if exists (select 1 from public.workspace_provider_connections where row_to_json(workspace_provider_connections)::text like '%SECRET%' or row_to_json(workspace_provider_connections)::text like '%ROTATED%') then raise exception 'key value in the row'; end if;
end $$;

-- 2. A member reads status but never the Vault id or the key; a non-member reads nothing.
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', false);
do $$ begin
  if (select count(*) from public.workspace_provider_connections) <> 1 then raise exception 'member cannot read status'; end if;
  begin
    perform vault_secret_id from public.workspace_provider_connections;
    raise exception 'member read vault_secret_id';
  exception when insufficient_privilege then null; end;
  begin
    perform public.provider_connection_secret('11111111-1111-4111-8111-111111111111', 'leadocean');
    raise exception 'member called the secret reader';
  exception when insufficient_privilege then null; end;
  begin
    perform public.provider_connection_store('11111111-1111-4111-8111-111111111111', 'apollo', 'x_test_123456', 'abcdef012345', null, null);
    raise exception 'member called the store';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from vault.decrypted_secrets;
    raise exception 'member read vault';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.workspace_provider_connections (workspace_id, provider, vault_secret_id, key_fingerprint)
    values ('11111111-1111-4111-8111-111111111111', 'apollo', gen_random_uuid(), 'abcdef012345');
    raise exception 'member wrote a connection row';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', false);
do $$ begin
  if (select count(*) from public.workspace_provider_connections) <> 0 then raise exception 'another workspace sees the connection'; end if;
end $$;
reset role;

-- 3. Ledger: caps, replay, uncertain blocks a retry, workspace-scoped keys.
set role service_role;
do $$
declare r jsonb;
begin
  r := public.provider_usage_reserve('11111111-1111-4111-8111-111111111111', 'm1', 'leadocean', 'k1', 10, 20, 20);
  if r <> '{"ok": true, "replay": false}'::jsonb then raise exception 'reserve: %', r; end if;
  r := public.provider_usage_reserve('11111111-1111-4111-8111-111111111111', 'm1', 'leadocean', 'k1', 10, 20, 20);
  if r ->> 'reason' <> 'in_flight' then raise exception 'in flight: %', r; end if;
  perform public.provider_usage_finish('11111111-1111-4111-8111-111111111111', 'k1', 'settled', 15, '{"rows":10}');
  r := public.provider_usage_reserve('11111111-1111-4111-8111-111111111111', 'm1', 'leadocean', 'k1', 10, 20, 20);
  if not (r -> 'replay')::boolean or r -> 'result' <> '{"rows":10}'::jsonb then raise exception 'replay: %', r; end if;
  r := public.provider_usage_reserve('11111111-1111-4111-8111-111111111111', 'm1', 'leadocean', 'k2', 10, 20, 20);
  if r ->> 'reason' <> 'provider_cap' then raise exception 'cap after overbilling: %', r; end if;
  r := public.provider_usage_reserve('11111111-1111-4111-8111-111111111111', 'm1', 'apify', 'k3', 6, 10, 20);
  if r ->> 'reason' <> 'mission_cap' then raise exception 'mission cap: %', r; end if;
  r := public.provider_usage_reserve('11111111-1111-4111-8111-111111111111', 'm1', 'apify', 'k4', 1, 10, 20);
  perform public.provider_usage_finish('11111111-1111-4111-8111-111111111111', 'k4', 'uncertain', null, null);
  r := public.provider_usage_reserve('11111111-1111-4111-8111-111111111111', 'm1', 'apify', 'k4', 1, 10, 20);
  if r ->> 'reason' <> 'charge_uncertain' then raise exception 'uncertain: %', r; end if;
  -- Finishing a final entry again changes nothing.
  perform public.provider_usage_finish('11111111-1111-4111-8111-111111111111', 'k4', 'settled', 0, '{}');
  if (select state from public.provider_usage_ledger where idempotency_key = 'k4') <> 'uncertain' then raise exception 'uncertain was overwritten'; end if;
  -- The same key in another workspace is a different reservation.
  r := public.provider_usage_reserve('22222222-2222-4222-8222-222222222222', 'm1', 'leadocean', 'k1', 10, 20, 20);
  if r <> '{"ok": true, "replay": false}'::jsonb then raise exception 'cross-workspace key: %', r; end if;
end $$;
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', false);
do $$ begin
  if (select count(*) from public.provider_usage_ledger) <> 1 then raise exception 'ledger rows leak across workspaces'; end if;
  begin perform result from public.provider_usage_ledger; raise exception 'member read stored provider rows';
  exception when insufficient_privilege then null; end;
  begin perform public.provider_usage_reserve('22222222-2222-4222-8222-222222222222', 'm1', 'leadocean', 'kx', 0, 0, 0); raise exception 'member reserved';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 4. Disconnect removes the row AND the Vault secret.
set role service_role;
select public.provider_connection_remove('11111111-1111-4111-8111-111111111111', 'leadocean');
reset role;
do $$ begin
  if exists (select 1 from vault.secrets) then raise exception 'disconnect left the key in Vault'; end if;
  if exists (select 1 from public.workspace_provider_connections) then raise exception 'disconnect left the row'; end if;
end $$;
-- 5. A member can neither update nor delete status rows; the service role can read them.
set role service_role;
select public.provider_connection_store('11111111-1111-4111-8111-111111111111', 'apollo', 'ap_test_KEY_123456', 'abcdef012345', null, 'aaaaaaaa-0000-4000-8000-000000000001');
do $$ begin
  if (select count(*) from public.workspace_provider_connections where provider = 'apollo') <> 1 then raise exception 'service role cannot read status'; end if;
end $$;
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', false);
do $$ begin
  begin update public.workspace_provider_connections set status = 'connected'; raise exception 'member updated a row';
  exception when insufficient_privilege then null; end;
  begin delete from public.workspace_provider_connections; raise exception 'member deleted a row';
  exception when insufficient_privilege then null; end;
  begin update public.provider_usage_ledger set state = 'released'; raise exception 'member released a ledger entry';
  exception when insufficient_privilege then null; end;
  begin perform public.provider_usage_finish('11111111-1111-4111-8111-111111111111', 'k4', 'released', null, null); raise exception 'member finished a ledger entry';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
-- anon reaches nothing.
set role anon;
do $$ begin
  begin perform 1 from public.workspace_provider_connections; raise exception 'anon read connections';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select 'provider_connections assertions: all passed' as result;
