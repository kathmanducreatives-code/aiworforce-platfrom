-- LEAD V2 P0 — THE STUCK-RUN SWEEPER DOES NOT TOUCH A TASK THE V2 QUEUE OWNS.
--
-- HELD. Depends on `lead_mission_queue` (20260910140000_lead_mission_v2_claim.sql,
-- also held). Apply only after that migration, deliberately, one at a time — see
-- `supabase/migrations-held/README.md` and `docs/SUPABASE_TARGETING.md`.
--
-- `tasks_sweep_stuck_runs` flips any task `running` and quiet for five minutes
-- to `ready`. It never executes anything, but `ready` is RESUMABLE_ROW_STATUS:
-- it invites the V1 continuation paths to claim the row. For a Lead V2 task the
-- queue is the only owner — its heartbeat normally keeps `tasks.updated_at`
-- fresh, so the sweeper never sees it — and a worker that stalls between
-- heartbeats must be recovered by the queue's own lease expiry, not by a
-- status flip that hands the lineage to a second executor.
--
-- The only change from 20260826100000_sweep_stuck_runs.sql is the `not exists`
-- clause. Everything else — archive-before-alter, `ready`, the threshold, the
-- grants, the cron — is unchanged.

create or replace function public.tasks_sweep_stuck_runs(
  stale_after interval default interval '5 minutes'
)
returns table (task_id uuid, workspace_id uuid, stuck_for interval)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with dead as (
    select t.id, t.workspace_id, now() - t.updated_at as quiet_for, to_jsonb(t) as snapshot
    from public.tasks t
    where t.status = 'running'
      and t.updated_at < now() - stale_after
      -- A task an active V2 queue row owns is recovered by the queue.
      and not exists (
        select 1 from public.lead_mission_queue q
        where q.task_id = t.id
          and q.status in ('queued', 'running', 'resumable')
      )
  ),
  archived as (
    insert into public.ops_stuck_run_archive (archived_at, kind, id, snapshot)
    select now(), 'stuck_running_task', d.id, d.snapshot from dead d
    returning id
  ),
  swept as (
    update public.tasks t
    set status = 'ready', updated_at = now()
    from dead d
    where t.id = d.id
    returning t.id, t.workspace_id, d.quiet_for
  )
  select s.id, s.workspace_id, s.quiet_for from swept s;
end;
$$;

comment on function public.tasks_sweep_stuck_runs(interval) is
  'Move platform-killed runs from `running` to `ready` so a continuation can '
  'claim them. Archives each row first. Skips tasks an active Lead V2 queue row '
  'owns — the queue recovers those. The claim path still validates the '
  'checkpoint, so this cannot invent a resumable run.';

revoke all on function public.tasks_sweep_stuck_runs(interval) from public, anon, authenticated;
