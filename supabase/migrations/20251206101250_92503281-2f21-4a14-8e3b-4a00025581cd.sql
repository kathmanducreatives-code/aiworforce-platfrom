-- Enable required extensions for cron jobs and HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Grant usage to postgres role
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

-- THE EVERY-MINUTE CRON JOB IS NO LONGER SCHEDULED HERE.
--
-- What this block used to do, and why it is gone:
--
--   1. IT HARDCODED A PROJECT URL. The scheduled statement posted to
--      https://zbwsbnqqpkvdhqwavjke.supabase.co/... — so replaying this
--      migration into any OTHER project created a cron job on the new database
--      that called the OLD project's edge function, indefinitely, with no sign
--      that anything was wrong.
--
--   2. IT HARDCODED AN ANON JWT for that project, committed in plaintext.
--
--   3. IT FILLED THE DISK. Running every minute, each execution wrote a row to
--      `cron.job_run_details` and another to `net._http_response`, and nothing
--      pruned either. On 2026-08-15 that reached 455 MB of a 624 MB database
--      against a 500 MB limit; the project was throttled to the point where a
--      687-row count took 21 seconds and chat history stopped loading.
--
-- The extensions above are still created, because other things need them. If
-- scheduled email is wanted, schedule it deliberately against the CURRENT
-- project — and pair it with a retention job, which is what was missing:
--
--   select cron.schedule('send-scheduled-emails-job', '* * * * *', $$
--     select net.http_post(
--       url := current_setting('app.settings.supabase_url') || '/functions/v1/send-scheduled-emails',
--       headers := jsonb_build_object('Content-Type', 'application/json'),
--       body := '{}'::jsonb);
--   $$);
--
--   select cron.schedule('prune-operational-logs', '17 3 * * *', $$
--     delete from cron.job_run_details where end_time < now() - interval '3 days';
--     delete from net._http_response where created < now() - interval '12 hours';
--   $$);
