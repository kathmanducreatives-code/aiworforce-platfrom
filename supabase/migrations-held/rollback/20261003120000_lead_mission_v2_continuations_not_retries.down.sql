-- ROLLBACK for 20261003120000_lead_mission_v2_continuations_not_retries.sql
--
-- Restores `claim_next_lead_mission` and the 4-argument `release_lead_mission`
-- VERBATIM from 20260910140000_lead_mission_v2_claim.sql (a test asserts they
-- are byte-identical), then drops the `continuations` column.
--
-- Deploy order on the way back: roll the WORKER back first (the old worker calls
-- release with four arguments), then run this. A new worker against the rolled-
-- back database falls back to the 4-argument call on its own, so either order
-- is safe; this one avoids even the fallback.
--
-- Rows are not rewritten. `attempts` on a row released under the new rule
-- holds faults only, so a mission in flight during the rollback may get more
-- slices than the old rule would have allowed — never more than 5 claims from
-- the moment of rollback.

begin;

drop function if exists public.release_lead_mission(uuid, uuid, text, jsonb, integer);

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
  select q.* into v_q
    from public.lead_mission_queue q
   where q.attempts < 5
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

create or replace function public.release_lead_mission(
  p_queue_id uuid,
  p_worker_id uuid,
  p_status text,
  p_outcome jsonb default null
)
returns table(released boolean, final_status text)
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_q     public.lead_mission_queue%rowtype;
  v_final text;
begin
  if p_status not in ('complete', 'resumable', 'failed', 'cancelled') then
    raise exception 'invalid lead mission release status: %', p_status;
  end if;

  select * into v_q from public.lead_mission_queue where id = p_queue_id for update;
  if not found or v_q.claimed_by is distinct from p_worker_id then
    return query select false, null::text; return;
  end if;

  v_final := case
    -- A cancellation that landed mid-run is never overwritten.
    when v_q.status = 'cancelled' then 'cancelled'
    -- Out of attempts: stop, visibly, rather than retry for ever.
    when p_status = 'resumable' and v_q.attempts >= 5 then 'failed'
    else p_status
  end;

  update public.lead_mission_queue
     set status           = v_final,
         claimed_by       = null,
         lease_expires_at = null,
         not_before       = case when v_final = 'resumable' then now() + interval '2 minutes' else null end,
         last_outcome     = p_outcome,
         updated_at       = now()
   where id = p_queue_id;

  return query select true, v_final;
end;
$function$;

revoke all on function public.claim_next_lead_mission(uuid, integer) from public, anon, authenticated;
revoke all on function public.release_lead_mission(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.claim_next_lead_mission(uuid, integer) to service_role;
grant execute on function public.release_lead_mission(uuid, uuid, text, jsonb) to service_role;

alter table public.lead_mission_queue drop constraint if exists lead_mission_queue_continuations_nonnegative;
alter table public.lead_mission_queue drop column if exists continuations;
comment on column public.lead_mission_queue.attempts is null;

commit;
