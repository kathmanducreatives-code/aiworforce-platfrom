-- Enable required extensions for cron jobs and HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Grant usage to postgres role
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

-- Schedule the cron job to run every minute
SELECT cron.schedule(
  'send-scheduled-emails-job',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://zbwsbnqqpkvdhqwavjke.supabase.co/functions/v1/send-scheduled-emails',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpid3NibnFxcGt2ZGhxd2F2amtlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY1MzgzMzEsImV4cCI6MjA3MjExNDMzMX0.kjhXkXmmNChw0XqYpXehNckMzHPUYX705aNScavKc8g"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);