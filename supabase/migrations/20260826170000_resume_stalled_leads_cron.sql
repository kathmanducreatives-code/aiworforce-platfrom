-- A CHECKPOINT NOBODY PICKS UP IS NOT A CHECKPOINT.
--
-- Lead continuations are dispatched IN PROCESS: a slice writes its checkpoint
-- and fires the next one before exiting. When a slice is killed between those
-- two acts the chain stalls, and `leadContinuationDispatch` says so plainly —
-- "a sweeper (or a user pressing Continue) can pick it up later". No sweeper
-- existed.
--
-- Run fafd9912 is the cost. Slice 2 enriched eleven companies, started Apify
-- run `ub2qunSMAKTNf5AKv`, and died mid-poll. The task sat `ready` with
-- `auto_continuation.continuing: true` while Apify completed 150 job rows for
-- nobody. The only crons were `monitoring-tick` and `sweep-stuck-runs`, and the
-- latter rescues only rows stuck at `running`.
--
-- ── THE TWO SWEEPERS COMPOSE ──────────────────────────────────────────────
--
--   tasks_sweep_stuck_runs   running → ready   (a killed claim's row status)
--   resume-stalled-leads     ready   → claimed (a stalled chain's next slice)
--
-- Both use a five-minute idle threshold so neither can judge a task dead that
-- the other considers alive. Every three minutes here is deliberate: it is
-- shorter than the five-minute staleness rule, so a task becomes eligible and
-- is picked up on the next tick rather than waiting a whole extra period.
--
-- ── WHAT THIS DOES NOT DO ─────────────────────────────────────────────────
--
-- It does not execute anything. `resume-stalled-leads` selects and calls
-- `run-agent`, which takes `claim_sourcing_continuation` — SELECT … FOR UPDATE,
-- a lease, a terminal check — exactly as it does for the Continue button. Two
-- ticks racing produce one claim and one quiet 409.

-- Idempotent: re-applying this migration replaces the job rather than failing
-- on the unique job name.
select cron.unschedule('resume-stalled-leads')
  where exists (select 1 from cron.job where jobname = 'resume-stalled-leads');

select cron.schedule(
  'resume-stalled-leads',
  '*/3 * * * *',
  $job$
  select net.http_post(
    url := 'https://ohsdatpvfdjdemstoiuj.supabase.co/functions/v1/resume-stalled-leads',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- The same service key `run-monitoring-tick` authenticates with. Both
      -- functions compare the bearer against SUPABASE_SERVICE_ROLE_KEY.
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'monitoring_tick_key'
      )
    ),
    body := '{}'::jsonb,
    -- The sweep returns as soon as it has dispatched; the slices it starts run
    -- in their own edge-function lifetimes, not inside this statement.
    timeout_milliseconds := 60000
  );
  $job$
);

-- ── AND THE RESERVATION BACKSTOP THAT WAS NEVER SCHEDULED ─────────────────
--
-- `credits_release_stale` has existed since the baseline schema and nothing
-- ever called it. `toolRegistry` names it as the backstop for a settle that
-- never runs — which is precisely what a hard-killed slice leaves behind: task
-- fafd9912 held a `reserved` credit transaction with `actual_credits = 0`
-- because the invocation that would have settled it was killed.
--
-- THIRTY MINUTES, NOT FIVE. A reservation belongs to a call that may still be
-- adopted: `resume-stalled-leads` brings a stalled chain back within minutes,
-- and the resumed slice settles the transaction against what the provider
-- actually did. Releasing sooner would race that and refund work that really
-- happened. Thirty minutes is long after any resume has had its chance and
-- long before a reservation is worth leaving.
select cron.unschedule('release-stale-credit-reservations')
  where exists (select 1 from cron.job where jobname = 'release-stale-credit-reservations');

select cron.schedule(
  'release-stale-credit-reservations',
  '*/10 * * * *',
  $job$ select public.credits_release_stale(interval '30 minutes'); $job$
);
