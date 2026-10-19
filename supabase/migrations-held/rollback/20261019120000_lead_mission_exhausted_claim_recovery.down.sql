-- HELD rollback: restores pre-recovery claim behavior. Never run automatically.
-- Existing recovered terminal rows and financial liabilities are not changed.
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

drop function if exists public.recover_exhausted_lead_missions(integer);
