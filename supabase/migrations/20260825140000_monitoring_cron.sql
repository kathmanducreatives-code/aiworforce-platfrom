-- PHASE 6 — THE THING THAT FIRES.
--
-- ── WHAT ARMS, AND WHAT BOUNDS IT ───────────────────────────────────────────
--
-- Every fifteen minutes the tick runs. That is NOT how often a workspace is
-- scanned: the tick asks who is due, and a subject's `cadence_minutes` answers.
-- A tick with nothing due is a single indexed read and returns in
-- milliseconds, so a frequent tick costs nothing and makes a newly-added
-- subject answer within fifteen minutes instead of within its cadence.
--
-- What bounds the SPEND is three things, none of them this schedule:
--   the cadence            — how often one subject may be asked
--   the period ceiling     — what a workspace may spend unattended, per period
--   the claim lease        — so two ticks produce one scan
--
-- ── THE KEY IS IN VAULT, NOT IN THIS FILE ───────────────────────────────────
--
-- The tick accepts only the service role key. Writing it here would put a live
-- credential in version control forever; it is stored once in
-- `vault.decrypted_secrets` and read by name at fire time.
--
-- ── UNSCHEDULE FIRST, SO THIS MIGRATION IS RE-RUNNABLE ──────────────────────
--
-- `cron.schedule` on an existing name updates it, but an older job under a
-- different name would keep firing alongside — two schedulers, which the claim
-- handles but which nobody would expect to exist.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'monitoring-tick') then
    perform cron.unschedule('monitoring-tick');
  end if;
end $$;

select cron.schedule(
  'monitoring-tick',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := 'https://ohsdatpvfdjdemstoiuj.supabase.co/functions/v1/run-monitoring-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'monitoring_tick_key'
      )
    ),
    body := '{}'::jsonb,
    -- The tick returns as soon as it has decided; a scan it starts runs in the
    -- edge function's own lifetime, not inside this statement.
    timeout_milliseconds := 120000
  );
  $job$
);
