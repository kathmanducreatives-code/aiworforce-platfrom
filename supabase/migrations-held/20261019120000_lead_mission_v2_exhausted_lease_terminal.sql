-- LEAD MISSION V2 — A MISSION WHOSE LAST LEASE LAPSED IS ENDED, NOT STRANDED.
--
-- HELD. Depends on 20260910140000, 20260915120000, 20261003120000 and
-- 20261011120000 (the queue chain). Redefines `claim_next_lead_mission` (same
-- signature, same grants): the 20261003120000 function VERBATIM, plus one
-- step before it selects.
--
-- THE DEFECT (reproduced against real Postgres + PostgREST; Codex A7 review
-- `KNOWN DEFECT: a hard crash on claim five strands the queue and task
-- running`). Each claim costs an attempt and the select requires
-- `attempts < 5`. A worker that dies (or is killed) holding the FIFTH claim
-- never releases it, so the row stays `running` with a lapsed lease, and:
--   * no claim takes it again (`attempts` is already 5);
--   * tasks_sweep_stuck_runs skips its task, because an active queue row owns it;
--   * the task stays `running` and the lineage `active` — indefinitely.
-- `cancel_lead_mission` ended the queue row only.
--
-- THE FIX. On every claim, a `running` row whose lease has lapsed and which has
-- no retry (`attempts >= 5`) or slice (`continuations >= 25`) left is set
-- `failed` — what release_lead_mission does to an exhausted row a live worker
-- releases — with `last_outcome.lease_lapsed = true` and its reason
-- (`attempts_exhausted` / `slices_exhausted`). Nothing else changes:
--   * no attempt is granted and nothing is refunded; a lapsed row WITH attempts
--     left is reclaimed exactly as before;
--   * the stale holder's heartbeat and release now fail (`claimed_by` is
--     cleared), so a worker that was only partitioned stops at once;
--   * provider liabilities are untouched (smoke admissions stay committed and
--     listed by smoke-reconciliation.sql);
--   * the task, lineage and plan are ended by the WORKER's idle sweep
--     (leadMissionCancellation.ts `sweepLapsedMissions`), with the same
--     planTerminalReconciliation every release uses. Only rows this function
--     marked are visited, so no completed or ordinarily failed mission is
--     rewritten.
-- Either deploy order is safe: an old worker never lists the marked rows (they
-- stay `failed` in the queue until a new worker reconciles them); a new worker
-- against a database without this migration lists none.
--
-- Rollback (the 20261003120000 function, verbatim):
-- rollback/20261019120000_lead_mission_v2_exhausted_lease_terminal.down.sql.
-- No row is rewritten by the rollback.

create or replace function public.claim_next_lead_mission(
  p_worker_id uuid,
  p_lease_seconds integer default 180
)
returns table(
  claimed boolean, reason text, queue_id uuid, workspace_id uuid, request jsonb,
  task_id uuid, lineage_id uuid, attempts integer, held_until timestamptz
)
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_q    public.lead_mission_queue%rowtype;
  v_secs integer := greatest(coalesce(p_lease_seconds, 180), 30);
begin
  -- THE LAST LEASE LAPSED (Codex A7 review, P2). A worker that dies holding a
  -- mission's FINAL claim leaves it `running` with a lapsed lease. The select
  -- below never takes it again (`attempts < 5`), and tasks_sweep_stuck_runs
  -- skips a task an active queue row owns, so the queue row, task and lineage
  -- stayed `running` for ever. Out of retries (or slices), it is ended here:
  -- `failed`, visibly, with no new attempt granted and nothing refunded. The
  -- worker's idle sweep then ends the task, lineage and plan by the same rule
  -- as a release (leadMissionCancellation.ts `sweepLapsedMissions`). SKIP
  -- LOCKED: a row another transaction holds is left for the next claim.
  update public.lead_mission_queue q
     set status           = 'failed',
         claimed_by       = null,
         lease_expires_at = null,
         not_before       = null,
         last_outcome     = coalesce(q.last_outcome, '{}'::jsonb) || jsonb_build_object(
                              'reason', case when q.continuations >= 25 then 'slices_exhausted'
                                             else 'attempts_exhausted' end,
                              'lease_lapsed', true,
                              'lapsed_claimed_by', q.claimed_by,
                              'lapsed_lease_expires_at', q.lease_expires_at,
                              'ended_by', 'claim_next_lead_mission'),
         updated_at       = now()
   where q.id in (
           select x.id from public.lead_mission_queue x
            where x.status = 'running'
              and x.lease_expires_at is not null and x.lease_expires_at <= now()
              and (x.attempts >= 5 or x.continuations >= 25)
            for update skip locked);

  select q.* into v_q
    from public.lead_mission_queue q
   -- RETRIES: claims a clean continuation did not refund.
   where q.attempts < 5
     -- SLICES: a backstop only; the lineage's own ceilings end a mission first.
     and q.continuations < 25
     and coalesce(q.not_before, '-infinity'::timestamptz) <= now()
     and (
           q.status in ('queued', 'resumable')
           -- A worker died holding it: its lease has lapsed.
           or (q.status = 'running' and q.lease_expires_at is not null and q.lease_expires_at <= now())
         )
     -- The lineage row is the authority, once one exists.
     and not exists (
           select 1 from public.lead_lineages l
            where q.lineage_id is not null
              and l.lineage_id = q.lineage_id
              and l.status in ('cancelled', 'terminal')
         )
   order by q.created_at
   for update skip locked
   limit 1;

  if not found then
    return query select false, 'no_eligible_mission'::text,
      null::uuid, null::uuid, null::jsonb, null::uuid, null::uuid, null::integer, null::timestamptz;
    return;
  end if;

  -- Taken now, refunded at release if the run turns out to be a clean
  -- continuation. A worker that dies never releases, so its attempt stands.
  update public.lead_mission_queue
     set status           = 'running',
         claimed_by       = p_worker_id,
         lease_expires_at = now() + make_interval(secs => v_secs),
         attempts         = public.lead_mission_queue.attempts + 1,
         not_before       = null,
         updated_at       = now()
   where id = v_q.id;

  return query select true, 'claimed'::text, v_q.id, v_q.workspace_id, v_q.request,
    v_q.task_id, v_q.lineage_id, v_q.attempts + 1, now() + make_interval(secs => v_secs);
end;
$function$;


revoke all on function public.claim_next_lead_mission(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_next_lead_mission(uuid, integer) to service_role;
