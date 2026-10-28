-- HELD — NOT APPLIED. Provider discovery: workspace provider connections and
-- the provider usage ledger. See supabase/migrations-held/README.md and
-- docs/PROVIDER_DISCOVERY.md. Not approved for production.
--
-- workspace_provider_connections
--   One row per (workspace, provider). The API key itself lives in Supabase
--   Vault; the row holds only the Vault secret id, which no client role can
--   select. Members can read status, fingerprint, usage and health; nothing
--   else. Writes go through service-only SECURITY DEFINER functions called by
--   the `provider-connections` edge function after it has checked membership
--   and role (connections.ts).
--
-- provider_usage_ledger
--   Every billable provider request reserves credits under an idempotency key
--   unique per workspace. Same contract as memoryLedger (budget.ts):
--   settled → replay the stored result; uncertain → refuse (never re-buy);
--   reserved → refuse (in flight); caps per provider and per mission.

create table public.workspace_provider_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('apollo', 'leadocean', 'apify')),
  status text not null default 'connected' check (status in ('connected', 'invalid', 'error')),
  vault_secret_id uuid not null,
  key_fingerprint text not null check (key_fingerprint ~ '^[0-9a-f]{12}$'),
  usage jsonb,
  last_verified_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 300),
  connected_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider)
);

alter table public.workspace_provider_connections enable row level security;
revoke all on public.workspace_provider_connections from public, anon, authenticated;
-- Column-level: the Vault secret id is not among them.
grant select (id, workspace_id, provider, status, key_fingerprint, usage, last_verified_at, last_error, created_at, updated_at)
  on public.workspace_provider_connections to authenticated;
create policy workspace_provider_connections_member_read on public.workspace_provider_connections
  for select to authenticated using (public.has_workspace_access(auth.uid(), workspace_id));

create table public.provider_usage_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_id text not null,
  provider text not null check (provider in ('apollo', 'leadocean', 'apify')),
  idempotency_key text not null check (length(idempotency_key) between 1 and 400),
  credits_reserved integer not null check (credits_reserved >= 0),
  credits_actual integer check (credits_actual is null or credits_actual >= 0),
  state text not null default 'reserved' check (state in ('reserved', 'settled', 'uncertain', 'released')),
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);
create index provider_usage_ledger_mission on public.provider_usage_ledger (workspace_id, mission_id, provider);

alter table public.provider_usage_ledger enable row level security;
revoke all on public.provider_usage_ledger from public, anon, authenticated;
-- Members may see what their workspace spent, not the stored provider rows.
grant select (id, workspace_id, mission_id, provider, credits_reserved, credits_actual, state, created_at, updated_at)
  on public.provider_usage_ledger to authenticated;
create policy provider_usage_ledger_member_read on public.provider_usage_ledger
  for select to authenticated using (public.has_workspace_access(auth.uid(), workspace_id));

-- ── Connections (service role only) ─────────────────────────────────────────

create function public.provider_connection_store(
  p_workspace uuid, p_provider text, p_secret text, p_fingerprint text, p_usage jsonb, p_actor uuid
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_secret uuid;
begin
  if p_secret is null or length(p_secret) < 8 or length(p_secret) > 512 then
    raise exception 'invalid secret' using errcode = '22023';
  end if;
  select vault_secret_id into v_secret from public.workspace_provider_connections
   where workspace_id = p_workspace and provider = p_provider for update;
  if v_secret is null then
    v_secret := vault.create_secret(p_secret, 'provider:' || p_workspace || ':' || p_provider, 'Agentory provider discovery key');
  else
    perform vault.update_secret(v_secret, p_secret);
  end if;
  insert into public.workspace_provider_connections
    (workspace_id, provider, status, vault_secret_id, key_fingerprint, usage, last_verified_at, last_error, connected_by)
  values (p_workspace, p_provider, 'connected', v_secret, p_fingerprint, p_usage, now(), null, p_actor)
  on conflict (workspace_id, provider) do update set
    status = 'connected', vault_secret_id = excluded.vault_secret_id, key_fingerprint = excluded.key_fingerprint,
    usage = excluded.usage, last_verified_at = now(), last_error = null, connected_by = excluded.connected_by, updated_at = now();
end $$;

create function public.provider_connection_secret(p_workspace uuid, p_provider text) returns text
language sql stable security definer set search_path = '' as $$
  select s.decrypted_secret
    from public.workspace_provider_connections c
    join vault.decrypted_secrets s on s.id = c.vault_secret_id
   where c.workspace_id = p_workspace and c.provider = p_provider and c.status = 'connected';
$$;

create function public.provider_connection_mark(
  p_workspace uuid, p_provider text, p_status text, p_usage jsonb, p_error text
) returns void
language sql security definer set search_path = '' as $$
  update public.workspace_provider_connections
     set status = p_status, usage = coalesce(p_usage, usage), last_error = left(p_error, 300),
         last_verified_at = now(), updated_at = now()
   where workspace_id = p_workspace and provider = p_provider;
$$;

create function public.provider_connection_remove(p_workspace uuid, p_provider text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_secret uuid;
begin
  delete from public.workspace_provider_connections
   where workspace_id = p_workspace and provider = p_provider
  returning vault_secret_id into v_secret;
  if v_secret is not null then
    delete from vault.secrets where id = v_secret;
  end if;
end $$;

-- ── Usage ledger (service role only) ────────────────────────────────────────

create function public.provider_usage_reserve(
  p_workspace uuid, p_mission text, p_provider text, p_key text, p_credits integer,
  p_provider_cap integer, p_mission_cap integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_prior public.provider_usage_ledger;
  v_provider_spent integer;
  v_mission_spent integer;
begin
  -- One reservation at a time per workspace + mission, so caps are exact.
  perform pg_advisory_xact_lock(hashtextextended(p_workspace::text || ':' || p_mission, 0));
  select * into v_prior from public.provider_usage_ledger where workspace_id = p_workspace and idempotency_key = p_key;
  if found then
    if v_prior.state = 'settled' then return jsonb_build_object('ok', true, 'replay', true, 'result', v_prior.result); end if;
    if v_prior.state = 'uncertain' then return jsonb_build_object('ok', false, 'reason', 'charge_uncertain'); end if;
    if v_prior.state = 'reserved' then return jsonb_build_object('ok', false, 'reason', 'in_flight'); end if;
    -- released: the key may be reserved again.
    delete from public.provider_usage_ledger where id = v_prior.id;
  end if;
  select coalesce(sum(case state when 'settled' then coalesce(credits_actual, credits_reserved) when 'released' then 0 else credits_reserved end), 0)
    into v_provider_spent from public.provider_usage_ledger
   where workspace_id = p_workspace and mission_id = p_mission and provider = p_provider;
  if v_provider_spent + p_credits > p_provider_cap then return jsonb_build_object('ok', false, 'reason', 'provider_cap'); end if;
  select coalesce(sum(case state when 'settled' then coalesce(credits_actual, credits_reserved) when 'released' then 0 else credits_reserved end), 0)
    into v_mission_spent from public.provider_usage_ledger
   where workspace_id = p_workspace and mission_id = p_mission;
  if v_mission_spent + p_credits > p_mission_cap then return jsonb_build_object('ok', false, 'reason', 'mission_cap'); end if;
  insert into public.provider_usage_ledger (workspace_id, mission_id, provider, idempotency_key, credits_reserved)
  values (p_workspace, p_mission, p_provider, p_key, p_credits);
  return jsonb_build_object('ok', true, 'replay', false);
end $$;

create function public.provider_usage_finish(
  p_workspace uuid, p_key text, p_state text, p_actual integer, p_result jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_state not in ('settled', 'uncertain', 'released') then
    raise exception 'invalid state %', p_state using errcode = '22023';
  end if;
  -- Only an in-flight reservation can finish; a settled or uncertain one is final.
  update public.provider_usage_ledger
     set state = p_state, credits_actual = case when p_state = 'settled' then p_actual else credits_actual end,
         result = case when p_state = 'settled' then p_result else null end, updated_at = now()
   where workspace_id = p_workspace and idempotency_key = p_key and state = 'reserved';
end $$;

revoke all on function public.provider_connection_store(uuid, text, text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.provider_connection_secret(uuid, text) from public, anon, authenticated;
revoke all on function public.provider_connection_mark(uuid, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.provider_connection_remove(uuid, text) from public, anon, authenticated;
revoke all on function public.provider_usage_reserve(uuid, text, text, text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.provider_usage_finish(uuid, text, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.provider_connection_store(uuid, text, text, text, jsonb, uuid) to service_role;
grant execute on function public.provider_connection_secret(uuid, text) to service_role;
grant execute on function public.provider_connection_mark(uuid, text, text, jsonb, text) to service_role;
grant execute on function public.provider_connection_remove(uuid, text) to service_role;
grant execute on function public.provider_usage_reserve(uuid, text, text, text, integer, integer, integer) to service_role;
grant execute on function public.provider_usage_finish(uuid, text, text, integer, jsonb) to service_role;
