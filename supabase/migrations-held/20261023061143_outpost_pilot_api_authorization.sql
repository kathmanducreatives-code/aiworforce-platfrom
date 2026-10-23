-- HELD. Owned pilot/API containment only. No shared client/Brain schema change.
-- Requires #151 identity foundation. Never apply to hosted targets without approval.
create function outpost_private.api_access(p_workspace uuid, p_client uuid, p_version integer, p_task uuid)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare b outpost_private.task_bindings%rowtype; ts timestamptz; role_name text;
begin
  if current_setting('transaction_isolation') <> 'read committed' then return false; end if;
  -- The legacy workspace Brain is unambiguous ONLY under the existing one-client
  -- foundation. Do not enable multi-client by dropping its uniqueness alone.
  if (select count(*) from outpost_private.clients where workspace_id=p_workspace) <> 1
    or not exists(select 1 from outpost_private.clients where workspace_id=p_workspace
      and client_binding_id=p_client and configuration_version=p_version) then return false; end if;
  role_name := auth.jwt()->>'role';
  if p_task is null then
    return role_name='authenticated' and exists(
      select 1 from outpost_private.task_bindings t where t.workspace_id=p_workspace
        and t.client_binding_id=p_client and t.actor_id=auth.uid()
        and outpost_private.task_is_current(t.workspace_id,t.client_binding_id,t.task_id,t.actor_id,t.session_id,t.task_snapshot));
  end if;
  select * into b from outpost_private.task_bindings where workspace_id=p_workspace
    and client_binding_id=p_client and task_id=p_task;
  if not found then return false; end if;
  if role_name='authenticated' then
    return outpost_private.task_is_current(b.workspace_id,b.client_binding_id,b.task_id,b.actor_id,b.session_id,b.task_snapshot);
  elsif role_name='service_role' then
    -- Service execution retains only the already-registered original principal.
    -- API still MUST verify the original P1 HMAC before releasing any content.
    ts:=clock_timestamp();
    return exists(select 1 from auth.sessions s where s.id=b.session_id and s.user_id=b.actor_id
        and (s.not_after is null or s.not_after>ts))
      and exists(select 1 from public.workspace_members m where m.workspace_id=b.workspace_id
        and m.user_id=b.actor_id and m.role::text in ('owner','admin'))
      and exists(select 1 from public.tasks t where t.id=b.task_id and t.workspace_id=b.workspace_id
        and t.user_id=b.actor_id and t.status='ready' and to_jsonb(t)=b.task_snapshot);
  end if;
  return false;
end;
$$;
revoke all on function outpost_private.api_access(uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;

create function public.outpost_pilot_access(p_workspace uuid, p_client uuid, p_version integer, p_task uuid default null)
returns boolean language sql volatile security definer set search_path='' as $$
  select outpost_private.api_access(p_workspace,p_client,p_version,p_task);
$$;
revoke all on function public.outpost_pilot_access(uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.outpost_pilot_access(uuid,uuid,integer,uuid) to authenticated,service_role;

-- Existence lookups MUST bypass caller-private RLS. An invisible foreign binding
-- must never be classified as an ordinary nonpilot task. No row content returned.
create function outpost_private.public_task_read(p_task uuid)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare b outpost_private.task_bindings%rowtype; t public.tasks%rowtype;
begin
  select * into b from outpost_private.task_bindings where task_id=p_task;
  if found then return outpost_private.api_access(b.workspace_id,b.client_binding_id,
    (select configuration_version from outpost_private.clients where workspace_id=b.workspace_id and client_binding_id=b.client_binding_id),p_task); end if;
  select * into t from public.tasks where id=p_task;
  return found and coalesce(t.payload->>'execution_mode','')<>'pilot_draft_only'
    and not coalesce(t.payload ? 'pilot_scope',false);
end;
$$;
create function outpost_private.public_task_write(p_task uuid,p_payload jsonb)
returns boolean language sql volatile security definer set search_path='' as $$
  select coalesce(p_payload->>'execution_mode','')<>'pilot_draft_only'
    and not coalesce(p_payload ? 'pilot_scope',false)
    and not exists(select 1 from outpost_private.task_bindings where task_id=p_task);
$$;
revoke all on function outpost_private.public_task_read(uuid) from public,anon,authenticated,service_role;
revoke all on function outpost_private.public_task_write(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function outpost_private.public_task_read(uuid) to authenticated;
grant execute on function outpost_private.public_task_write(uuid,jsonb) to authenticated;

create policy outpost_bound_task_read on public.tasks as restrictive for select to authenticated
  using(outpost_private.public_task_read(id));
create policy outpost_bound_task_insert on public.tasks as restrictive for insert to authenticated
  with check(outpost_private.public_task_write(id,payload));
create policy outpost_bound_task_update on public.tasks as restrictive for update to authenticated
  using(outpost_private.public_task_write(id,payload)) with check(outpost_private.public_task_write(id,payload));
create policy outpost_bound_task_delete on public.tasks as restrictive for delete to authenticated
  using(outpost_private.public_task_write(id,payload));

create function outpost_private.public_brain_read(p_workspace uuid)
returns boolean language sql volatile security definer set search_path='' as $$
  select not exists(select 1 from outpost_private.clients where workspace_id=p_workspace)
    or exists(select 1 from outpost_private.task_bindings b join outpost_private.clients c
      on c.workspace_id=b.workspace_id and c.client_binding_id=b.client_binding_id
      where b.workspace_id=p_workspace and outpost_private.api_access(b.workspace_id,b.client_binding_id,c.configuration_version,b.task_id));
$$;
revoke all on function outpost_private.public_brain_read(uuid) from public,anon,authenticated,service_role;
grant execute on function outpost_private.public_brain_read(uuid) to authenticated;
create policy outpost_enrolled_brain_read on public.company_brain as restrictive for select to authenticated
  using(outpost_private.public_brain_read(workspace_id));

-- No approved client-aware Brain writer exists yet. Freeze enrolled pilot Brain
-- through *every* app-role write route (including service-backed legacy handlers).
-- Nonpilot writes and trusted direct administrative SQL retain prior semantics.
create function outpost_private.freeze_enrolled_brain() returns trigger
language plpgsql security definer set search_path='' as $$
declare ws uuid;
begin
  if current_setting('role',true) in ('anon','authenticated','service_role') then
    if tg_op<>'INSERT' then
      ws:=old.workspace_id;
      if exists(select 1 from outpost_private.clients where workspace_id=ws) then
        raise exception 'pilot Brain requires approved client-aware writer' using errcode='42501'; end if;
    end if;
    if tg_op<>'DELETE' then
      ws:=new.workspace_id;
      if exists(select 1 from outpost_private.clients where workspace_id=ws) then
        raise exception 'pilot Brain requires approved client-aware writer' using errcode='42501'; end if;
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function outpost_private.freeze_enrolled_brain() from public,anon,authenticated,service_role;
create trigger outpost_enrolled_brain_frozen before insert or update or delete on public.company_brain
  for each row execute function outpost_private.freeze_enrolled_brain();
