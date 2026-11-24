-- LAUNCH HARDENING — NO SELF-SERVICE MEMBERSHIP, NO BROWSER WRITES TO WORKSPACES.
--
-- `members_self_insert` (INSERT … WITH CHECK (user_id = auth.uid())) checked
-- that the new membership row is the caller's own, never that the workspace is.
-- Any signed-in user could insert themselves — role defaulting to 'owner' — into
-- any workspace whose id they knew, and every membership-gated policy and
-- function (has_workspace_access: Company Brain, leads, agents, credits…)
-- then let them in. Proved on a disposable database by
-- tests/db-contract/workspaceMembership.contract.test.ts, which fails without
-- this migration (tests/db-contract/mutation.sh).
--
-- `workspaces_member_access` was FOR ALL: any member could UPDATE plan /
-- daily_run_limit / tokens_used_today or DELETE the workspace (cascading its
-- memberships and Brain). 20260929130000 revoked anon writes only on tables
-- with a `workspace_id` column, which neither `workspaces` (keyed by `id`) nor
-- the INSERT policy above was covered by.
--
-- Nothing legitimate is lost. No browser or edge-function code writes either
-- table: memberships and workspaces are created by provision_workspace_for_user
-- and handle_new_user (SECURITY DEFINER, unaffected by these grants), and edge
-- functions use the service role. `increment_tokens` (SECURITY INVOKER, no
-- caller in the repository) is closed to the browser roles for the same reason.
-- Renaming a workspace, plans and invites get role-checked RPCs later.

drop policy if exists members_self_insert on public.workspace_members;
revoke insert, update, delete, truncate on public.workspace_members from anon, authenticated;
-- SELECT stays: `members_self_select` (user_id = auth.uid()) is what the app reads.

drop policy if exists workspaces_member_access on public.workspaces;
create policy workspaces_member_select on public.workspaces
  for select to authenticated
  using (public.has_workspace_access(auth.uid(), id));
revoke insert, update, delete, truncate on public.workspaces from anon, authenticated;

revoke execute on function public.increment_tokens(uuid, integer) from public, anon, authenticated;
