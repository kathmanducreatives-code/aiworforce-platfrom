-- HELD. Not applied anywhere except the disposable database-contract lane
-- (tests/db-contract/bootstrap.sh). Needs explicit approval, with #176 and
-- 20261025140000 (#186), before it is applied to any hosted project. See
-- supabase/migrations-held/README.md.
--
-- ── THE DEFECT (Codex MEMBER-SURFACE, independent follow-up on #185) ──────────
--
-- #186's canonical writers enforce the agreed policy (no promotion; the last
-- owner can be neither removed nor demoted), but the application service role
-- could still write the table directly through PostgREST: a raw PATCH turned a
-- viewer into an owner (200), and a raw DELETE removed the last owner (200,
-- zero owners left). Browser roles lose these writes in #159; the service role
-- kept them.
--
-- ── THE FIX: one writer boundary for membership changes ───────────────────────
--
-- No application code changes or deletes a membership directly: every
-- application read of workspace_members is a SELECT, and every write is a
-- SECURITY DEFINER function (the provisioning inserts in handle_new_user and
-- 20260929120000, and #186's workspace_member_remove / _set_role).
--   1. UPDATE, DELETE and TRUNCATE are revoked from service_role. The browser
--      roles' grants are #159's (it revokes their writes); this migration does
--      not duplicate it. SELECT and INSERT (provisioning) are unchanged.
--   2. An invariant trigger refuses the same writes from ALL application roles
--      (anon, authenticated, service_role), whatever their grants — before #159,
--      or if a later migration re-grants them (42501, naming the canonical writer).
--      It is SECURITY INVOKER on purpose: `current_user` is the role that issued
--      the write. A write made inside a definer function runs as that
--      function's owner, a foreign-key cascade (workspace deletion) as the table
--      owner, and administrative SQL as postgres — none of them is an
--      application role, so the canonical writers, provisioning and cascades are
--      unaffected.
-- The policy itself lives in one place: #186's writers (who may act, the last
-- owner, no promotion).
--
-- Rollback: rollback/20261025160000_workspace_members_app_surface.down.sql

revoke update, delete, truncate on public.workspace_members from service_role;

create function public.workspace_members_app_surface()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user::text not in ('service_role', 'authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  if tg_op = 'TRUNCATE' then
    raise exception 'workspace_members: application roles may not truncate memberships' using errcode = '42501';
  elsif tg_op = 'DELETE' then
    raise exception 'workspace_members: remove a member with public.workspace_member_remove' using errcode = '42501';
  elsif new.role is distinct from old.role then
    raise exception 'workspace_members: change a role with public.workspace_member_set_role' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.workspace_members_app_surface() from public, anon, authenticated, service_role;

create trigger workspace_members_app_surface
  before update or delete on public.workspace_members
  for each row execute function public.workspace_members_app_surface();
create trigger workspace_members_app_surface_truncate
  before truncate on public.workspace_members
  for each statement execute function public.workspace_members_app_surface();
