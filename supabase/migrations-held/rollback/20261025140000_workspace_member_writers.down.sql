-- Rollback of 20261025140000_workspace_member_writers.sql. Removes the writers
-- only; #176's triggers, the memberships and every grant are untouched.
drop function if exists public.workspace_member_set_role(uuid, uuid, text, uuid, uuid);
drop function if exists public.workspace_member_remove(uuid, uuid, uuid, uuid);
drop function if exists public.workspace_member_change_check(uuid, uuid, uuid, uuid, boolean);
drop function if exists public.workspace_member_role_rank(text);
