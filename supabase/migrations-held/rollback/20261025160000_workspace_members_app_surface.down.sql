-- Rollback of 20261025160000_workspace_members_app_surface.sql: the triggers,
-- the function, and the service role's direct writes as they were.
drop trigger if exists workspace_members_app_surface_truncate on public.workspace_members;
drop trigger if exists workspace_members_app_surface on public.workspace_members;
drop function if exists public.workspace_members_app_surface();
grant update, delete, truncate on public.workspace_members to service_role;
