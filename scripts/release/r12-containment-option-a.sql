-- R1.2 · MONITORING CONTAINMENT, OPTION A — PREPARED, NOT RUN. SEPARATE FROM THE R1.2 DEPLOY.
--
-- Production project ohsdatpvfdjdemstoiuj ONLY, and only after the owner's explicit approval of
-- THIS step. Run each numbered block on its own (psql, or the Supabase SQL editor of the
-- production project — check the project ref in the URL first). Nothing here touches pilot-chat,
-- secrets, cron jobs, budgets, functions, or any other subject or workspace.
--
-- What it does: disables ONE monitoring subject (78372f06-…, competitor) in a workspace with no
-- members (11111111-2222-4333-8444-555555555555). pg_cron job 1 "monitoring-tick" keeps running;
-- run-monitoring-tick selects only `enabled = true` subjects, so it then finds none and calls
-- nothing (no run-monitoring-scan, no Apify).
-- State audited read-only on 2026-11-17: this is the only enabled subject (1 of 6), last_run_at
-- 2026-11-17 15:15 UTC (it still runs daily); the August runs in this workspace made paid Apify
-- calls (3–4 cost units each); recent attempts failed only because the Apify credential is invalid.

-- ── 1. PRE-CHECK (read-only). Expected: exactly one row, enabled = true, members = 0.
select id, workspace_id, enabled, cadence_minutes, last_run_at, updated_at,
       (select count(*) from public.workspace_members m where m.workspace_id = s.workspace_id) as members
  from public.monitoring_subjects s
 where enabled = true;
-- Record the output (it is the rollback evidence). STOP if it shows anything other than the one
-- subject above — production has moved; re-review first.

-- ── 2. APPLY (one transaction; aborts and changes nothing unless exactly that one row changes).
begin;
do $$
declare n int;
begin
  update public.monitoring_subjects
     set enabled = false
   where id = '78372f06-f37d-4119-8932-67ca651905fa'
     and workspace_id = '11111111-2222-4333-8444-555555555555'
     and enabled = true;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'containment A: expected to disable exactly 1 subject, would change %; nothing changed', n;
  end if;
  if exists (select 1 from public.monitoring_subjects where enabled = true) then
    raise exception 'containment A: another enabled subject exists; nothing changed';
  end if;
end $$;
commit;

-- ── 3. VERIFY (read-only). Expected: enabled_subjects = 0; the subject row shows enabled = false.
select count(*) as enabled_subjects from public.monitoring_subjects where enabled = true;
select id, enabled, updated_at from public.monitoring_subjects where id = '78372f06-f37d-4119-8932-67ca651905fa';
-- After the next ticks (every 15 min), last_run_at must stop advancing:
select last_run_at from public.monitoring_subjects where id = '78372f06-f37d-4119-8932-67ca651905fa';
-- The scheduler itself is untouched (expect active = true for jobs 1–4):
select jobid, jobname, schedule, active from cron.job order by jobid;

-- ── 4. ROLLBACK (only on the owner's instruction). Restores exactly the pre-check state.
begin;
do $$
declare n int;
begin
  update public.monitoring_subjects
     set enabled = true
   where id = '78372f06-f37d-4119-8932-67ca651905fa'
     and workspace_id = '11111111-2222-4333-8444-555555555555'
     and enabled = false;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'rollback A: expected to re-enable exactly 1 subject, would change %; nothing changed', n;
  end if;
end $$;
commit;

-- ── 5. VERIFY ROLLBACK (read-only). Expected: exactly the one subject from step 1, enabled = true.
select id, workspace_id, enabled from public.monitoring_subjects where enabled = true;
-- Note: re-enabling restores the unattended daily scan; with a valid Apify credential it would
-- spend again (ceiling: monitoring_budgets, 200 credits / 7 days).
