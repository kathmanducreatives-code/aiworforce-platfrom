-- ROLLBACK for 20261113120000_workforce_v2_security.sql. Restores the previous
-- (vulnerable) member write access exactly as the baseline defined it. Use only
-- to undo a failed apply; it reopens both findings. Idempotent: every policy is
-- dropped-if-exists before it is recreated, so a second run is harmless.

grant insert, update, delete on public.signal_events, public.signal_event_evidence, public.monitoring_subjects to authenticated;
drop policy if exists "signal_events members insert" on public.signal_events;
create policy "signal_events members insert" on public.signal_events for insert to authenticated with check (public.has_workspace_access(auth.uid(), workspace_id));
drop policy if exists "signal_events members update" on public.signal_events;
create policy "signal_events members update" on public.signal_events for update to authenticated using (public.has_workspace_access(auth.uid(), workspace_id)) with check (public.has_workspace_access(auth.uid(), workspace_id));
drop policy if exists "signal_events members delete" on public.signal_events;
create policy "signal_events members delete" on public.signal_events for delete to authenticated using (public.has_workspace_access(auth.uid(), workspace_id));
drop policy if exists "signal_event_evidence members insert" on public.signal_event_evidence;
create policy "signal_event_evidence members insert" on public.signal_event_evidence for insert to authenticated with check (public.has_workspace_access(auth.uid(), workspace_id));
drop policy if exists "signal_event_evidence members update" on public.signal_event_evidence;
create policy "signal_event_evidence members update" on public.signal_event_evidence for update to authenticated using (public.has_workspace_access(auth.uid(), workspace_id)) with check (public.has_workspace_access(auth.uid(), workspace_id));
drop policy if exists "signal_event_evidence members delete" on public.signal_event_evidence;
create policy "signal_event_evidence members delete" on public.signal_event_evidence for delete to authenticated using (public.has_workspace_access(auth.uid(), workspace_id));
drop policy if exists "ms members insert" on public.monitoring_subjects;
create policy "ms members insert" on public.monitoring_subjects for insert to authenticated with check (public.has_workspace_access(auth.uid(), workspace_id));
drop policy if exists "ms members update" on public.monitoring_subjects;
create policy "ms members update" on public.monitoring_subjects for update to authenticated using (public.has_workspace_access(auth.uid(), workspace_id)) with check (public.has_workspace_access(auth.uid(), workspace_id));
drop policy if exists "ms members delete" on public.monitoring_subjects;
create policy "ms members delete" on public.monitoring_subjects for delete to authenticated using (public.has_workspace_access(auth.uid(), workspace_id));

drop policy if exists "approvals members read" on public.approvals;
grant insert, update, delete on public.approvals to authenticated;
drop policy if exists approvals_workspace_member_access on public.approvals;
create policy approvals_workspace_member_access on public.approvals to authenticated
  using (public.has_workspace_access(auth.uid(), workspace_id)) with check (public.has_workspace_access(auth.uid(), workspace_id));

