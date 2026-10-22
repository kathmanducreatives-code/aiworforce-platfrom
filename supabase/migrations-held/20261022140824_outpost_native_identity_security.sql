-- HELD / DISABLED. Local disposable proof only; hosted application not approved.
-- Identity boundary only. No model, import, review, export, dispatch or writer RPC.
-- Reuses workspace_members roles and the original P1-signed task, not a new ACL.
-- Managed auth.sessions must exist; the test-only shim is NOT part of this migration.
do $$ begin
  if to_regclass('auth.sessions') is null then
    raise exception 'auth.sessions is required; do not synthesize managed auth in a real project';
  end if;
end $$;

create schema outpost_private;
revoke all on schema outpost_private from public, anon, authenticated, service_role;
alter default privileges in schema outpost_private revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema outpost_private revoke execute on functions from public, anon, authenticated, service_role;

create table outpost_private.clients (
  workspace_id uuid primary key references public.workspaces(id) on delete restrict,
  client_binding_id uuid not null unique,
  seller_domain text not null check (length(seller_domain) between 1 and 253),
  configuration_version integer not null check (configuration_version > 0),
  customer_enabled boolean not null default false check (customer_enabled = false),
  unique (workspace_id, client_binding_id)
);
create table outpost_private.task_bindings (
  workspace_id uuid not null,
  client_binding_id uuid not null,
  task_id uuid not null unique references public.tasks(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  session_id uuid not null,
  -- Captured by native trigger from the real parent, never accepted from a browser.
  task_snapshot jsonb not null,
  primary key (workspace_id, client_binding_id, task_id),
  unique (workspace_id, client_binding_id, task_id, actor_id),
  foreign key (workspace_id, client_binding_id)
    references outpost_private.clients(workspace_id, client_binding_id) on delete restrict
);

-- Narrow boolean predicate only. Private fixed-name lookups; no dynamic SQL,
-- arbitrary principal parameter, user_metadata ACL, data projection or writer.
-- Definer is needed because app roles must not SELECT the managed auth catalog.
-- Deployment review must verify the owner/grants and effective policies explicitly.
create function outpost_private.current_member_session(p_workspace uuid, p_actor uuid, p_session uuid default null)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare c jsonb; u uuid; sid uuid; ts timestamptz;
begin
  -- Fail closed for transaction snapshots that could retain revoked membership.
  if current_setting('transaction_isolation') <> 'read committed' then return false; end if;
  c := auth.jwt(); u := auth.uid(); ts := clock_timestamp();
  if u is null or u is distinct from p_actor or c->>'role' is distinct from 'authenticated'
    or (c ? 'is_anonymous' and c->'is_anonymous' is distinct from 'false'::jsonb)
    or coalesce(c->>'exp', '') !~ '^[0-9]{1,12}$'
  then return false; end if;
  if (c->>'exp')::bigint <= extract(epoch from ts) then return false; end if;
  sid := (c->>'session_id')::uuid;
  if sid is null or (p_session is not null and sid <> p_session) then return false; end if;
  return exists (
    select 1 from auth.sessions s where s.id = sid and s.user_id = u
      and (s.not_after is null or s.not_after > ts)
  ) and exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace and m.user_id = u and m.role::text in ('owner', 'admin')
  );
exception when invalid_text_representation or numeric_value_out_of_range then
  return false;
end;
$$;
revoke all on function outpost_private.current_member_session(uuid,uuid,uuid) from public, anon, authenticated, service_role;

create function outpost_private.task_is_current(p_workspace uuid, p_client uuid, p_task uuid,
  p_actor uuid, p_session uuid, p_snapshot jsonb)
returns boolean language sql volatile security definer set search_path = '' as $$
  select outpost_private.current_member_session(p_workspace, p_actor, p_session)
    and exists(select 1 from public.tasks t
      where t.id = p_task and t.workspace_id = p_workspace and t.user_id = p_actor
        and t.status = 'ready' and to_jsonb(t) = p_snapshot
        and t.payload->'pilot_scope'->'claims'->>'client_binding_id' = p_client::text);
$$;
revoke all on function outpost_private.task_is_current(uuid,uuid,uuid,uuid,uuid,jsonb) from public, anon, authenticated, service_role;

create function outpost_private.capture_task_parent() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t public.tasks%rowtype; s auth.sessions%rowtype;
begin
  select * into t from public.tasks where id = new.task_id for share;
  if not found or t.workspace_id is distinct from new.workspace_id or t.user_id is distinct from new.actor_id
    or t.status is distinct from 'ready' then
    raise exception 'pilot task parent refused' using errcode='42501';
  end if;
  -- The application must run the existing P1 HMAC verifier before registering.
  -- Native constraints bind to that exact task image; this is NOT a second verifier.
  if (t.payload->>'execution_mode' = 'pilot_draft_only'
    and t.payload->'pilot_scope'->'claims'->>'version' = '1'
    and t.payload->'pilot_scope'->'claims'->>'mode' = 'draft_only'
    and t.payload->'pilot_scope'->'claims'->>'workspace_id' = new.workspace_id::text
    and t.payload->'pilot_scope'->'claims'->>'client_binding_id' = new.client_binding_id::text
    and t.payload->'pilot_scope'->'claims'->>'task_id' = new.task_id::text
    and t.payload->'pilot_scope'->'claims'->>'principal_user_id' = new.actor_id::text
    and t.payload->'pilot_scope'->>'mac' ~ '^[0-9a-f]{64}$') is distinct from true then
    raise exception 'original P1 task binding required' using errcode='42501';
  end if;
  perform 1 from public.workspace_members m where m.workspace_id = new.workspace_id
    and m.user_id = new.actor_id and m.role::text in ('owner','admin') for share;
  if not found then raise exception 'pilot task membership refused' using errcode='42501'; end if;
  select * into s from auth.sessions where id = new.session_id and user_id = new.actor_id for share;
  if not found or (s.not_after is not null and s.not_after <= clock_timestamp()) then
    raise exception 'pilot task session refused' using errcode='42501';
  end if;
  new.task_snapshot := to_jsonb(t);
  return new;
end;
$$;
revoke all on function outpost_private.capture_task_parent() from public, anon, authenticated, service_role;
create trigger capture_task_parent before insert on outpost_private.task_bindings
  for each row execute function outpost_private.capture_task_parent();

-- MUTATION_OWNER_GUARD_BEGIN
-- Coordinated DB contract: no executor/worker code is changed. Without this,
-- A->B->A ownership reassignment can restore an identical task image. Parent
-- registration's FOR SHARE lock serializes against concurrent UPDATEs.
create function outpost_private.keep_bound_task_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.workspace_id is distinct from old.workspace_id or new.user_id is distinct from old.user_id)
    and exists(select 1 from outpost_private.task_bindings b where b.task_id = old.id)
  then raise exception 'bound pilot task ownership is immutable' using errcode='42501'; end if;
  return new;
end;
$$;
revoke all on function outpost_private.keep_bound_task_owner() from public, anon, authenticated, service_role;
create trigger outpost_bound_task_owner before update of workspace_id, user_id on public.tasks
  for each row execute function outpost_private.keep_bound_task_owner();
-- MUTATION_OWNER_GUARD_END

create function outpost_private.refuse_identity_mutation() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin raise exception 'immutable pilot identity' using errcode='42501'; end;
$$;
revoke all on function outpost_private.refuse_identity_mutation() from public, anon, authenticated, service_role;
create trigger clients_immutable before update or delete on outpost_private.clients
  for each row execute function outpost_private.refuse_identity_mutation();
create trigger bindings_immutable before update or delete on outpost_private.task_bindings
  for each row execute function outpost_private.refuse_identity_mutation();
create trigger clients_no_truncate before truncate on outpost_private.clients
  for each statement execute function outpost_private.refuse_identity_mutation();
create trigger bindings_no_truncate before truncate on outpost_private.task_bindings
  for each statement execute function outpost_private.refuse_identity_mutation();

alter table outpost_private.clients enable row level security;
alter table outpost_private.clients force row level security;
alter table outpost_private.task_bindings enable row level security;
alter table outpost_private.task_bindings force row level security;
revoke all on all tables in schema outpost_private from public, anon, authenticated, service_role;
grant usage on schema outpost_private to authenticated;
grant execute on function outpost_private.current_member_session(uuid,uuid,uuid) to authenticated;
grant execute on function outpost_private.task_is_current(uuid,uuid,uuid,uuid,uuid,jsonb) to authenticated;
grant select on outpost_private.clients, outpost_private.task_bindings to authenticated;
create policy clients_current_owner_read on outpost_private.clients for select to authenticated
  using (outpost_private.current_member_session(workspace_id, (select auth.uid()), null));
create policy original_task_session_read on outpost_private.task_bindings for select to authenticated
  using (outpost_private.task_is_current(workspace_id, client_binding_id, task_id, actor_id, session_id, task_snapshot));

-- No role gets application writes, registration RPC, model execution or export.
-- Private schema must NOT be exposed by the hosted PostgREST configuration.
-- Superusers/BYPASSRLS remain privileged; service role lacks schema/table grants.
