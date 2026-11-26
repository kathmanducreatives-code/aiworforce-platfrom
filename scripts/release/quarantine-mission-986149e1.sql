-- QUARANTINE THE 2026-10-13 RESUMABLE LEAD MISSION IN PRODUCTION — prepared, NOT run.
-- Needs the owner's explicit approval. Production project: ohsdatpvfdjdemstoiuj.
--
-- Why: lead_mission_queue 986149e1-1b84-4c3b-86e1-969dbacfcebd has been `resumable` since
-- 2026-10-13 10:11 UTC (worker_error: "No space left on device"). It is the only open row.
-- A worker that comes back would claim it and resume its paid provider steps. Ops-health
-- has reported it as critical (queue_unclaimed) on every run since.
--
-- What it does: ONE row, from `resumable` to `cancelled`. History is kept: the row is
-- not deleted, `attempts`/`continuations`/`task_id` are untouched, and the previous
-- `last_outcome` is preserved inside the new one. Its task stays as it is.
-- Guarded: aborts unless the row is exactly as verified (id, status, unclaimed, 1 attempt).
-- Rollback: set status back to 'resumable' and last_outcome to last_outcome->'previous'.
begin;
do $$
declare n int;
begin
  update public.lead_mission_queue
     set status = 'cancelled',
         last_outcome = jsonb_build_object(
           'status', 'quarantined',
           'reason', 'owner-approved quarantine: resumable since 2026-10-13 with no worker; prevents a returning worker from resuming paid steps',
           'quarantined_at', now(),
           'previous', last_outcome),
         updated_at = now()
   where id = '986149e1-1b84-4c3b-86e1-969dbacfcebd'
     and status = 'resumable' and claimed_by is null and lease_expires_at is null and attempts = 1;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'guard: expected exactly 1 resumable, unclaimed row; updated %', n; end if;
end $$;
select id, status, last_outcome->>'status' outcome, (last_outcome->'previous'->>'error') previous_error,
       (select count(*) from public.lead_mission_queue where status not in ('complete','failed','cancelled')) open_rows_left
  from public.lead_mission_queue where id = '986149e1-1b84-4c3b-86e1-969dbacfcebd';
commit;
