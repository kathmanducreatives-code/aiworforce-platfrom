-- HELD. Not applied anywhere except the disposable database-contract lane
-- (tests/db-contract/bootstrap.sh). Needs explicit approval, after the client
-- Brain contract (#174) is approved, before it is applied to any hosted
-- project. Depends on 20261024160000_client_company_brain.sql (#176): its
-- triggers revoke grants and renew permission_revision. See
-- supabase/migrations-held/README.md.
--
-- ── THE CANONICAL MEMBERSHIP WRITERS (contract #174 §8 O3 option A, §9.4) ────
--
-- workspace_member_remove(ws, target, actor, session)
-- workspace_member_set_role(ws, target, role, actor, session)
--
-- Service-role only. Each returns an outcome; any outcome other than 'ok'
-- changes nothing.
--
-- Lock order (contract §5): L1 the actor's auth.sessions row FOR SHARE (a
-- logout waits, or has already committed and the writer refuses), then L2 in
-- ONE statement, in user_id order, FOR UPDATE: the actor's row, the target's
-- row and EVERY OWNER's row of the workspace. Locking every owner is what
-- makes "the last owner can be neither removed nor demoted" hold under
-- concurrency (Codex on #174): two owners removing themselves, or each
-- other, at once are serialized on the same rows, and the second re-reads the
-- committed result. Then DELETE or UPDATE; #176's triggers do the rest in the
-- same transaction (a DELETE revokes the user's active client grants with
-- 'membership_removed'; a role change renews permission_revision, so every
-- pinned task gets 'permission_changed').
--
-- Policy (agreed on #174, O3):
--   * owners and admins may remove or demote members;
--   * an admin may not remove or demote an owner;
--   * the last owner can be neither removed nor demoted;
--   * a member may remove themself, except the last owner.
-- Not decided, so refused rather than guessed: PROMOTION ('promotion_unsupported';
-- provisioning keeps its own inserts), roles outside owner/admin/editor/viewer
-- ('invalid_role' as a target, 'unknown_role' for a stored legacy role).
-- Membership identity is immutable (#176's trigger): a move is remove + add.
--
-- Outcomes: ok | unchanged | session_invalid | not_member | target_not_member |
--   forbidden_role | owner_protected | last_owner | promotion_unsupported |
--   invalid_role | unknown_role
--
-- Rollback: rollback/20261025140000_workspace_member_writers.down.sql

create function public.workspace_member_role_rank(p_role text)
returns integer language sql immutable set search_path = '' as $$
  select case lower(btrim(coalesce(p_role, '')))
    when 'owner' then 4 when 'admin' then 3 when 'editor' then 2 when 'viewer' then 1 else null end
$$;
revoke all on function public.workspace_member_role_rank(text) from public, anon, authenticated, service_role;

-- L1 + L2 and the checks every change shares, under the locks. Returns 'ok' or
-- a refusal; never writes.
create function public.workspace_member_change_check(
  p_workspace_id uuid, p_target_user_id uuid, p_actor_id uuid, p_session_id uuid, p_reduces_owner boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare v_actor text; v_target text;
begin
  perform 1 from auth.sessions s where s.id = p_session_id and s.user_id = p_actor_id for share;
  perform 1 from (select m.user_id from public.workspace_members m
                   where m.workspace_id = p_workspace_id
                     and (m.user_id in (p_actor_id, p_target_user_id) or lower(btrim(coalesce(m.role, ''))) = 'owner')
                   order by m.user_id for update of m) locked;
  if not exists (select 1 from auth.sessions s
                  where s.id = p_session_id and s.user_id = p_actor_id
                    and (s.not_after is null or s.not_after > clock_timestamp())) then
    return 'session_invalid';
  end if;
  select lower(btrim(coalesce(m.role, ''))) into v_actor from public.workspace_members m
   where m.workspace_id = p_workspace_id and m.user_id = p_actor_id;
  if not found then return 'not_member'; end if;
  select lower(btrim(coalesce(m.role, ''))) into v_target from public.workspace_members m
   where m.workspace_id = p_workspace_id and m.user_id = p_target_user_id;
  if not found then return 'target_not_member'; end if;
  if p_actor_id <> p_target_user_id and v_actor not in ('owner', 'admin') then return 'forbidden_role'; end if;
  if v_target = 'owner' and p_actor_id <> p_target_user_id and v_actor <> 'owner' then return 'owner_protected'; end if;
  if v_target = 'owner' and p_reduces_owner and not exists (
       select 1 from public.workspace_members m
        where m.workspace_id = p_workspace_id and m.user_id <> p_target_user_id
          and lower(btrim(coalesce(m.role, ''))) = 'owner') then
    return 'last_owner';
  end if;
  return 'ok';
end $$;
revoke all on function public.workspace_member_change_check(uuid, uuid, uuid, uuid, boolean) from public, anon, authenticated, service_role;

create function public.workspace_member_remove(
  p_workspace_id uuid, p_target_user_id uuid, p_actor_id uuid, p_session_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  v := public.workspace_member_change_check(p_workspace_id, p_target_user_id, p_actor_id, p_session_id, true);
  if v <> 'ok' then return v; end if;
  delete from public.workspace_members m where m.workspace_id = p_workspace_id and m.user_id = p_target_user_id;
  return 'ok';
end $$;

create function public.workspace_member_set_role(
  p_workspace_id uuid, p_target_user_id uuid, p_role text, p_actor_id uuid, p_session_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v text; v_new text := lower(btrim(coalesce(p_role, ''))); v_old text;
begin
  if public.workspace_member_role_rank(v_new) is null then return 'invalid_role'; end if;
  v := public.workspace_member_change_check(p_workspace_id, p_target_user_id, p_actor_id, p_session_id, v_new <> 'owner');
  if v <> 'ok' then return v; end if;
  select lower(btrim(coalesce(m.role, ''))) into v_old from public.workspace_members m
   where m.workspace_id = p_workspace_id and m.user_id = p_target_user_id;
  if public.workspace_member_role_rank(v_old) is null then return 'unknown_role'; end if;
  if v_new = v_old then return 'unchanged'; end if;
  if public.workspace_member_role_rank(v_new) > public.workspace_member_role_rank(v_old) then return 'promotion_unsupported'; end if;
  -- A demotion: who may demote is the same rule as who may remove.
  if p_actor_id = p_target_user_id
     and (select lower(btrim(coalesce(m.role, ''))) from public.workspace_members m
           where m.workspace_id = p_workspace_id and m.user_id = p_actor_id) not in ('owner', 'admin') then
    return 'forbidden_role';
  end if;
  update public.workspace_members m set role = v_new
   where m.workspace_id = p_workspace_id and m.user_id = p_target_user_id;
  return 'ok';
end $$;

revoke all on function public.workspace_member_remove(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.workspace_member_set_role(uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.workspace_member_remove(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.workspace_member_set_role(uuid, uuid, text, uuid, uuid) to service_role;
