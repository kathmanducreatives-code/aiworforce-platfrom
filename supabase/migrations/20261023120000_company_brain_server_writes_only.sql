-- Company Brain roadmap Phase 3a: the browser never writes the Company Brain.
--
-- `company_brain_member_insert` / `_update` let ANY member — a viewer included —
-- write the whole profile from the browser (has_workspace_access checks
-- membership, not role): a viewer's PATCH returned 204 and persisted
-- (Codex native surface audit, #166). Since #147 every edit goes through the
-- authorized backend (generate-company-brain-draft `update` / `save_draft` /
-- `activate`, setup-company-brain), which runs as the service role and now
-- checks the caller's ROLE before any model call or write
-- (_shared/brainRole.ts). No frontend code writes this table
-- (tests/edge-functions/companyBrainWritePaths.test.ts).
--
-- So browser writes are removed for every role, not role-filtered: there is
-- nothing legitimate left for them to do. Reads are unchanged (members read
-- their workspace's Brain). Provisioning (`provision_workspace_for_user`,
-- SECURITY DEFINER) and service-role writers are unaffected.
--
-- Rollback (restores the pre-migration policies and grants; reopens the hole):
--   begin;
--   create policy company_brain_member_insert on public.company_brain for insert to authenticated
--     with check (public.has_workspace_access(auth.uid(), workspace_id));
--   create policy company_brain_member_update on public.company_brain for update to authenticated
--     using (public.has_workspace_access(auth.uid(), workspace_id))
--     with check (public.has_workspace_access(auth.uid(), workspace_id));
--   grant insert, update, delete on public.company_brain to authenticated;
--   commit;
-- That is the production pre-state read on 2026-10-23 (catalog only): policies
-- member_insert / member_select / member_update; `authenticated` select +
-- insert + update + delete (no truncate); `anon` select only; RLS on.

drop policy if exists company_brain_member_insert on public.company_brain;
drop policy if exists company_brain_member_update on public.company_brain;
revoke insert, update, delete, truncate on public.company_brain from anon, authenticated;
