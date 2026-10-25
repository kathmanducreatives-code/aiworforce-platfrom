-- HELD / DISABLED. Requires #151 + #166. No hosted application approval.
-- Internal transaction functions only: NO app-role RPC grants or new role/key.
-- Original P1 HMAC is verified by pilotTaskRegistration inside the SAME locked
-- transaction. Direct DB administrators remain privileged trusted operators.
create function outpost_private.lock_task_security(p_workspace uuid,p_client uuid,p_version integer,p_task uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare t public.tasks%rowtype; b outpost_private.task_bindings%rowtype; sid uuid;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'current authorization snapshot required' using errcode='42501'; end if;
  -- Same deterministic parent -> enrollment -> membership -> session lock order
  -- as registration/cancellation. Original capture trigger also takes parent first.
  select * into t from public.tasks where id=p_task for update;
  if not found or t.workspace_id is distinct from p_workspace or t.user_id is distinct from auth.uid() then
    raise exception 'task principal refused' using errcode='42501'; end if;
  perform 1 from outpost_private.clients where workspace_id=p_workspace and client_binding_id=p_client
    and configuration_version=p_version and not customer_enabled for share;
  if not found then raise exception 'client enrollment refused' using errcode='42501'; end if;
  perform 1 from public.workspace_members where workspace_id=p_workspace and user_id=auth.uid()
    and role::text in ('owner','admin') for share;
  if not found then raise exception 'current member required' using errcode='42501'; end if;
  begin sid:=(auth.jwt()->>'session_id')::uuid;
  exception when invalid_text_representation then raise exception 'session refused' using errcode='42501'; end;
  perform 1 from auth.sessions where id=sid and user_id=auth.uid() for share;
  if not found or not outpost_private.current_member_session(p_workspace,auth.uid(),sid) then
    raise exception 'current original session required' using errcode='42501'; end if;
  select * into b from outpost_private.task_bindings where task_id=p_task;
  if found and (b.workspace_id is distinct from p_workspace or b.client_binding_id is distinct from p_client
    or b.actor_id is distinct from auth.uid() or b.session_id is distinct from sid) then
    raise exception 'original binding refused' using errcode='42501'; end if;
  if t.status not in ('ready','cancelled') then raise exception 'task lifecycle refused' using errcode='42501'; end if;
  return to_jsonb(t);
end;
$$;
-- Called only by the internal transaction store, using P1's existing signer.
create function outpost_private.bind_prepared_task(p_workspace uuid,p_client uuid,p_version integer,p_task uuid,p_expected jsonb,p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actual jsonb; stored jsonb;
begin
  actual:=outpost_private.lock_task_security(p_workspace,p_client,p_version,p_task);
  if actual is distinct from p_expected or actual->>'status'<>'ready'
    or actual->'payload'->>'execution_mode' is distinct from 'pilot_draft_only'
    or coalesce(actual->'payload'->'pilot_scope','null'::jsonb)<>'null'::jsonb
    or exists(select 1 from outpost_private.task_bindings where task_id=p_task)
    or jsonb_typeof(p_payload) is distinct from 'object'
    or p_payload->>'execution_mode' is distinct from 'pilot_draft_only'
    or p_payload->>'pilot_origin_session_id' is distinct from auth.jwt()->>'session_id'
    or ((actual->'payload')?'pilot_origin_session_id'
      and actual->'payload'->>'pilot_origin_session_id' is distinct from auth.jwt()->>'session_id')
    or (p_payload-'pilot_scope'-'pilot_origin_session_id') is distinct from ((actual->'payload')-'pilot_scope'-'pilot_origin_session_id') then
    raise exception 'original preparation image/session required' using errcode='42501'; end if;
  update public.tasks t set payload=p_payload where id=p_task returning to_jsonb(t) into stored;
  return stored;
end;
$$;
revoke all on function outpost_private.bind_prepared_task(uuid,uuid,integer,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;

create function outpost_private.register_verified_task(p_workspace uuid,p_client uuid,p_version integer,p_task uuid,p_expected jsonb)
returns text language plpgsql volatile security definer set search_path='' as $$
declare actual jsonb; b outpost_private.task_bindings%rowtype;
begin
  actual:=outpost_private.lock_task_security(p_workspace,p_client,p_version,p_task);
  if actual is distinct from p_expected or actual->>'status' <> 'ready' then
    raise exception 'verified task image changed' using errcode='42501'; end if;
  -- Never trust a supplied actor, session, snapshot or "verified" flag. The
  -- application has already checked the original P1 signature and resource graph.
  select * into b from outpost_private.task_bindings where task_id=p_task;
  if found then
    if b.task_snapshot is distinct from actual then raise exception 'registration replay changed' using errcode='42501'; end if;
    return 'replayed';
  end if;
  -- This field is part of P1's signed payload_hash: a pending task cannot be
  -- registered from a later login session just because its actor is unchanged.
  if actual->'payload'->>'pilot_origin_session_id' is distinct from auth.jwt()->>'session_id' then
    raise exception 'signed preparation session required' using errcode='42501'; end if;
  insert into outpost_private.task_bindings(workspace_id,client_binding_id,task_id,actor_id,session_id)
    values(p_workspace,p_client,p_task,auth.uid(),(auth.jwt()->>'session_id')::uuid);
  if not outpost_private.current_member_session(p_workspace,auth.uid(),(auth.jwt()->>'session_id')::uuid) then
    raise exception 'authorization expired during registration' using errcode='42501'; end if;
  return 'registered';
end;
$$;
create function outpost_private.cancel_verified_task(p_workspace uuid,p_client uuid,p_version integer,p_task uuid,p_expected jsonb)
returns text language plpgsql volatile security definer set search_path='' as $$
declare actual jsonb; b outpost_private.task_bindings%rowtype;
begin
  actual:=outpost_private.lock_task_security(p_workspace,p_client,p_version,p_task);
  select * into b from outpost_private.task_bindings where task_id=p_task;
  if not found or actual is distinct from p_expected
    or (actual-'status'-'updated_at') is distinct from (b.task_snapshot-'status'-'updated_at') then
    raise exception 'original registered image required' using errcode='42501'; end if;
  if actual->>'status'='cancelled' then return 'replayed'; end if;
  update public.tasks set status='cancelled' where id=p_task;
  if not outpost_private.current_member_session(p_workspace,auth.uid(),(auth.jwt()->>'session_id')::uuid) then
    raise exception 'authorization expired during cancellation' using errcode='42501'; end if;
  return 'cancelled';
end;
$$;
revoke all on function outpost_private.lock_task_security(uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
revoke all on function outpost_private.register_verified_task(uuid,uuid,integer,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function outpost_private.cancel_verified_task(uuid,uuid,integer,uuid,jsonb) from public,anon,authenticated,service_role;

-- MUTATION_LIFECYCLE_GUARD_BEGIN
create function outpost_private.protect_task_lifecycle() returns trigger
language plpgsql security definer set search_path='' as $$
declare b outpost_private.task_bindings%rowtype;
begin
  if tg_op='INSERT' then
    if current_setting('role',true) in ('anon','authenticated','service_role')
      and (new.payload->>'execution_mode'='pilot_draft_only' or coalesce(new.payload?'pilot_scope',false)) then
      raise exception 'pilot task requires trusted preparation' using errcode='42501'; end if;
    return new;
  end if;
  select * into b from outpost_private.task_bindings where task_id=old.id;
  if found then
    if tg_op='UPDATE' then
      if to_jsonb(new)=to_jsonb(old) then return new; end if;
      -- Narrow terminal-only cancellation from an internal verified transaction.
      -- PostgREST service/auth roles cannot use this branch even via a legacy
      -- security-definer writer. No output/checkpoint/model/lifecycle execution.
      if current_setting('role',true) = 'none'
        and old.status='ready' and new.status='cancelled'
        and (to_jsonb(new)-'status'-'updated_at')=(to_jsonb(old)-'status'-'updated_at')
        and to_jsonb(old)=b.task_snapshot
        and outpost_private.current_member_session(b.workspace_id,b.actor_id,b.session_id)
      then return new; end if;
    end if;
    raise exception 'registered pilot task is immutable; verified cancellation only' using errcode='42501';
  end if;
  if tg_op='DELETE' then
    if old.payload->>'execution_mode'='pilot_draft_only' or coalesce(old.payload?'pilot_scope',false) then
      raise exception 'pilot task removal refused' using errcode='42501'; end if;
    return old;
  end if;
  -- Check BOTH images. Adding a pilot marker and starting it in one UPDATE is
  -- just as unauthorized as claiming an already-marked unregistered task.
  if old.payload->>'execution_mode'='pilot_draft_only' or coalesce(old.payload?'pilot_scope',false)
    or new.payload->>'execution_mode'='pilot_draft_only' or coalesce(new.payload?'pilot_scope',false) then
    if old.status is distinct from 'ready' or new.status is distinct from 'ready'
      or new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id
      or new.user_id is distinct from old.user_id
      or new.payload->>'execution_mode' is distinct from 'pilot_draft_only' then
      raise exception 'unregistered pilot cannot enter legacy execution' using errcode='42501'; end if;
  end if;
  return new;
end;
$$;
revoke all on function outpost_private.protect_task_lifecycle() from public,anon,authenticated,service_role;
create trigger outpost_task_lifecycle before insert or update or delete on public.tasks
  for each row execute function outpost_private.protect_task_lifecycle();
create function outpost_private.prevent_task_truncate() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from outpost_private.task_bindings) or exists(select 1 from public.tasks
    where payload->>'execution_mode'='pilot_draft_only' or coalesce(payload?'pilot_scope',false)) then
    raise exception 'pilot task history prevents truncate' using errcode='42501'; end if;
  return null;
end;
$$;
revoke all on function outpost_private.prevent_task_truncate() from public,anon,authenticated,service_role;
create trigger outpost_task_no_truncate before truncate on public.tasks
  for each statement execute function outpost_private.prevent_task_truncate();
-- MUTATION_LIFECYCLE_GUARD_END
