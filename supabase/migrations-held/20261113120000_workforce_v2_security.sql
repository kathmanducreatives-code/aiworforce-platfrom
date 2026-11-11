-- WORKFORCE V2 SECURITY — HELD. Not applied anywhere; review before any apply.
--
-- 1. SIGNALS ARE SERVER-WRITTEN. signal_events, signal_event_evidence and
--    monitoring_subjects carried member INSERT / UPDATE / DELETE policies, so
--    any member's browser could forge a "verified" signal that ORION, ATLAS and
--    LYRA would then act on. Every legitimate writer is server-side with the
--    service role (lisa_record_signal, the scanners, the watchlist RPCs);
--    the browser only reads. Member reads are kept.
--
-- 2. APPROVALS ARE DECIDED SERVER-SIDE. approvals_workspace_member_access was
--    a FOR ALL member policy: a viewer could PATCH an approval to `approved`
--    through PostgREST and skip approve-and-continue's role check. Writers are
--    run-agent, toolRegistry and approve-and-continue, all service role; the
--    browser only reads (fetchPendingApprovals, realtime). Member reads are kept.
--
-- Idempotent; apply in one transaction. Rollback: rollback/20261113120000_workforce_v2_security.down.sql


-- ── 1. signal tables: read-only for members ────────────────────────────────
drop policy if exists "signal_events members insert" on public.signal_events;
drop policy if exists "signal_events members update" on public.signal_events;
drop policy if exists "signal_events members delete" on public.signal_events;
drop policy if exists "signal_event_evidence members insert" on public.signal_event_evidence;
drop policy if exists "signal_event_evidence members update" on public.signal_event_evidence;
drop policy if exists "signal_event_evidence members delete" on public.signal_event_evidence;
drop policy if exists "ms members insert" on public.monitoring_subjects;
drop policy if exists "ms members update" on public.monitoring_subjects;
drop policy if exists "ms members delete" on public.monitoring_subjects;

revoke insert, update, delete, truncate on public.signal_events, public.signal_event_evidence, public.monitoring_subjects
  from anon, authenticated;
grant select on public.signal_events, public.signal_event_evidence, public.monitoring_subjects to authenticated;

-- ── 2. approvals: members read; only the server decides ────────────────────
drop policy if exists approvals_workspace_member_access on public.approvals;
drop policy if exists "approvals members read" on public.approvals;
create policy "approvals members read" on public.approvals
  for select to authenticated
  using (public.has_workspace_access(auth.uid(), workspace_id));

revoke insert, update, delete, truncate on public.approvals from anon, authenticated;
grant select on public.approvals to authenticated;

