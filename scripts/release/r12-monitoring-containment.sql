-- R1.2 · CONTAIN THE UNATTENDED PRODUCTION MONITORING SCAN. PREPARED, NOT RUN.
-- Needs the owner's explicit approval. Production project ohsdatpvfdjdemstoiuj only.
--
-- WHAT RUNS TODAY (audited 2026-11-16, read-only):
--   pg_cron job 1 "monitoring-tick" (*/15 * * * *) → POST run-monitoring-tick (service-role bearer)
--   → run-monitoring-tick v31 selects monitoring_subjects WHERE enabled = true, checks the cadence
--     (1440 min) and the period ceiling (monitoring_budgets: 200 credits / 7 days), claims, then
--   → POST run-monitoring-scan v111 (service role) for that workspace (max_candidates 3).
--   The only enabled subject: 78372f06-f37d-4119-8932-67ca651905fa (competitor), in workspace
--   11111111-2222-4333-8444-555555555555 — a workspace with NO members. It ran daily; on
--   2026-11-14 14:30 and 2026-11-15 14:45 it reached apify_linkedin_company_details, which
--   failed with apify_unauthorized (0 cost units).
--
-- THE GAP: no feature flag gates this path. AGENTORY_DELEGATION_ENABLED=false does not apply to
-- monitoring. The guards are: subject enabled + cadence + credit ceiling. The ONLY thing that
-- stopped paid Apify calls was an invalid Apify credential. With a valid one, this scan would
-- spend up to 200 credits per 7 days without anyone watching.
--
-- Pick ONE option (A is the narrowest). Each is reversible; nothing else changes.

-- ── Option A (recommended): disable the one enabled subject ──────────────────
-- The tick then finds no enabled subject and calls nothing. All other subjects are already disabled.
begin;
update public.monitoring_subjects set enabled = false
 where id = '78372f06-f37d-4119-8932-67ca651905fa'
   and workspace_id = '11111111-2222-4333-8444-555555555555'
   and enabled = true;
-- verify: expect 0
select count(*) as enabled_subjects from public.monitoring_subjects where enabled = true;
commit;
-- undo A:
--   update public.monitoring_subjects set enabled = true where id = '78372f06-f37d-4119-8932-67ca651905fa';

-- ── Option B: pause the scheduler itself ──────────────────────────────────────
-- Stops every unattended monitoring tick, in every workspace.
--   select cron.alter_job(1, active := false);
--   select jobid, jobname, active from cron.job where jobid = 1;   -- expect active = false
-- undo B:
--   select cron.alter_job(1, active := true);

-- ── Option C: zero the period ceiling for that workspace ──────────────────────
-- budgetAllows() refuses with "scheduled scans are off".
--   update public.monitoring_budgets set period_ceiling = 0 where workspace_id = '11111111-2222-4333-8444-555555555555';
-- undo C:
--   update public.monitoring_budgets set period_ceiling = 200 where workspace_id = '11111111-2222-4333-8444-555555555555';

-- Durable fix (R2, needs a code deploy of run-monitoring-tick / run-monitoring-scan): require an
-- explicit AGENTORY_MONITORING_ENABLED=true and refuse workspaces with no members, so a valid
-- provider credential alone can never start unattended paid work.
