-- LOCAL ONLY: NO LOCAL SCHEDULE MAY CALL THE HOSTED PROJECT.
--
-- `monitoring_cron.sql` and `resume_stalled_leads_cron.sql` schedule
-- `net.http_post` against the LITERAL hosted URL
-- (https://ohsdatpvfdjdemstoiuj.supabase.co/functions/v1/…). Applied to a local
-- database those schedules still exist and still fire — every 3 and 15 minutes,
-- from this machine, at the restricted production project. That is exactly the
-- traffic local development exists to avoid.
--
-- The migrations are left untouched (production needs them as they are); the
-- SCHEDULES are removed here, locally. In development the sweeper and the
-- monitoring tick are invoked directly, against the local functions:
--
--   curl -X POST http://127.0.0.1:54321/functions/v1/resume-stalled-leads \
--        -H "Authorization: Bearer $LOCAL_SERVICE_ROLE_KEY" -d '{}'
--
-- The purely in-database jobs (`sweep-stuck-runs`,
-- `release-stale-credit-reservations`) touch nothing outside this database, so
-- they are left running: local development wants them.

do $$
declare j record;
begin
  for j in
    select jobname from cron.job
    where command ilike '%net.http_post%' or command ilike '%supabase.co%'
  loop
    perform cron.unschedule(j.jobname);
    raise notice 'local: unscheduled % (it called the hosted project)', j.jobname;
  end loop;
end $$;
