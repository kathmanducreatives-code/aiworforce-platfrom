-- A RUN THE PLATFORM KILLED MUST NOT STAY "running" FOREVER.
--
-- An Edge Function has a hard wall clock. When it is killed mid-call nothing
-- in-process runs — no catch, no finally, no terminal record — so the task row
-- keeps `status = 'running'` and `updated_at` frozen at creation, and no
-- continuation ever claims it.
--
-- Run 78cff5e5 is the case this exists for: `harvestapi/linkedin-job-search`
-- started at 09:13:05, the function was killed mid-call, and the task was still
-- `running` half an hour later. Its companion change (persist-on-start) means
-- the provider run id now reaches `lead_execution_calls` the instant the run
-- exists, so the run is adoptable — this is what makes something adopt it.
--
-- WHY `ready` AND NOT `failed`.
--
-- `taskStatusContract.ts` defines `ready` as "checkpointed and available for
-- continuation", and it is `RESUMABLE_ROW_STATUS`. Marking a killed run
-- `failed` would discard work that was paid for and is recoverable. The
-- continuation claim still validates the checkpoint itself and refuses with
-- `no_checkpoint` when there is nothing to resume, so this cannot manufacture a
-- resumable run out of one that has no state.
--
-- WHY THE THRESHOLD IS MINUTES, NOT SECONDS.
--
-- The wall clock is 150s. A task quiet for five minutes is not slow, it is
-- dead. Anything tighter risks racing a live invocation that is simply between
-- writes, and re-claiming a run that is still executing is how the same
-- provider call gets paid for twice.

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
  ),
  -- Kept for forensics BEFORE the row is altered: the snapshot is the only
  -- record of what the killed invocation had written.
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
  'claim them. Archives each row first. The claim path still validates the '
  'checkpoint, so this cannot invent a resumable run.';

revoke all on function public.tasks_sweep_stuck_runs(interval) from public, anon, authenticated;

-- Every five minutes: well inside the continuation window, and long enough
-- after the 150s wall clock that a live invocation is never mistaken for a dead
-- one.
select cron.schedule(
  'sweep-stuck-runs',
  '*/5 * * * *',
  $cron$ select public.tasks_sweep_stuck_runs(); $cron$
);
