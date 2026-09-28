-- LAUNCH HARDENING — SECURITY DEFINER RPCs THE BROWSER COULD CALL
--
-- Every function below bypasses row-level security (SECURITY DEFINER), and each
-- was EXECUTABLE BY anon and authenticated (Postgres grants EXECUTE to PUBLIC by
-- default). With the public anon key, anyone could:
--
--   credits_grant            mint unlimited credits for ANY workspace
--   credits_reserve          drain another workspace's balance
--   credits_finalize         settle another workspace's reservations
--   credits_release_stale    release every stale reservation, system-wide
--   monitoring_spend_in_period  read any workspace's monitoring spend
--   seed_agents_for_workspace   write agent rows into ANY workspace
--   dev_table_counts         read global row counts of private tables
--   provision_workspace_for_user  create a workspace for, or learn the
--                            workspace id of, ANY user id
--   get_room_member_profiles list the names and logos of ANY room's members
--
-- The credit functions and the monitoring spend reader are called only by edge
-- functions with the service role; seed_agents_for_workspace only from inside
-- provision_workspace_for_user (which runs as the owner). Those lose EXECUTE for
-- PUBLIC, anon and authenticated. The two the browser legitimately calls keep
-- EXECUTE but now check the caller.
--
-- Functions used INSIDE RLS policies (has_workspace_access, is_org_member,
-- has_org_role, is_room_member, get_user_client_id) must stay executable by
-- authenticated, and are not touched.

revoke execute on function public.credits_grant(uuid, integer, text, text, text) from public, anon, authenticated;
revoke execute on function public.credits_reserve(uuid, integer, text, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.credits_finalize(uuid, integer, text, text) from public, anon, authenticated;
revoke execute on function public.credits_release_stale(interval) from public, anon, authenticated;
revoke execute on function public.monitoring_spend_in_period(uuid, integer) from public, anon, authenticated;
revoke execute on function public.seed_agents_for_workspace(uuid) from public, anon, authenticated;
revoke execute on function public.dev_table_counts() from public, anon, authenticated;

grant execute on function public.credits_grant(uuid, integer, text, text, text) to service_role;
grant execute on function public.credits_reserve(uuid, integer, text, text, uuid, text) to service_role;
grant execute on function public.credits_finalize(uuid, integer, text, text) to service_role;
grant execute on function public.credits_release_stale(interval) to service_role;
grant execute on function public.monitoring_spend_in_period(uuid, integer) to service_role;
grant execute on function public.seed_agents_for_workspace(uuid) to service_role;
grant execute on function public.dev_table_counts() to service_role;

CREATE OR REPLACE FUNCTION public.provision_workspace_for_user(_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  existing_id uuid;
  new_id uuid;
  display_name text;
begin
  -- LAUNCH HARDENING: a signed-in user may provision only THEIR OWN workspace.
  -- This function is SECURITY DEFINER and was executable by anon, so any caller
  -- could create a workspace for — or learn the workspace id of — any user id.
  if coalesce(auth.role(), '') <> 'service_role'
     and (auth.uid() is null or auth.uid() <> _user_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select workspace_id into existing_id
  from public.workspace_members
  where user_id = _user_id
  order by created_at asc
  limit 1;

  if existing_id is not null then
    -- Idempotent, and it repairs an older workspace that predates seeding.
    perform public.seed_agents_for_workspace(existing_id);
    return existing_id;
  end if;

  select coalesce(nullif(p.full_name, ''), 'My Workspace')
    into display_name
  from public.profiles p
  where p.user_id = _user_id
  limit 1;

  if display_name is null then
    display_name := 'My Workspace';
  end if;

  insert into public.workspaces (name, created_by)
  values (display_name || '''s Workspace', _user_id)
  returning id into new_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_id, _user_id, 'owner')
  on conflict (workspace_id, user_id) do nothing;

  insert into public.company_brain (workspace_id, profile)
  values (new_id, '{}'::jsonb)
  on conflict (workspace_id) do nothing;

  perform public.seed_agents_for_workspace(new_id);

  return new_id;
end $function$;

create or replace function public.get_room_member_profiles(room_uuid uuid)
 returns table(user_id uuid, full_name text, logo_url text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  -- LAUNCH HARDENING: only a member of the room may list its members.
  select p.user_id, p.full_name, p.logo_url
  from profiles p
  inner join collaboration_room_members m on m.user_id = p.user_id
  where m.room_id = room_uuid
    and public.is_room_member(auth.uid(), room_uuid);
$function$;
