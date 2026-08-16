-- ============================================================================
-- company_brain RLS — key it on membership, not on a table nobody populates
-- ============================================================================
--
-- THE ONBOARDING LOOP. Completing the Company Brain showed the dashboard for a
-- moment and then returned to step 1, every time. The database was never wrong:
-- `onboarding_completed` was true, the timestamp set, the profile 8 kB.
--
-- The three policies on this table authorised against `public.users`:
--
--   exists (select 1 from users u
--           where u.id = auth.uid() and u.workspace_id = company_brain.workspace_id)
--
-- `public.users` is EMPTY. Membership lives in `workspace_members` — it is what
-- `provision_workspace_for_user` writes, what `getWorkspaceId` reads, and what
-- `has_workspace_access` has always checked. So the policy could never match,
-- every read returned no row, `onboarding_completed` evaluated to false, and
-- `OnboardingGate` correctly redirected a user whose brain it was not allowed
-- to see.
--
-- The read failed SILENTLY, which is why this took two attempts to find. RLS
-- does not error on a denied select; it returns zero rows. `maybeSingle()` then
-- yields `null` with no error, and the hook's `!!row?.onboarding_completed`
-- turns that into a confident `false`. Every layer behaved correctly on a
-- premise that was wrong.
--
-- ── NOT A MIGRATION REGRESSION, AND NOT NEW ─────────────────────────────────
--
-- The old project has 20 rows in `workspace_members` and 2 in `users`. The same
-- policy was therefore broken there for 18 of 20 members; it worked only for
-- the two accounts that happened to have a `users` row. The migration carried
-- the defect faithfully. Moving to a project with zero `users` rows simply took
-- it from "broken for most people" to "broken for everyone".
--
-- ── THE FIX ─────────────────────────────────────────────────────────────────
--
-- Use `has_workspace_access`, the SECURITY DEFINER helper that already encodes
-- this check correctly and is used by policies elsewhere. Routing all three
-- through one helper also means the next change to what "access" means happens
-- in one place rather than in 271 policy expressions.

drop policy if exists company_brain_member_select on public.company_brain;
drop policy if exists company_brain_member_update on public.company_brain;
drop policy if exists company_brain_member_upsert on public.company_brain;

create policy company_brain_member_select
  on public.company_brain
  for select to authenticated
  using (public.has_workspace_access(auth.uid(), workspace_id));

create policy company_brain_member_update
  on public.company_brain
  for update to authenticated
  using (public.has_workspace_access(auth.uid(), workspace_id))
  with check (public.has_workspace_access(auth.uid(), workspace_id));

-- The INSERT policy had a NULL `with_check`, which permits any row a client can
-- name. Constrained to the same membership test: a client that could insert a
-- brain for another workspace could seed that workspace's ICP and voice.
create policy company_brain_member_insert
  on public.company_brain
  for insert to authenticated
  with check (public.has_workspace_access(auth.uid(), workspace_id));
